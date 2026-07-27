/**
 * WorkLoop — the main autonomous agent cycle engine.
 *
 * Orchestrates the complete CorpGen digital-worker loop:
 *   1. Observe   — restore memory, build context
 *   2. Plan      — generate or refresh work plan
 *   3. Select    — WorkReasoner picks 1-N cards
 *   4. Execute   — tool handlers advance each card (one lane step per cycle)
 *   5. Evaluate  — ArtifactJudge scores outputs when card enters review lane
 *   6. Record    — update Kanban, emit events, populate AuditTrail
 *   7. Reflect   — consolidate memory, emit cycle-end event
 *   8. Broadcast — send digest via NotificationProvider (optional)
 *
 * Card lane advancement: queue → active → review → done.
 * Each call to executeCard advances a card by exactly ONE lane step.
 * ArtifactJudge runs when the card reaches 'review'. The judge's 'blocked'
 * verdict re-routes the card to 'waiting'. A 'ready' verdict allows the next
 * cycle to advance it to 'done'.
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
  ApprovalRequest,
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

    // B2 fix: build ToolPolicyGateway from declared tool risk classes so
    // every registered tool has an explicit policy and name-pattern inference
    // is only a fallback for tools that omit riskClass.
    this.toolMap = new Map(config.tools.map((t) => [t.name, t]));
    const readOnly = new Set<string>();
    const internalWrite = new Set<string>();
    const externalL2 = new Set<string>();

    for (const tool of config.tools) {
      switch (tool.riskClass ?? 'read-only') {
        case 'read-only': readOnly.add(tool.name); break;
        case 'internal-write': internalWrite.add(tool.name); break;
        case 'external-communication':
        case 'financial-commitment': externalL2.add(tool.name); break;
        // privileged-decision / unknown tools are never added; they deny.
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
    // B6 fix: prevent overlapping runs on the same instance
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
      // B7 fix: audit workday start
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

        // --- Execute: advance each selected card by ONE step ---
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
        // B7: audit memory consolidation
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
        // B7: audit notification
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

  private async executeCard(
    card: WorkCard,
    context: WorkCycleContext,
    rationale: string,
  ): Promise<{ completed: boolean; blocked: boolean }> {
    this.events.record({
      kind: 'mission.task',
      label: `Advancing card: ${card.title}`,
      status: 'started',
      data: { cardId: card.id, rationale, lane: card.lane },
      correlationId: context.correlationId,
    });

    const evidence: string[] = [];
    let blockReason: string | undefined;

    // Run each tool listed on the card
    for (const toolName of card.tools) {
      const tool = this.toolMap.get(toolName);
      if (!tool) {
        const msg = `Tool not registered: ${toolName}`;
        this.events.record({ kind: 'tool.call', label: msg, status: 'error', correlationId: context.correlationId });
        this.audit.record({ correlationId: context.correlationId, category: 'tool-invocation', action: 'tool.missing', status: 'failure', summary: msg });
        blockReason = msg;
        break;
      }

      // B1 fix: use card's typed params for this tool; fall back to {}
      const params = card.toolParams?.[toolName] ?? {};

      // B2 fix: evaluate policy against the actual params and their digest
      const evaluation = this.policy.evaluate(toolName, params, {
        approvalId: context.approvalId,
        approvalActionDigest: context.approvalActionDigest,
      });

      // B7 fix: audit every policy decision
      this.events.record({
        kind: 'policy.decision',
        label: `Policy: ${toolName} → ${evaluation.decision}`,
        status: evaluation.decision === 'allow' ? 'ok' : evaluation.decision === 'approval-required' ? 'partial' : 'error',
        data: { decision: evaluation.decision, reason: evaluation.reason, digest: evaluation.actionDigest },
        correlationId: context.correlationId,
      });
      this.audit.record({
        correlationId: context.correlationId, category: 'policy-decision', action: 'policy.evaluate',
        status: evaluation.decision === 'deny' ? 'failure' : 'info',
        summary: `${toolName}: ${evaluation.decision} — ${evaluation.reason}`,
        details: { digest: evaluation.actionDigest, decision: evaluation.decision },
      });

      if (evaluation.decision === 'deny') {
        blockReason = `Tool denied by policy: ${evaluation.reason}`;
        break;
      }

      if (evaluation.decision === 'approval-required') {
        // B3 fix: create HITL request and invoke the callback
        const approvalReq: ApprovalRequest = await this.hitl.request({
          level: evaluation.policy.approvalLevel ?? 'L2',
          stage: card.lane,
          title: `Approve: ${toolName} for card "${card.title}"`,
          actionType: toolName,
          recipient: this.config.contract.reportsTo,
          bodyPreview: evaluation.actionSummary,
          rationale,
          triggeredBy: card.id,
          tool: toolName,
          toolParams: params,
          evidence: card.evidence,
        });

        this.events.record({ kind: 'hitl.request', label: `Approval required for: ${toolName} (id: ${approvalReq.id})`, status: 'partial', correlationId: context.correlationId });
        this.audit.record({
          correlationId: context.correlationId, category: 'approval-lifecycle', action: 'approval.requested',
          status: 'info', summary: `${evaluation.policy.approvalLevel ?? 'L2'} approval requested for ${toolName}.`,
          details: { approvalId: approvalReq.id, digest: evaluation.actionDigest },
        });

        // Give the consumer the chance to auto-approve (e.g. in tests)
        const autoApproved = this.config.onApprovalRequest
          ? await this.config.onApprovalRequest(approvalReq)
          : false;

        if (!autoApproved) {
          blockReason = `Awaiting ${evaluation.policy.approvalLevel ?? 'L2'} approval for ${toolName}.`;
          break;
        }

        // Re-evaluate with the approval context so the policy gate passes
        context = {
          ...context,
          approvalId: approvalReq.id,
          approvalActionDigest: evaluation.actionDigest,
        };
        // Loop back to re-evaluate (now 'allow' with approval context)
        const reEval = this.policy.evaluate(toolName, params, {
          approvalId: context.approvalId,
          approvalActionDigest: context.approvalActionDigest,
        });
        if (reEval.decision !== 'allow') {
          blockReason = `Re-evaluation after approval still denied: ${reEval.reason}`;
          break;
        }
      }

      const toolStart = Date.now();
      try {
        this.events.record({ kind: 'tool.call', label: `Calling: ${toolName}`, status: 'started', correlationId: context.correlationId });
        // B1 fix: pass the actual typed params to the handler
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
        // B7 fix: audit successful tool invocation
        this.audit.record({
          correlationId: context.correlationId, category: 'tool-invocation', action: 'tool.completed',
          status: 'success', summary: `${toolName} completed in ${durationMs}ms.`,
          details: { durationMs }, durationMs,
        });
        evidence.push(`${toolName} completed in ${durationMs}ms`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.events.record({
          kind: 'tool.result',
          label: `Error: ${toolName}`,
          status: 'error',
          data: { error: msg },
          correlationId: context.correlationId,
        });
        // B7 fix: audit tool failure
        this.audit.record({
          correlationId: context.correlationId, category: 'tool-invocation', action: 'tool.failed',
          status: 'failure', summary: `${toolName} threw: ${msg}`,
        });
        blockReason = `Tool error: ${msg}`;
        break;
      }
    }

    if (blockReason) {
      await this.kanban.block(card.id, blockReason);
      this.audit.record({
        correlationId: context.correlationId, category: 'work-lifecycle', action: 'card.blocked',
        status: 'warning', summary: `Card "${card.title}" blocked: ${blockReason}`,
      });
      return { completed: false, blocked: true };
    }

    // B4 fix: advance ONE lane step and run the artifact judge only at review.
    // Do NOT call complete() here — the next cycle will advance review → done.
    const advanced = await this.kanban.advance(card.id, evidence.length ? evidence : undefined);
    this.audit.record({
      correlationId: context.correlationId, category: 'work-lifecycle', action: 'card.advanced',
      status: 'success', summary: `Card "${card.title}" advanced to ${advanced?.lane ?? 'unknown'}.`,
    });

    if (advanced?.lane === 'review') {
      const evaluation = this.judge.evaluate({
        type: card.cadence ?? 'task',
        title: card.title,
        content: card.summary,
        evidence,
      });
      this.events.record({
        kind: 'artifact.evaluated',
        label: `Artifact: ${card.title} → ${evaluation.verdict} (${evaluation.score}/100)`,
        status: evaluation.verdict === 'blocked' ? 'error' : evaluation.verdict === 'ready' ? 'ok' : 'partial',
        data: { score: evaluation.score, verdict: evaluation.verdict },
        correlationId: context.correlationId,
      });
      // B7 fix: audit artifact evaluation
      this.audit.record({
        correlationId: context.correlationId, category: 'artifact-evaluation', action: 'artifact.judged',
        status: evaluation.verdict === 'blocked' ? 'failure' : 'success',
        summary: `"${card.title}" scored ${evaluation.score}/100: ${evaluation.verdict}.`,
        details: { score: evaluation.score, verdict: evaluation.verdict, checks: evaluation.checks.map((c) => c.id) },
      });

      if (evaluation.verdict === 'blocked') {
        await this.kanban.block(card.id, `Artifact evaluation blocked: ${evaluation.rationale}`);
        return { completed: false, blocked: true };
      }
    }

    const completed = advanced?.lane === 'done';
    if (completed) {
      this.audit.record({
        correlationId: context.correlationId, category: 'work-lifecycle', action: 'card.completed',
        status: 'success', summary: `Card "${card.title}" completed.`, evidence,
      });
    }
    return { completed, blocked: false };
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
