/**
 * WorkLoop — the main autonomous agent cycle engine.
 *
 * Orchestrates the complete CorpGen digital-worker loop:
 *   1. Observe   — restore memory, build context
 *   2. Plan      — generate or refresh work plan
 *   3. Select    — WorkReasoner picks 1-N cards
 *   4. Execute   — tool handlers advance each card
 *   5. Evaluate  — ArtifactJudge scores outputs
 *   6. Record    — update Kanban, emit events, update memory
 *   7. Reflect   — consolidate memory, emit cycle-end event
 *   8. Broadcast — send digest via NotificationProvider (optional)
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
  AgentEvent,
  WorkCard,
  ToolDefinition,
} from '../types';
import { AgentIdentity } from './AgentIdentity';
import { KanbanBoardManager } from './KanbanBoard';
import { WorkReasoner } from './WorkReasoner';
import { MemoryEngine } from '../memory/MemoryEngine';
import { EventBus } from '../observability/EventBus';
import { AuditTrail } from '../observability/AuditTrail';
import { ToolPolicyGateway } from '../governance/ToolPolicy';
import { ArtifactJudge } from '../governance/ArtifactJudge';
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
  private readonly config: WorkLoopConfig;
  private readonly toolMap: Map<string, ToolDefinition>;

  constructor(config: WorkLoopConfig) {
    this.config = config;
    const storage = config.storage ?? new InMemoryStorageProvider();

    this.identity = new AgentIdentity(config.contract);
    this.kanban = new KanbanBoardManager({ storage });
    this.reasoner = new WorkReasoner({ llm: config.llm, maxCards: config.maxCardsPerCycle ?? 2 });
    this.memory = new MemoryEngine({ storage, agentName: config.contract.name });
    this.events = new EventBus({ onEvent: config.onEvent });
    this.audit = new AuditTrail({ agentName: config.contract.name });
    this.policy = new ToolPolicyGateway();
    this.judge = new ArtifactJudge();

    this.toolMap = new Map(config.tools.map((t) => [t.name, t]));
  }

  /**
   * Run one full autonomous workday cycle.
   *
   * The method is the CorpGen equivalent of:
   *   const session = await client.createSession({ ... });
   *   await session.send({ prompt: '...' });
   *   await session.disconnect();
   *
   * @param options.maxCycles  Maximum number of inner execution cycles. Defaults to 10.
   * @param options.forceRun   Override operating-window check.
   */
  async run(options: { maxCycles?: number; forceRun?: boolean } = {}): Promise<WorkdayResult> {
    const correlationId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const maxCycles = options.maxCycles ?? 10;
    const forceRun = options.forceRun ?? this.config.forceRun ?? false;

    // --- Operating window check ---
    if (!forceRun && !this.identity.isOperatingNow()) {
      this.events.record({
        kind: 'cycle.start',
        label: 'WorkLoop skipped — outside operating window.',
        status: 'partial',
        correlationId,
      });
      return this.emptyResult(correlationId, startedAt);
    }

    this.events.record({ kind: 'cycle.start', label: `Workday started for ${this.config.contract.name}`, status: 'started', correlationId });

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
      const board = await this.kanban.getSnapshot();
      const movable = await this.kanban.getMovable();

      if (!movable.length) break; // All done

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

      // --- Execute: advance each selected card ---
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
    }

    // --- Broadcast digest ---
    if (this.config.notifications && this.config.contract.escalationRules.length) {
      // Minimal digest — consumers can extend this via onEvent
      await this.config.notifications.send(this.config.contract.reportsTo, {
        subject: `[${this.config.contract.name}] Workday complete`,
        text: `Cycles: ${cyclesRun} | Cards advanced: ${cardsAdvanced} | Completed: ${cardsCompleted} | Blocked: ${cardsBlocked}`,
      });
    }

    const completedAt = new Date().toISOString();
    this.events.record({ kind: 'cycle.end', label: `Workday complete. ${cardsAdvanced} cards advanced.`, status: 'ok', correlationId });

    const finalBoard = await this.kanban.getSnapshot();
    const finalMemory = memorySummary ?? {
      generatedAt: completedAt,
      workingContext: [],
      structuredMemory: [],
      semanticRecall: [],
      experientialTrajectories: [],
      preservedCriticalContent: [],
      compressionPolicy: 'No cycles run.',
      recordsConsidered: 0,
      eventsConsidered: 0,
    };

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
      data: { cardId: card.id, rationale },
      correlationId: context.correlationId,
    });

    const evidence: string[] = [];
    let encounteredError = false;

    // Invoke each tool listed on the card
    for (const toolName of card.tools) {
      const tool = this.toolMap.get(toolName);
      if (!tool) {
        this.events.record({ kind: 'tool.call', label: `Tool not found: ${toolName}`, status: 'error', correlationId: context.correlationId });
        continue;
      }

      // Policy check
      const evaluation = this.policy.evaluate(toolName, {}, {
        approvalId: context.approvalId,
        approvalActionDigest: context.approvalActionDigest,
      });

      this.events.record({
        kind: 'policy.decision',
        label: `Policy: ${toolName} → ${evaluation.decision}`,
        status: evaluation.decision === 'allow' ? 'ok' : evaluation.decision === 'approval-required' ? 'partial' : 'error',
        data: { decision: evaluation.decision, reason: evaluation.reason },
        correlationId: context.correlationId,
      });

      if (evaluation.decision === 'approval-required' && this.config.onApprovalRequest) {
        // For SDK-level governance, emit hitl.request and skip if not auto-approved
        this.events.record({ kind: 'hitl.request', label: `Approval required for: ${toolName}`, status: 'partial', correlationId: context.correlationId });
        // Note: full HITL lifecycle is handled by HitlGateway; this is the loop's fast path
        encounteredError = true;
        continue;
      }

      if (evaluation.decision === 'deny') {
        encounteredError = true;
        continue;
      }

      const toolStart = Date.now();
      try {
        this.events.record({ kind: 'tool.call', label: `Calling: ${toolName}`, status: 'started', correlationId: context.correlationId });
        const result = await tool.handler({} as never, context);
        const durationMs = Date.now() - toolStart;
        this.events.record({
          kind: 'tool.result',
          label: `Done: ${toolName}`,
          status: 'ok',
          durationMs,
          data: { result: typeof result === 'string' ? result : JSON.stringify(result).slice(0, 300) },
          correlationId: context.correlationId,
        });
        evidence.push(`${toolName} completed in ${durationMs}ms`);
      } catch (err) {
        encounteredError = true;
        this.events.record({
          kind: 'tool.result',
          label: `Error: ${toolName}`,
          status: 'error',
          data: { error: err instanceof Error ? err.message : String(err) },
          correlationId: context.correlationId,
        });
      }
    }

    if (encounteredError) {
      await this.kanban.block(card.id, 'Tool invocation error or approval required.');
      return { completed: false, blocked: true };
    }

    // Advance card state
    await this.kanban.advance(card.id);

    // Check if card moved to review — evaluate the artifact
    const updated = (await this.kanban.getSnapshot()).columns
      .find((col) => col.id === 'review')?.cards.find((c) => c.id === card.id);
    if (updated) {
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
    }

    // Complete the card if it's done
    const snapshot = await this.kanban.getSnapshot();
    const inDone = snapshot.columns.find((col) => col.id === 'done')?.cards.find((c) => c.id === card.id);
    if (!inDone && !updated) {
      // Card advanced past review — mark done
      await this.kanban.complete(card.id, evidence);
      return { completed: true, blocked: false };
    }

    return { completed: false, blocked: false };
  }

  private async loadAllCards(): Promise<WorkCard[]> {
    const board = await this.kanban.getSnapshot();
    return board.columns.flatMap((col) => col.cards);
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
      memorySnapshot: {
        generatedAt: now,
        workingContext: [],
        structuredMemory: [],
        semanticRecall: [],
        experientialTrajectories: [],
        preservedCriticalContent: [],
        compressionPolicy: 'No cycles run.',
        recordsConsidered: 0,
        eventsConsidered: 0,
      },
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
}
