/**
 * EventBus — ring-buffered agent event stream.
 *
 * Compatible with GitHub Copilot SDK session event pattern:
 *   session.on('assistant.message', handler)
 *   session.on('tool.call', handler)
 *
 * CorpGen extension adds: cycle.start, cycle.end, mission.task, hitl.*,
 * subagent.*, memory.update, artifact.evaluated, plan.generated, policy.decision.
 *
 * Extracted and generalised from Morgan's src/observability/agentEvents.ts.
 */

import crypto from 'crypto';
import type { AgentEvent, AgentEventKind } from '../types';

const DEFAULT_RING_SIZE = 1000;

function nextId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function safeData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) {
      output[key] = value;
    } else if (typeof value === 'string') {
      output[key] = truncate(value, 700);
    } else if (typeof value === 'object') {
      try {
        const serialized = JSON.stringify(value);
        output[key] = serialized.length > 700 ? `${truncate(serialized, 700)}` : value;
      } catch {
        output[key] = '[unserializable]';
      }
    } else {
      output[key] = value;
    }
  }
  return output;
}

export interface EventBusOptions {
  /** Maximum number of events retained in the ring buffer. Defaults to 1000. */
  ringSize?: number;
  /**
   * Global event handler — called synchronously after every recorded event.
   * Analogous to session.on('*', handler) in the Copilot SDK.
   */
  onEvent?: (event: AgentEvent) => void;
}

export class EventBus {
  private readonly ringSize: number;
  private readonly onEvent?: (event: AgentEvent) => void;
  private readonly events: AgentEvent[] = [];

  constructor(options: EventBusOptions = {}) {
    this.ringSize = options.ringSize ?? DEFAULT_RING_SIZE;
    this.onEvent = options.onEvent;
  }

  /**
   * Record an agent event.
   * Analogous to emitting a session event in the Copilot SDK.
   */
  record(input: Omit<AgentEvent, 'id' | 'ts'> & { ts?: string }): AgentEvent | null {
    try {
      const event: AgentEvent = {
        id: nextId(),
        ts: input.ts ?? new Date().toISOString(),
        kind: input.kind,
        label: input.label,
        durationMs: input.durationMs,
        status: input.status,
        data: safeData(input.data),
        correlationId: input.correlationId,
      };
      this.events.push(event);
      if (this.events.length > this.ringSize) {
        this.events.splice(0, this.events.length - this.ringSize);
      }
      this.onEvent?.(event);
      return event;
    } catch {
      return null;
    }
  }

  /**
   * Retrieve recent events, optionally filtered by kind or sinceId.
   * Analogous to reading session history in the Copilot SDK.
   */
  getRecent(options: { limit?: number; kinds?: AgentEventKind[]; sinceId?: string } = {}): AgentEvent[] {
    const limit = Math.max(1, Math.min(options.limit ?? 200, this.ringSize));
    let output = this.events.slice().reverse();
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

  /** Summary statistics over the ring buffer. */
  getStats(): { total: number; byKind: Record<string, number>; last5min: number } {
    const fiveMinutesAgo = Date.now() - 5 * 60_000;
    const byKind: Record<string, number> = {};
    let last5min = 0;
    for (const event of this.events) {
      byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
      if (new Date(event.ts).getTime() >= fiveMinutesAgo) last5min++;
    }
    return { total: this.events.length, byKind, last5min };
  }

  /** Drain all events — useful for workday result snapshots. */
  drain(): AgentEvent[] {
    return this.events.slice();
  }
}
