// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { AzureOpenAI } from 'openai';
import { recordAgentEvent } from '../observability/agentEvents';

// LLM-driven decision layer for Morgan's autonomous CFO Kanban.
//
// Given the current movable work cards, Morgan (the model) reasons about which
// 1-2 cards to advance next this cycle and why, instead of following a fixed
// coded routine. This module is deliberately self-contained: it takes a plain
// card summary (no import of missionControl) and returns chosen card ids +
// rationale. If Azure OpenAI is not configured or anything fails, it returns an
// empty decision set so the caller can fall back to the deterministic advance.

export interface WorkCardSummary {
  id: string;
  title: string;
  lane: 'queue' | 'active' | 'waiting' | 'review' | 'done';
  category: string;
  hitlLevel?: 'L2' | 'L3';
  summary: string;
  minutesSinceUpdate: number;
}

export interface CardDecision {
  cardId: string;
  rationale: string;
}

export interface ReasonedAdvanceDecision {
  reasoningMode: 'llm' | 'unavailable';
  summary: string;
  decisions: CardDecision[];
}

const REASONER_TIMEOUT_MS = Number(process.env.MORGAN_WORK_REASONER_TIMEOUT_MS || 18_000);
const REASONER_MAX_CARDS = 2;

function createReasonerClient(): AzureOpenAI | null {
  if (!process.env.AZURE_OPENAI_ENDPOINT) return null;
  try {
    const credential = new DefaultAzureCredential();
    const azureADTokenProvider = getBearerTokenProvider(credential, 'https://cognitiveservices.azure.com/.default');
    return new AzureOpenAI({
      azureADTokenProvider,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview',
      deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5-mini',
    });
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`work-reasoner timed out after ${ms}ms`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function parseDecisions(raw: string, validIds: Set<string>): { decisions: CardDecision[]; summary: string } {
  let text = (raw || '').trim();
  // Strip code fences if the model wrapped the JSON.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  // Fall back to the first {...} block.
  if (!text.startsWith('{')) {
    const brace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (brace >= 0 && lastBrace > brace) text = text.slice(brace, lastBrace + 1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { decisions: [], summary: '' };
  }
  const obj = (parsed && typeof parsed === 'object') ? parsed as Record<string, unknown> : {};
  const summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 400) : '';
  const rawDecisions = Array.isArray(obj.decisions) ? obj.decisions : [];
  const decisions: CardDecision[] = [];
  const seen = new Set<string>();
  for (const item of rawDecisions) {
    if (!item || typeof item !== 'object') continue;
    const cardId = String((item as Record<string, unknown>).cardId || (item as Record<string, unknown>).id || '').trim();
    const rationale = String((item as Record<string, unknown>).rationale || (item as Record<string, unknown>).reason || '').trim();
    if (!cardId || !validIds.has(cardId) || seen.has(cardId)) continue;
    seen.add(cardId);
    decisions.push({ cardId, rationale: rationale.slice(0, 240) || 'Selected as the next best CFO work to advance.' });
    if (decisions.length >= REASONER_MAX_CARDS) break;
  }
  return { decisions, summary };
}

const SYSTEM_PROMPT = `You are Morgan, an autonomous Digital CFO worker running one cycle of your daily operating loop.
You maintain a Kanban board of concrete finance work cards. Each cycle you advance 1-2 cards ONE step.
Decide which cards to advance next this cycle. Reason like a CFO prioritising the office's work.

Priorities, in order:
1. Cards in "waiting" that are blocked on a human-in-the-loop (HITL) approval and have waited a while — these unblock value, so resolve them when they have aged.
2. Time-sensitive board/close/reporting work (board pack, month-end close, weekly digest) that is mid-flight in "active" or "review".
3. Anomaly/variance/cash investigations that protect the business.
4. Pulling new work from "queue" into "active" when the active lane has capacity.

Rules:
- Choose at most 2 cards. Prefer variety (do not advance two near-identical cards).
- Dollar-bearing (L3) and external-send (L2) cards must respect their HITL gate; you may still choose them to move the governed process forward.
- Return STRICT JSON only, no prose, in exactly this shape:
{"summary":"<one sentence on this cycle's focus>","decisions":[{"cardId":"<id>","rationale":"<short why>"}]}`;

export async function decideCardAdvances(cards: WorkCardSummary[]): Promise<ReasonedAdvanceDecision> {
  const movable = cards.filter((card) => card.lane !== 'done');
  if (!movable.length) {
    return { reasoningMode: 'unavailable', summary: '', decisions: [] };
  }
  const client = createReasonerClient();
  if (!client) {
    return { reasoningMode: 'unavailable', summary: '', decisions: [] };
  }

  const validIds = new Set(movable.map((card) => card.id));
  const boardForModel = movable.map((card) => ({
    cardId: card.id,
    title: card.title,
    lane: card.lane,
    category: card.category,
    hitl: card.hitlLevel || null,
    waitedMinutes: card.minutesSinceUpdate,
    summary: card.summary,
  }));

  try {
    const response = await withTimeout(client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Current board cards (advance 1-2 by one step):\n${JSON.stringify(boardForModel, null, 2)}` },
      ],
      max_completion_tokens: 700,
      response_format: { type: 'json_object' },
    }), REASONER_TIMEOUT_MS);

    const content = response.choices?.[0]?.message?.content || '';
    const { decisions, summary } = parseDecisions(content, validIds);
    recordAgentEvent({
      kind: 'llm.turn',
      label: `Autonomous work reasoning selected ${decisions.length} card(s)`,
      status: decisions.length ? 'ok' : 'partial',
      data: {
        reasoningSummary: summary || 'Model returned no actionable card decisions; deterministic fallback will run.',
        toolCalls: decisions.map((decision) => decision.cardId),
        cardsConsidered: movable.length,
      },
    });
    if (!decisions.length) {
      return { reasoningMode: 'unavailable', summary, decisions: [] };
    }
    return { reasoningMode: 'llm', summary, decisions };
  } catch (error) {
    recordAgentEvent({
      kind: 'llm.turn',
      label: 'Autonomous work reasoning failed; using deterministic fallback',
      status: 'error',
      data: { error: error instanceof Error ? error.message : String(error) },
    });
    return { reasoningMode: 'unavailable', summary: '', decisions: [] };
  }
}
