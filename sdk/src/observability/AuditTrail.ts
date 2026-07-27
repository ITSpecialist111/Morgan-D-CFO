/**
 * AuditTrail — structured audit event log with correlation IDs.
 *
 * Produces durable audit records suitable for export to Application Insights,
 * Log Analytics, Purview, or Sentinel. Each record links back to the EventBus
 * ring-buffer event via correlationId.
 *
 * Generalised from Morgan's src/observability/agentAudit.ts.
 */

import crypto from 'crypto';

export type AuditEventCategory =
  | 'work-lifecycle'
  | 'tool-invocation'
  | 'approval-lifecycle'
  | 'memory-operation'
  | 'policy-decision'
  | 'subagent-call'
  | 'notification'
  | 'artifact-evaluation'
  | 'system';

export interface AuditRecord {
  id: string;
  correlationId: string;
  timestamp: string;
  category: AuditEventCategory;
  action: string;
  agentName: string;
  status: 'success' | 'failure' | 'warning' | 'info';
  summary: string;
  details?: Record<string, unknown>;
  /** Human actor who triggered or approved this action, if applicable. */
  actorId?: string;
  actorEmail?: string;
  durationMs?: number;
  evidence?: string[];
}

export interface AuditTrailOptions {
  agentName: string;
  /** Called synchronously after each audit record is written. */
  onRecord?: (record: AuditRecord) => void;
  /** Maximum records kept in memory. Defaults to 500. */
  maxRecords?: number;
}

export class AuditTrail {
  private readonly agentName: string;
  private readonly onRecord?: (record: AuditRecord) => void;
  private readonly maxRecords: number;
  private readonly records: AuditRecord[] = [];

  constructor(options: AuditTrailOptions) {
    this.agentName = options.agentName;
    this.onRecord = options.onRecord;
    this.maxRecords = options.maxRecords ?? 500;
  }

  record(input: Omit<AuditRecord, 'id' | 'timestamp' | 'agentName'>): AuditRecord {
    const record: AuditRecord = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      agentName: this.agentName,
      ...input,
    };
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    this.onRecord?.(record);
    return record;
  }

  getRecent(options: { limit?: number; category?: AuditEventCategory; correlationId?: string } = {}): AuditRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, this.maxRecords));
    let output = this.records.slice().reverse();
    if (options.category) {
      output = output.filter((record) => record.category === options.category);
    }
    if (options.correlationId) {
      output = output.filter((record) => record.correlationId === options.correlationId);
    }
    return output.slice(0, limit);
  }

  drain(): AuditRecord[] {
    return this.records.slice();
  }
}
