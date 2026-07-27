/**
 * WorkLoop — the main autonomous agent cycle engine.
 *
 * Orchestrates the complete CorpGen digital-worker loop:
 *   1. Observe   — restore memory, build context
 *   2. Requeue   — resume any waiting cards whose HITL approvals have been granted
 *   3. Plan      — generate or refresh work plan
 *   4. Select    — WorkReasoner picks 1-N cards
 *   5. Execute   — lane-aware advancement (one lane step per cycle):
 *                     queue  → active : card pulled into work (no tools run)
 *                     active → review : all tools invoked, evidence collected
 *                     review → done   : ArtifactJudge scores, verdict gates completion
 *   6. Record    — update Kanban, emit events, populate AuditTrail
 *   7. Reflect   — consolidate memory, emit cycle-end event
 *   8. Broadcast — send digest via NotificationProvider (optional)
 *
 * Lane rules enforced here:
 *   - 'waiting' is NEVER reached via advance(); only via block() / blockWithApproval().
 *   - Tools run ONCE — when the card is in 'active' (step 5 above).
 *   - The ArtifactJudge runs ONCE — when the card is in 'review'.
 *   - 'needs-review' verdict blocks the card just like 'blocked'.
 *
 * HITL approval lifecycle:
 *   - auto-approve (via onApprovalRequest callback): HitlGateway.decide() is called
 *     immediately to persist the approval; digest is verified before re-evaluation.
 *   - human approval: card blocked with approvalId; future cycles detect the approval
 *     and requeue the card automatically.
 *
 * Copilot SDK alignment:
 *   - WorkLoop.run() is analogous to CopilotClient.createSession() + send()
 *   - onApprovalRequest is analogous to onPermissionRequest
 *   - onEvent is analogous to session.on('assistant.message', ...)
 *   - WorkdayResult is analogous to the session transcript
 *
 * CorpGen paper reference: arXiv:2602.14229
 */

import crypto from 'crypto';
import type {
  WorkLoopConfig,
  WorkdayResult,
  WorkCycleContext,
  MemorySummary,
  WorkCard,
  ToolDefinition,
  ApproverIdentity,
} from '../types';
import { AgentIdentity } from './AgentIdentity';
import { KanbanBoardManager } from './KanbanBoard';
import { WorkReasoner } from './WorkReasoner';
import { MemoryEngine } from '../memory/MemoryEngine';
import { EventBus } from '../observability/EventBus';
import { AuditTrail } from '../observability/AuditTrail';
import { ToolPolicyGateway } from '../governance/ToolPolicy';
import { ArtifactJudge } from '../governance/ArtifactJudge';
import { HitlGateway } from '../governance/HitlGateway';
import { InMemoryStorageProvider } from '../adapters/InMemoryStorageProvider';

/** System identity used when the WorkLoop auto-approves via the onApprovalRequest callback. */
const SYSTEM_APPROVER: ApproverIdentity = {
  oid: 'corpgen-system',
  email: 'system@corpgen.internal',
  name: 'CorpGen Auto-Approve',
  kind: 'service-principal',
};

export class WorkLoop {
  private readonly identity: AgentIdentity;
  private readonly kanban: KanbanBoardManager;
  private readonly reasoner: WorkReasoner;
  private readonly memory: MemoryEngine;
  private readonly events: EventBus;
  private readonly audit: AuditTrail;
  private readonly policy: ToolPolicyGateway;
  private readonly judge: ArtifactJudge;
  private readonly hitl: HitlGateway;
  private readonly config: WorkLoopConfig;
  private readonly toolMap: Map<string, ToolDefinition>;
  /** Prevents overlapping WorkLoop.run() calls on the same instance. */
  private isRunning = false;

  constructor(config: WorkLoopConfig) {
    this.config = config;
    const storage = config.storage ?? new InMemoryStorageProvider();

    this.identity = new AgentIdentity(config.contract);
    this.kanban = new KanbanBoardManager({ storage });
    this.reasoner = new WorkReasoner({ llm: config.llm, maxCards: config.maxCardsPerCycle ?? 2 });
    this.memory = new MemoryEngine({ storage, agentName: config.contract.name });
    this.events = new EventBus({ onEvent: config.onEvent });
    this.audit = new AuditTrail({ agentName: config.contract.name });
    this.judge = new ArtifactJudge();
    this.hitl = new HitlGateway({
      storage,
      notification: config.notifications,
      notificationTarget: config.contract.reportsTo,
    });

    // Build ToolPolicyGateway from declared tool risk classes.
    // R2-B7 fix: tools without an explicit riskClass are NOT added to any set.
    // The gateway's name-pattern fallback applies, and truly unclassified tools
    // receive 'unknown' risk → denied. Do NOT use a default of 'read-only'.
    this.toolMap = new Map(config.tools.map((t) => [t.name, t]));
    const readOnly = new Set<string>();
    const internalWrite = new Set<string>();
    const externalL2 = new Set<string>();

    for (const tool of config.tools) {
      switch (tool.riskClass) {
        case 'read-only': readOnly.add(tool.name); break;
        case 'internal-write': internalWrite.add(tool.name); break;
        case 'external-communication':
        case 'financial-commitment': externalL2.add(tool.name); break;
        // undefined / 'privileged-decision' / 'unknown' → not added to any set.
        // The gateway's name-pattern heuristic still applies.
      }
    }
    this.policy = new ToolPolicyGateway({ readOnlyTools: readOnly, internalWriteTools: internalWrite, externalL2Tools: externalL2 });
  }

  /**
   * Run one full autonomous workday cycle.
   *
   * Analogous to:
   *   const session = await client.createSession({ ... });
   *   await session.send({ prompt: '...' });
   *   await session.disconnect();
   *
   * @param options.maxCycles  Maximum inner execution cycles. Defaults to 10.
   * @param options.forceRun   Override operating-window check.
   */
  async run(options: { maxCycles?: number; forceRun?: boolean } = {}): Promise<WorkdayResult> {
    if (this.isRunning) {
      throw new Error('WorkLoop is already running. Await the current run() before starting another.');
    }
    this.isRunning = true;

    const correlationId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const maxCycles = options.maxCycles ?? 10;
    const forceRun = options.forceRun ?? this.config.forceRun ?? false;

    try {
      // --- Operating window check ---
      if (!forceRun && !this.identity.isOperatingNow()) {
        this.events.record({
          kind: 'cycle.start',
          label: 'WorkLoop skipped — outside operating window.',
          status: 'partial',
          correlationId,
        });
        this.audit.record({
          correlationId, category: 'work-lifecycle', action: 'workday.skipped',
          status: 'info', summary: 'Outside operating window.',
        });
        return this.emptyResult(correlationId, startedAt);
      }

      this.events.record({ kind: 'cycle.start', label: `Workday started for ${this.config.contract.name}`, status: 'started', correlationId });
      this.audit.record({
        correlationId, category: 'work-lifecycle', action: 'workday.started',
        status: 'info', summary: `Workday started. maxCycles=${maxCycles}.`,
      });

      // --- Observe: restore memory ---
      let memorySummary: MemorySummary | undefined;
      const priorMemory = await this.memory.restore();
      if (priorMemory.workingContext?.length) {
        memorySummary = priorMemory as MemorySummary;
      }

      let cyclesRun = 0;
      let cardsAdvanced = 0;
      let cardsCompleted = 0;
      let cardsBlocked = 0;

      for (let cycle = 0; cycle < maxCycles; cycle++) {
        // --- R2-B2 fix: Resume any waiting cards whose HITL approvals are now granted ---
        await this.requeueApprovedCards(correlationId);

        const movable = await this.kanban.getMovable();
        if (!movable.length) break;

        // --- Select: WorkReasoner picks cards ---
        const decision = await this.reasoner.decide(movable);
        this.events.record({
          kind: 'plan.generated',
          label: `Cycle ${cycle + 1}: ${decision.summary}`,
          status: 'ok',
          data: { mode: decision.mode, cards: decision.decisions.map((d) => d.cardId) },
          correlationId,
        });

        if (!decision.decisions.length) break;

        // --- Execute: advance each selected card by ONE lane step ---
        for (const { cardId, rationale } of decision.decisions) {
          const card = movable.find((c) => c.id === cardId);
          if (!card) continue;

          const cycleContext: WorkCycleContext = {
            correlationId,
            cycleStartedAt: new Date().toISOString(),
            memorySummary,
            activeCard: card,
            origin: 'scheduler',
          };

          const result = await this.executeCard(card, cycleContext, rationale);
          cardsAdvanced++;
          if (result.completed) cardsCompleted++;
          if (result.blocked) cardsBlocked++;
        }

        cyclesRun++;

        // --- Reflect: consolidate memory at end of each inner cycle ---
        const currentCards = await this.loadAllCards();
        memorySummary = await this.memory.summarize(this.events.getRecent({ limit: 50 }), currentCards);
        this.events.record({ kind: 'memory.update', label: 'Memory consolidated.', status: 'ok', correlationId });
        this.audit.record({
          correlationId, category: 'memory-operation', action: 'memory.consolidate',
          status: 'success', summary: `Cycle ${cycle + 1} memory consolidated.`,
        });
      }

      // --- Broadcast digest ---
      if (this.config.notifications && this.config.contract.reportsTo) {
        const notifResult = await this.config.notifications.send(this.config.contract.reportsTo, {
          subject: `[${this.config.contract.name}] Workday complete`,
          text: `Cycles: ${cyclesRun} | Cards advanced: ${cardsAdvanced} | Completed: ${cardsCompleted} | Blocked: ${cardsBlocked}`,
        });
        this.audit.record({
          correlationId, category: 'notification', action: 'digest.sent',
          status: notifResult.ok ? 'success' : 'failure',
          summary: `Digest sent to ${this.config.contract.reportsTo}.`,
          details: { channel: notifResult.channel, error: notifResult.error },
        });
      }

      const completedAt = new Date().toISOString();
      this.events.record({ kind: 'cycle.end', label: `Workday complete. ${cardsAdvanced} cards advanced.`, status: 'ok', correlationId });
      this.audit.record({
        correlationId, category: 'work-lifecycle', action: 'workday.completed',
        status: 'success',
        summary: `${cyclesRun} cycles, ${cardsAdvanced} advanced, ${cardsCompleted} completed, ${cardsBlocked} blocked.`,
      });

      const finalBoard = await this.kanban.getSnapshot();
      const finalMemory = memorySummary ?? this.emptyMemory(completedAt);

      return {
        correlationId,
        startedAt,
        completedAt,
        cyclesRun,
        cardsAdvanced,
        cardsCompleted,
        cardsBlocked,
        events: this.events.drain(),
        memorySnapshot: finalMemory,
        board: finalBoard,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * R2-B2: Check every 'waiting' card for a resolved HITL approval.
   * When an approval transitions to 'approved' or 'approved_with_edits',
   * requeue the card so the next execution cycle can resume from 'active'.
   */
  private async requeueApprovedCards(correlationId: string): Promise<void> {
    const snapshot = await this.kanban.getSnapshot();
    const waitingCards = snapshot.columns.find((c) => c.id === 'waiting')?.cards ?? [];
    for (const card of waitingCards) {
      if (!card.pendingApprovalId) continue;
      const approval = await this.hitl.getById(card.pendingApprovalId);
      if (!approval) continue;
      if (approval.status === 'approved' || approval.status === 'approved_with_edits') {
        await this.kanban.requeue(card.id);
        this.events.record({
          kind: 'hitl.decision',
          label: `Card "${card.title}" requeued after approval ${approval.id}.`,
          status: 'ok',
          data: { cardId: card.id, approvalId: approval.id, status: approval.status },
          correlationId,
        });
        this.audit.record({
          correlationId, category: 'approval-lifecycle', action: 'card.requeued',
          status: 'success',
          summary: `Card "${card.title}" requeued; approval ${approval.id} granted (${approval.status}).`,
          details: { approvalId: approval.id },
        });
      }
    }
  }

  /**
   * R2-B4: Lane-aware card advancement — one step per call.
   *
   *   queue  → active  : card pulled into work; no tools executed yet.
   *   active → review  : all tools invoked (with policy + HITL); evidence collected.
   *   review → done    : ArtifactJudge evaluates; 'ready' → done, else block.
   */
  private async executeCard(
    card: WorkCard,
    context: WorkCycleContext,
    rationale: string,
  ): Promise<{ completed: boolean; blocked: boolean }> {
    this.events.record({
      kind: 'mission.task',
      label: `Executing card "${card.title}" (lane: ${card.lane})`,
      status: 'started',
      data: { cardId: card.id, rationale, lane: card.lane },
      correlationId: context.correlationId,
    });

    // ── Step 1: queue → active ─────────────────────────────────────────────
    if (card.lane === 'queue') {
      await this.kanban.advance(card.id);
      this.audit.record({
        correlationId: context.correlationId, category: 'work-lifecycle', action: 'card.activated',
        status: 'info', summary: `Card "${card.title}" moved queue → active.`,
      });
      return { completed: false, blocked: false };
    }

    // ── Step 2: active → review (run tools) ───────────────────────────────
    if (card.lane === 'active') {
      return this.executeActiveCard(card, context, rationale);
    }

    // ── Step 3: review → done (evaluate artifact) ─────────────────────────
    if (card.lane === 'review') {
      return this.executeReviewCard(card, context);
    }

    // Any other lane (e.g. 'done') should not be movable — no-op.
    return { completed: false, blocked: false };
  }

  /**
   * Runs all tools for an 'active' card, enforcing policy and HITL gates.
   * On success, advances the card to 'review'. On failure, blocks it.
   */
  private async executeActiveCard(
    card: WorkCard,
    context: WorkCycleContext,
    rationale: string,
  ): Promise<{ completed: boolean; blocked: boolean }> {
    const evidence: string[] = [];
    let blockReason: string | undefined;
    let pendingApprovalId: string | undefined;

    for (const toolName of card.tools) {
      const tool = this.toolMap.get(toolName);
      if (!tool) {
        blockReason = `Tool not registered: ${toolName}`;
        this.events.record({ kind: 'tool.call', label: blockReason, status: 'error', correlationId: context.correlationId });
        this.audit.record({ correlationId: context.correlationId, category: 'tool-invocation', action: 'tool.missing', status: 'failure', summary: blockReason });
        break;
      }

      // Resolve params; fall back to {} if card.toolParams was not populated.
      const params = card.toolParams?.[toolName] ?? {};

      // R2-NB1: warn if the tool schema declares parameters but none were supplied.
      if (Object.keys(tool.parameters).length > 0 && Object.keys(params).length === 0) {
        this.events.record({
          kind: 'tool.call',
          label: `Warning: no params supplied for "${toolName}" but schema defines parameters — tool may fail.`,
          status: 'partial',
          correlationId: context.correlationId,
        });
      }

      const evalResult = this.policy.evaluate(toolName, params);

      this.events.record({
        kind: 'policy.decision',
        label: `Policy: ${toolName} → ${evalResult.decision}`,
        status: evalResult.decision === 'allow' ? 'ok' : evalResult.decision === 'approval-required' ? 'partial' : 'error',
        data: { decision: evalResult.decision, reason: evalResult.reason, digest: evalResult.actionDigest },
        correlationId: context.correlationId,
      });
      this.audit.record({
        correlationId: context.correlationId, category: 'policy-decision', action: 'policy.evaluate',
        status: evalResult.decision === 'deny' ? 'failure' : 'info',
        summary: `${toolName}: ${evalResult.decision} — ${evalResult.reason}`,
        details: { digest: evalResult.actionDigest, decision: evalResult.decision },
      });

      if (evalResult.decision === 'deny') {
        blockReason = `Tool denied by policy: ${evalResult.reason}`;
        break;
      }

      if (evalResult.decision === 'approval-required') {
        const approvalReq = await this.hitl.request({
          level: evalResult.policy.approvalLevel ?? 'L2',
          stage: card.lane,
          title: `Approve: ${toolName} for card "${card.title}"`,
          actionType: toolName,
          recipient: this.config.contract.reportsTo,
          bodyPreview: evalResult.actionSummary,
          rationale,
          triggeredBy: card.id,
          tool: toolName,
          toolParams: params,
          evidence: card.evidence,
        });

        this.events.record({ kind: 'hitl.request', label: `Approval required: ${toolName} (id: ${approvalReq.id})`, status: 'partial', correlationId: context.correlationId });
        this.audit.record({
          correlationId: context.correlationId, category: 'approval-lifecycle', action: 'approval.requested',
          status: 'info',
          summary: `${evalResult.policy.approvalLevel ?? 'L2'} approval requested for ${toolName}.`,
          details: { approvalId: approvalReq.id, digest: evalResult.actionDigest },
        });

        // Give the consumer the chance to auto-approve (e.g. in tests).
        const autoApproved = this.config.onApprovalRequest
          ? await this.config.onApprovalRequest(approvalReq)
          : false;

        if (!autoApproved) {
          // R2-B2: record the approval ID on the card so future cycles can resume.
          blockReason = `Awaiting ${evalResult.policy.approvalLevel ?? 'L2'} approval for ${toolName}.`;
          pendingApprovalId = approvalReq.id;
          break;
        }

        // R2-B1 fix: persist the approval in HitlGateway so that the state
        // is authoritative. Pass the actual version to prevent replay.
        const decideResult = await this.hitl.decide(
          approvalReq.id,
          'approve',
          SYSTEM_APPROVER,
          'Auto-approved via onApprovalRequest callback.',
          approvalReq.version,
        );
        if (!decideResult.ok || !decideResult.request) {
          blockReason = `Auto-approval state transition failed: ${decideResult.error}`;
          break;
        }

        // Verify the digest matches what we are about to execute (replay prevention).
        if (decideResult.request.actionDigest !== evalResult.actionDigest) {
          blockReason = 'Approval digest mismatch — possible replay attack detected.';
          this.audit.record({
            correlationId: context.correlationId, category: 'security', action: 'approval.digest-mismatch',
            status: 'failure', summary: blockReason,
            details: { expected: evalResult.actionDigest, got: decideResult.request.actionDigest },
          });
          break;
        }

        this.audit.record({
          correlationId: context.correlationId, category: 'approval-lifecycle', action: 'approval.auto-granted',
          status: 'success',
          summary: `Auto-approval granted for ${toolName} (id: ${approvalReq.id}).`,
          details: { approvalId: approvalReq.id, digest: evalResult.actionDigest },
        });

        // Re-evaluate with the verified approval context.
        const reEval = this.policy.evaluate(toolName, params, {
          approvalId: approvalReq.id,
          approvalActionDigest: evalResult.actionDigest,
        });
        if (reEval.decision !== 'allow') {
          blockReason = `Re-evaluation after approval still denied: ${reEval.reason}`;
          break;
        }
      }

      // --- Invoke the tool handler ---
      const toolStart = Date.now();
      try {
        this.events.record({ kind: 'tool.call', label: `Calling: ${toolName}`, status: 'started', correlationId: context.correlationId });
        const result = await tool.handler(params as never, context);
        const durationMs = Date.now() - toolStart;
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result).slice(0, 300);
        this.events.record({
          kind: 'tool.result',
          label: `Done: ${toolName}`,
          status: 'ok',
          durationMs,
          data: { result: resultStr },
          correlationId: context.correlationId,
        });
        this.audit.record({
          correlationId: context.correlationId, category: 'tool-invocation', action: 'tool.completed',
          status: 'success', summary: `${toolName} completed in ${durationMs}ms.`,
          details: { durationMs }, durationMs,
        });
        evidence.push(`${toolName} completed in ${durationMs}ms`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.events.record({ kind: 'tool.result', label: `Error: ${toolName}`, status: 'error', data: { error: msg }, correlationId: context.correlationId });
        this.audit.record({
          correlationId: context.correlationId, category: 'tool-invocation', action: 'tool.failed',
          status: 'failure', summary: `${toolName} threw: ${msg}`,
        });
        blockReason = `Tool error: ${msg}`;
        break;
      }
    }

    if (blockReason) {
      if (pendingApprovalId) {
        // R2-B2: record the approval ID so the requeue path can resume.
        await this.kanban.blockWithApproval(card.id, blockReason, pendingApprovalId);
      } else {
        await this.kanban.block(card.id, blockReason);
      }
      this.audit.record({
        correlationId: context.correlationId, category: 'work-lifecycle', action: 'card.blocked',
        status: 'warning', summary: `Card "${card.title}" blocked: ${blockReason}`,
        details: pendingApprovalId ? { pendingApprovalId } : undefined,
      });
      return { completed: false, blocked: true };
    }

    // All tools succeeded — advance to 'review'.
    const advanced = await this.kanban.advance(card.id, evidence.length ? evidence : undefined);
    this.audit.record({
      correlationId: context.correlationId, category: 'work-lifecycle', action: 'card.advanced',
      status: 'success',
      summary: `Card "${card.title}" advanced to ${advanced?.lane ?? 'unknown'} with ${evidence.length} evidence item(s).`,
    });
    return { completed: false, blocked: false };
  }

  /**
   * Evaluates the artifact for a card in 'review'.
   * 'ready' → advance to 'done'. Any other verdict blocks the card.
   *
   * R2-B5 fix: 'needs-review' is treated identically to 'blocked' — the card
   * does NOT auto-advance to 'done' on the next cycle. Human action is required.
   */
  private async executeReviewCard(
    card: WorkCard,
    context: WorkCycleContext,
  ): Promise<{ completed: boolean; blocked: boolean }> {
    const evaluation = this.judge.evaluate({
      type: card.cadence ?? 'task',
      title: card.title,
      content: card.summary,
      evidence: card.evidence ?? [],
    });

    this.events.record({
      kind: 'artifact.evaluated',
      label: `Artifact: "${card.title}" → ${evaluation.verdict} (${evaluation.score}/100)`,
      status: evaluation.verdict === 'blocked' ? 'error' : evaluation.verdict === 'ready' ? 'ok' : 'partial',
      data: { score: evaluation.score, verdict: evaluation.verdict },
      correlationId: context.correlationId,
    });
    this.audit.record({
      correlationId: context.correlationId, category: 'artifact-evaluation', action: 'artifact.judged',
      status: evaluation.verdict === 'ready' ? 'success' : 'failure',
      summary: `"${card.title}" scored ${evaluation.score}/100: ${evaluation.verdict}.`,
      details: { score: evaluation.score, verdict: evaluation.verdict, checks: evaluation.checks.map((c) => c.id) },
    });

    if (evaluation.verdict === 'ready') {
      // Advance to 'done'.
      await this.kanban.advance(card.id);
      this.audit.record({
        correlationId: context.correlationId, category: 'work-lifecycle', action: 'card.completed',
        status: 'success', summary: `Card "${card.title}" completed.`, evidence: card.evidence,
      });
      return { completed: true, blocked: false };
    }

    // 'blocked' or 'needs-review' — block the card (R2-B5: needs-review does NOT auto-advance).
    const blockReason = `Artifact evaluation: ${evaluation.verdict} — ${evaluation.rationale}`;
    await this.kanban.block(card.id, blockReason);
    this.audit.record({
      correlationId: context.correlationId, category: 'work-lifecycle', action: 'card.blocked',
      status: 'warning',
      summary: `Card "${card.title}" blocked at review: ${evaluation.verdict}.`,
    });
    return { completed: false, blocked: true };
  }

  private async loadAllCards(): Promise<WorkCard[]> {
    const board = await this.kanban.getSnapshot();
    return board.columns.flatMap((col) => col.cards);
  }

  private emptyMemory(generatedAt: string): MemorySummary {
    return {
      generatedAt,
      workingContext: [],
      structuredMemory: [],
      semanticRecall: [],
      experientialTrajectories: [],
      preservedCriticalContent: [],
      compressionPolicy: 'No cycles run.',
      recordsConsidered: 0,
      eventsConsidered: 0,
    };
  }

  private emptyResult(correlationId: string, startedAt: string): WorkdayResult {
    const now = new Date().toISOString();
    return {
      correlationId,
      startedAt,
      completedAt: now,
      cyclesRun: 0,
      cardsAdvanced: 0,
      cardsCompleted: 0,
      cardsBlocked: 0,
      events: this.events.drain(),
      memorySnapshot: this.emptyMemory(now),
      board: {
        generatedAt: now,
        nextBestAction: 'No cycles run.',
        metrics: { queued: 0, active: 0, waiting: 0, review: 0, done: 0, total: 0 },
        columns: [],
      },
    };
  }

  /** Expose the Kanban manager for consumers to seed work cards before run(). */
  get board(): KanbanBoardManager { return this.kanban; }

  /** Expose the EventBus for consumers to subscribe to live events. */
  get eventBus(): EventBus { return this.events; }

  /** Expose the AuditTrail for consumers to export audit records. */
  get auditTrail(): AuditTrail { return this.audit; }

  /** Expose the HitlGateway for consumers to process approval decisions. */
  get hitlGateway(): HitlGateway { return this.hitl; }
}
