/**
 * WorkReasoner — LLM-driven or deterministic card-advance selection.
 *
 * Each cycle, WorkReasoner picks 1-N work cards to advance. When an LLM is
 * available it asks the model to reason about priority; otherwise it falls
 * back to a deterministic priority sort.
 *
 * Implements the CorpGen "LLM-driven work selection" primitive.
 * Generalised from Morgan's src/mission/cfoWorkReasoner.ts.
 *
 * Copilot SDK alignment: WorkReasoner is the CorpGen equivalent of the
 * Copilot SDK's internal planner. By externalising it as an interface, SDK
 * consumers can swap in their own reasoning strategies.
 */

import type { WorkCard } from '../types';
import type { LlmProvider } from '../adapters/LlmProvider';

export interface CardDecision {
  cardId: string;
  rationale: string;
}

export interface ReasonedDecision {
  mode: 'llm' | 'deterministic';
  summary: string;
  decisions: CardDecision[];
}

export interface WorkReasonerOptions {
  llm?: LlmProvider;
  /** Maximum cards to select per cycle. Defaults to 2. */
  maxCards?: number;
  /** Timeout for LLM calls in ms. Defaults to 18 000. */
  timeoutMs?: number;
  /**
   * Optional system prompt override.
   * When omitted, a sensible generic prompt is used.
   */
  systemPrompt?: string;
}

const DEFAULT_MAX_CARDS = 2;
const DEFAULT_TIMEOUT_MS = 18_000;

const DEFAULT_SYSTEM_PROMPT = `You are an autonomous digital worker running one cycle of your daily operating loop.
You maintain a Kanban board of concrete work cards. Each cycle you advance 1-2 cards ONE step.
Decide which cards to advance next this cycle. Prioritise time-sensitive, business-critical, and mid-flight work.

Rules:
- Choose at most the specified number of cards.
- Prefer variety; do not advance two near-identical cards.
- Unresolved HITL-waiting cards are excluded. Never simulate a human approval.
- Return STRICT JSON only:
{"summary":"<one sentence on this cycle focus>","decisions":[{"cardId":"<id>","rationale":"<short why>"}]}`;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`work-reasoner timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function parseDecisions(raw: string, validIds: Set<string>, max: number): { decisions: CardDecision[]; summary: string } {
  let text = (raw ?? '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  if (!text.startsWith('{')) {
    const brace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (brace >= 0 && lastBrace > brace) text = text.slice(brace, lastBrace + 1);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { decisions: [], summary: '' }; }
  const obj = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
  const summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 400) : '';
  const rawDecisions = Array.isArray(obj.decisions) ? obj.decisions : [];
  const decisions: CardDecision[] = [];
  const seen = new Set<string>();
  for (const item of rawDecisions) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const cardId = String(rec.cardId ?? rec.id ?? '').trim();
    const rationale = String(rec.rationale ?? rec.reason ?? '').trim();
    if (!cardId || !validIds.has(cardId) || seen.has(cardId)) continue;
    seen.add(cardId);
    decisions.push({ cardId, rationale: rationale.slice(0, 240) || 'Selected as next best work to advance.' });
    if (decisions.length >= max) break;
  }
  return { decisions, summary };
}

/** Sort cards deterministically by priority → lane order → age. */
function deterministicSort(cards: WorkCard[]): WorkCard[] {
  const LANE_SCORE: Record<string, number> = { active: 0, review: 1, queue: 2 };
  return cards.slice().sort((a, b) => {
    const laneDiff = (LANE_SCORE[a.lane] ?? 9) - (LANE_SCORE[b.lane] ?? 9);
    if (laneDiff !== 0) return laneDiff;
    const priDiff = (a.priority ?? 3) - (b.priority ?? 3);
    if (priDiff !== 0) return priDiff;
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return aTime - bTime;
  });
}

export class WorkReasoner {
  private readonly llm?: LlmProvider;
  private readonly maxCards: number;
  private readonly timeoutMs: number;
  private readonly systemPrompt: string;

  constructor(options: WorkReasonerOptions = {}) {
    this.llm = options.llm;
    this.maxCards = options.maxCards ?? DEFAULT_MAX_CARDS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  }

  async decide(cards: WorkCard[]): Promise<ReasonedDecision> {
    const movable = cards.filter((c) => c.lane !== 'done' && c.lane !== 'waiting');
    if (!movable.length) return { mode: 'deterministic', summary: 'No movable cards.', decisions: [] };

    if (this.llm) {
      try {
        const validIds = new Set(movable.map((c) => c.id));
        const boardForModel = movable.map((c) => ({
          cardId: c.id, title: c.title, lane: c.lane, priority: c.priority ?? 3,
          hitl: c.hitlLevel ?? null, summary: c.summary,
          waitedMinutes: c.updatedAt
            ? Math.round((Date.now() - new Date(c.updatedAt).getTime()) / 60_000)
            : 0,
        }));

        const response = await withTimeout(
          this.llm.complete({
            messages: [
              { role: 'system', content: this.systemPrompt },
              { role: 'user', content: `Select up to ${this.maxCards} cards to advance:\n${JSON.stringify(boardForModel, null, 2)}` },
            ],
            maxTokens: 700,
            jsonMode: true,
          }),
          this.timeoutMs,
        );

        const { decisions, summary } = parseDecisions(response.content, validIds, this.maxCards);
        if (decisions.length) {
          return { mode: 'llm', summary, decisions };
        }
      } catch {
        // Fall through to deterministic
      }
    }

    // Deterministic fallback
    const sorted = deterministicSort(movable).slice(0, this.maxCards);
    return {
      mode: 'deterministic',
      summary: `Deterministic selection: ${sorted.map((c) => c.title).join(', ')}.`,
      decisions: sorted.map((c) => ({ cardId: c.id, rationale: 'Selected by priority and lane order.' })),
    };
  }
}
