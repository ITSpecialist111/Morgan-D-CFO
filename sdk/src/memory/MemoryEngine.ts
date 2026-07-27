/**
 * MemoryEngine — tiered memory with adaptive summarisation.
 *
 * Implements the CorpGen "tiered memory" primitive across four layers:
 *   1. Working context    — what the agent is doing right now
 *   2. Structured memory  — completed / blocked work records
 *   3. Semantic recall    — retrieval cues for past knowledge
 *   4. Preserved content  — critical facts kept verbatim (numbers, deadlines)
 *
 * The engine produces a MemorySummary at the end of each work cycle so the
 * next cycle starts with compressed, contextually relevant state rather than
 * a raw dump of all prior events.
 *
 * Generalised from Morgan's getAdaptiveMemorySummary in missionControl.ts.
 */

import type { MemorySummary, AgentEvent, WorkCard } from '../types';
import type { StorageProvider } from '../adapters/StorageProvider';

const NAMESPACE = 'memory';
const WORKING_KEY = 'working-context';
const STRUCTURED_KEY = 'structured-memory';
const SEMANTIC_KEY = 'semantic-recall';
const EXPERIENTIAL_KEY = 'experiential-trajectories';
const PRESERVED_KEY = 'preserved-content';

/** Maximum items per memory tier before compression kicks in. */
const MAX_TIER_ITEMS = 20;

export interface MemoryEngineOptions {
  storage: StorageProvider;
  agentName: string;
  /** Maximum items per tier. Defaults to 20. */
  maxTierItems?: number;
}

export class MemoryEngine {
  private readonly storage: StorageProvider;
  private readonly agentName: string;
  private readonly maxItems: number;

  constructor(options: MemoryEngineOptions) {
    this.storage = options.storage;
    this.agentName = options.agentName;
    this.maxItems = options.maxTierItems ?? MAX_TIER_ITEMS;
  }

  /**
   * Produce a MemorySummary from the current tier state plus any new cycle
   * data. Call at the END of each work cycle.
   *
   * @param events   Events emitted during the just-completed cycle.
   * @param cards    Current state of the Kanban board.
   */
  async summarize(events: AgentEvent[], cards: WorkCard[]): Promise<MemorySummary> {
    const now = new Date().toISOString();

    // --- Working context: active and recently-updated cards (no cap) ---
    const active = cards.filter((c) => c.lane === 'active');
    const workingContext = active.map((c) => `[${c.id}] ${c.title}: ${c.summary}`);

    // NB4 fix: reserve capacity for blockers first, then fill with completed.
    // This ensures "errors and blockers always retained" is actually true.
    const blocked = cards.filter((c) => c.lane === 'waiting');
    const blockedEntries = blocked.map((c) => `BLOCKED [${c.id}] ${c.title}: ${c.summary}`);
    const remainingCapacity = Math.max(0, this.maxItems - blockedEntries.length);
    const completed = cards.filter((c) => c.lane === 'done').slice(-remainingCapacity);
    const structuredMemory = [
      ...blockedEntries,
      ...completed.map((c) => `DONE [${c.id}] ${c.title} — evidence: ${c.evidence.join(', ') || 'none'}`),
    ];

    // --- Semantic recall: cues derived from recent events ---
    const recentToolCalls = events
      .filter((e) => e.kind === 'tool.call' || e.kind === 'tool.result')
      .slice(-10)
      .map((e) => e.label);
    const semanticRecall = recentToolCalls.length
      ? [`Recent tool calls: ${recentToolCalls.join(', ')}`]
      : [];

    // --- Experiential trajectories: persisted from prior cycles ---
    const priorTrajectories = (await this.storage.get<string[]>(NAMESPACE, EXPERIENTIAL_KEY)) ?? [];
    // Retain error events from this cycle; errors are important signals
    const errorEvents = events.filter((e) => e.status === 'error').map((e) => `ERROR: ${e.label}`);
    const newTrajectories = [...priorTrajectories, ...errorEvents].slice(-this.maxItems);
    await this.storage.set(NAMESPACE, EXPERIENTIAL_KEY, newTrajectories);

    // --- Preserved content: critical facts (numbers, deadlines) ---
    const priorPreserved = (await this.storage.get<string[]>(NAMESPACE, PRESERVED_KEY)) ?? [];
    const preservedCriticalContent = priorPreserved.slice(-this.maxItems);

    const summary: MemorySummary = {
      generatedAt: now,
      workingContext,
      structuredMemory,
      semanticRecall,
      experientialTrajectories: newTrajectories,
      preservedCriticalContent,
      compressionPolicy: `Blockers reserved first (${blockedEntries.length}); completed fill remaining capacity of ${this.maxItems}. Errors always retained.`,
      recordsConsidered: cards.length,
      eventsConsidered: events.length,
    };

    // Persist the summary so it survives across cycle boundaries
    await this.storage.set(NAMESPACE, WORKING_KEY, workingContext);
    await this.storage.set(NAMESPACE, STRUCTURED_KEY, structuredMemory);
    await this.storage.set(NAMESPACE, SEMANTIC_KEY, semanticRecall);
    await this.storage.set(NAMESPACE, PRESERVED_KEY, preservedCriticalContent);

    return summary;
  }

  /** Restore the most recent persisted MemorySummary on agent startup. */
  async restore(): Promise<Partial<MemorySummary>> {
    const [working, structured, semantic, experiential, preserved] = await Promise.all([
      this.storage.get<string[]>(NAMESPACE, WORKING_KEY),
      this.storage.get<string[]>(NAMESPACE, STRUCTURED_KEY),
      this.storage.get<string[]>(NAMESPACE, SEMANTIC_KEY),
      this.storage.get<string[]>(NAMESPACE, EXPERIENTIAL_KEY),
      this.storage.get<string[]>(NAMESPACE, PRESERVED_KEY),
    ]);
    return {
      workingContext: working ?? [],
      structuredMemory: structured ?? [],
      semanticRecall: semantic ?? [],
      experientialTrajectories: experiential ?? [],
      preservedCriticalContent: preserved ?? [],
    };
  }

  /** Preserve a critical fact (number, deadline, decision) verbatim. */
  async preserve(fact: string): Promise<void> {
    const existing = (await this.storage.get<string[]>(NAMESPACE, PRESERVED_KEY)) ?? [];
    const updated = [...existing, `${new Date().toISOString()} — ${fact}`].slice(-this.maxItems);
    await this.storage.set(NAMESPACE, PRESERVED_KEY, updated);
  }
}
