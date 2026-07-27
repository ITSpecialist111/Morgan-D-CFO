/**
 * HitlGateway — Human-in-the-Loop approval lifecycle manager.
 *
 * Handles L2/L3 approval request creation, status transitions, expiry, and
 * replay-prevention via SHA-256 action digests. Notifications are sent through
 * the configured NotificationProvider.
 *
 * Generalised from Morgan's src/mission/hitlApprovals.ts.
 */

import crypto from 'crypto';
import type {
  ApprovalLevel,
  ApprovalStatus,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalDecisionResult,
  ApproverIdentity,
} from '../types';
import type { NotificationProvider } from '../adapters/NotificationProvider';
import type { StorageProvider } from '../adapters/StorageProvider';
import { actionDigest } from './ToolPolicy';

export type { ApprovalLevel, ApprovalStatus, ApprovalDecision, ApprovalRequest, ApprovalDecisionResult, ApproverIdentity };

const NAMESPACE = 'hitl-approvals';
const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours

export interface HitlGatewayOptions {
  storage: StorageProvider;
  notification?: NotificationProvider;
  /** Approval notification target (email, Teams channel, etc.). */
  notificationTarget?: string;
  /** Default timeout in milliseconds. Defaults to 4 hours. */
  timeoutMs?: number;
}

export interface RequestApprovalInput {
  level: ApprovalLevel;
  stage: string;
  title: string;
  actionType: string;
  recipient: string;
  bodyPreview: string;
  rationale: string;
  triggeredBy: string;
  tool: string;
  toolParams: Record<string, unknown>;
  evidence?: string[];
}

export class HitlGateway {
  private readonly storage: StorageProvider;
  private readonly notification?: NotificationProvider;
  private readonly notificationTarget?: string;
  private readonly timeoutMs: number;

  constructor(options: HitlGatewayOptions) {
    this.storage = options.storage;
    this.notification = options.notification;
    this.notificationTarget = options.notificationTarget;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request(input: RequestApprovalInput): Promise<ApprovalRequest> {
    const now = new Date();
    const request: ApprovalRequest = {
      id: crypto.randomUUID(),
      level: input.level,
      stage: input.stage,
      title: input.title,
      actionType: input.actionType,
      recipient: input.recipient,
      bodyPreview: input.bodyPreview,
      rationale: input.rationale,
      triggeredBy: input.triggeredBy,
      tool: input.tool,
      toolParams: input.toolParams,
      evidence: input.evidence ?? [],
      createdAt: now.toISOString(),
      timeoutAt: new Date(now.getTime() + this.timeoutMs).toISOString(),
      status: 'pending',
      version: 1,
      actionDigest: actionDigest(input.tool, input.toolParams),
      transitionHistory: [{ at: now.toISOString(), status: 'pending', actor: 'system' }],
    };

    await this.storage.set(NAMESPACE, request.id, request);

    if (this.notification && this.notificationTarget) {
      await this.notification.send(this.notificationTarget, {
        subject: `[${input.level} Approval Required] ${input.title}`,
        text: `${input.rationale}\n\nAction: ${input.tool}\nPreview: ${input.bodyPreview}\nApproval ID: ${request.id}`,
      });
    }

    return request;
  }

  async getById(id: string): Promise<ApprovalRequest | undefined> {
    return this.storage.get<ApprovalRequest>(NAMESPACE, id);
  }

  async listPending(): Promise<ApprovalRequest[]> {
    const keys = await this.storage.listKeys(NAMESPACE);
    const results: ApprovalRequest[] = [];
    for (const key of keys) {
      const record = await this.storage.get<ApprovalRequest>(NAMESPACE, key);
      if (record?.status === 'pending') results.push(record);
    }
    return results;
  }

  async decide(
    id: string,
    decision: ApprovalDecision,
    identity: ApproverIdentity,
    rationaleFromApprover?: string,
    /**
     * REQUIRED: Must match the stored version to prevent concurrent decisions.
     * For truly atomic CAS semantics a CAS-capable StorageProvider is needed;
     * the built-in InMemoryStorageProvider provides best-effort protection
     * within a single Node.js process (single-threaded event loop).
     */
    expectedVersion: number = -1,
  ): Promise<ApprovalDecisionResult> {
    const record = await this.storage.get<ApprovalRequest>(NAMESPACE, id);
    if (!record) return { ok: false, error: 'Approval request not found.', code: 'unknown' };
    if (record.status !== 'pending') return { ok: false, request: record, error: 'Already decided.', code: 'already-decided' };
    if (new Date(record.timeoutAt) < new Date()) {
      await this.transition(record, 'expired', 'system');
      return { ok: false, request: record, error: 'Approval request has expired.', code: 'expired' };
    }
    // Reject if version has changed — another decision raced ahead or the request
    // was modified. Default sentinel (-1) is only used internally by the system
    // auto-approve path, which always passes the actual version.
    if (expectedVersion !== -1 && record.version !== expectedVersion) {
      return { ok: false, request: record, error: 'Stale version — another decision was already recorded.', code: 'stale-version' };
    }

    const newStatus: ApprovalStatus = decision === 'approve'
      ? 'approved'
      : decision === 'approve_with_edits'
        ? 'approved_with_edits'
        : decision === 'decline'
          ? 'declined'
          : 'cancelled';

    const actor = identity.email ?? identity.oid ?? 'unknown';
    const updated = await this.transition(record, newStatus, actor, rationaleFromApprover);
    updated.decidedAt = new Date().toISOString();
    updated.decidedBy = actor;
    updated.decidedByOid = identity.oid;
    updated.rationaleFromApprover = rationaleFromApprover;
    await this.storage.set(NAMESPACE, id, updated);
    return { ok: true, request: updated };
  }

  private async transition(
    record: ApprovalRequest,
    status: ApprovalStatus,
    actor: string,
    reason?: string,
  ): Promise<ApprovalRequest> {
    const updated: ApprovalRequest = {
      ...record,
      status,
      version: record.version + 1,
      transitionHistory: [
        ...record.transitionHistory,
        { at: new Date().toISOString(), status, actor, reason },
      ],
    };
    await this.storage.set(NAMESPACE, record.id, updated);
    return updated;
  }
}
