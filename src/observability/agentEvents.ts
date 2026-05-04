export type AgentEventKind =
  | 'llm.turn'
  | 'tool.call'
  | 'tool.result'
  | 'agent.message'
  | 'agent.reply'
  | 'voice.session'
  | 'teams.call'
  | 'mcp.discover'
  | 'mcp.invoke'
  | 'graph.call'
  | 'mission.task';

export interface AgentEvent {
  id: string;
  ts: string;
  kind: AgentEventKind;
  label: string;
  durationMs?: number;
  status?: 'ok' | 'error' | 'partial' | 'started';
  data?: Record<string, unknown>;
  correlationId?: string;
}

const RING_SIZE = 1000;
const events: AgentEvent[] = [];
let sequence = 0;

function nextId(): string {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function safeData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      output[key] = value;
    } else if (typeof value === 'string') {
      output[key] = value.length > 700 ? `${value.slice(0, 700)}...` : value;
    } else if (typeof value === 'object') {
      try {
        const serialized = JSON.stringify(value);
        output[key] = serialized.length > 700 ? `${serialized.slice(0, 700)}...` : value;
      } catch {
        output[key] = '[unserializable]';
      }
    } else {
      output[key] = value;
    }
  }
  return output;
}

export function recordAgentEvent(input: Omit<AgentEvent, 'id' | 'ts'> & { ts?: string }): AgentEvent | null {
  try {
    const event: AgentEvent = {
      id: nextId(),
      ts: input.ts || new Date().toISOString(),
      kind: input.kind,
      label: input.label,
      durationMs: input.durationMs,
      status: input.status,
      data: safeData(input.data),
      correlationId: input.correlationId,
    };
    events.push(event);
    if (events.length > RING_SIZE) events.splice(0, events.length - RING_SIZE);
    return event;
  } catch {
    return null;
  }
}

export function getRecentAgentEvents(options: { limit?: number; kinds?: AgentEventKind[]; sinceId?: string } = {}): AgentEvent[] {
  const limit = Math.max(1, Math.min(options.limit || 200, RING_SIZE));
  let output = events.slice().reverse();
  if (options.sinceId) {
    const index = output.findIndex((event) => event.id === options.sinceId);
    if (index >= 0) output = output.slice(0, index);
  }
  if (options.kinds?.length) {
    const allowed = new Set(options.kinds);
    output = output.filter((event) => allowed.has(event.kind));
  }
  return output.slice(0, limit);
}

export function getAgentEventStats(): { total: number; byKind: Record<string, number>; last5min: number } {
  const fiveMinutesAgo = Date.now() - 5 * 60_000;
  const byKind: Record<string, number> = {};
  let last5min = 0;
  for (const event of events) {
    byKind[event.kind] = (byKind[event.kind] || 0) + 1;
    if (new Date(event.ts).getTime() >= fiveMinutesAgo) last5min++;
  }
  return { total: events.length, byKind, last5min };
}