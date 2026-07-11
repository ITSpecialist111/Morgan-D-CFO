import type { ChatCompletionTool } from 'openai/resources/chat';
import type { TurnContext } from '@microsoft/agents-hosting';
import { Activity, ActivityTypes } from '@microsoft/agents-activity';
import crypto from 'crypto';
import { recordAgentEvent } from '../observability/agentEvents';
import { recordAuditEvent } from '../observability/agentAudit';
import { sendTeamsMessage, type TeamsMessageResult } from '../tools/mcpToolSetup';
import { actionDigest } from '../governance/toolPolicy';
import { getHitlApprovalStorage, getHitlApprovalStorageStatus, type StoredApprovalRecord } from '../storage/hitlApprovalStorage';

export type HitlApprovalLevel = 'L2' | 'L3';
export type HitlApprovalStatus = 'pending' | 'approved' | 'approved_with_edits' | 'declined' | 'cancelled' | 'expired' | 'executing' | 'executed' | 'failed';
export type HitlApprovalDecision = 'approve' | 'approve_with_edits' | 'decline' | 'cancel';

export interface HitlApprovalRequest {
  id: string;
  caseId: string;
  customer: string;
  level: HitlApprovalLevel;
  stage: string;
  title: string;
  actionType: string;
  recipient: string;
  sponsor: string;
  subject: string;
  bodyPreview: string;
  rationale: string;
  triggeredBy: string;
  specialist: string;
  tool: string;
  evidence: string[];
  createdAt: string;
  timeoutAt: string;
  status: HitlApprovalStatus;
  version: number;
  action: { tool: string; params: Record<string, unknown> };
  actionDigest: string;
  decisionNonce?: string;
  transitionHistory: Array<{ at: string; status: HitlApprovalStatus; actor: string; reason?: string }>;
  decidedAt?: string;
  decidedBy?: string;
  decidedByOid?: string;
  decidedByTenantId?: string;
  rationaleFromApprover?: string;
  editedBody?: string;
}

export interface HitlApprovalDecisionResult {
  ok: boolean;
  request?: HitlApprovalRequest;
  error?: string;
  code?: 'unknown' | 'already-decided' | 'expired' | 'unauthorized' | 'stale-version' | 'digest-mismatch' | 'invalid-signature' | 'storage-error';
}

export interface HitlApproverIdentity {
  oid?: string;
  tenantId?: string;
  email?: string;
  name?: string;
}

export interface HitlApprovalCardDeliveryResult {
  ok: boolean;
  adaptiveCardSent: boolean;
  requestCount: number;
  targetLabel: string;
  source: string;
  messageId?: string;
  error?: string;
  adaptiveCard?: Record<string, unknown>;
  fallbackText?: string;
}

export interface HitlApprovalCardSubmitResult {
  handled: boolean;
  reply: string;
  decision?: HitlApprovalDecision;
  result?: HitlApprovalDecisionResult;
}

const seededAt = new Date().toISOString();
const timeoutAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

function seededRequest(input: Omit<HitlApprovalRequest, 'version' | 'action' | 'actionDigest' | 'transitionHistory'> & {
  action: { tool: string; params: Record<string, unknown> };
}): HitlApprovalRequest {
  return {
    ...input,
    version: 1,
    actionDigest: actionDigest(input.action.tool, input.action.params),
    transitionHistory: [{ at: input.createdAt, status: input.status, actor: 'Morgan demo seed', reason: 'Seeded showcase approval.' }],
  };
}

const seededApprovalRequests: HitlApprovalRequest[] = [
  seededRequest({
    id: 'approval-pnl-board-report-l2',
    caseId: 'FIN-2026-0041',
    customer: 'Group FP&A',
    level: 'L2',
    stage: 'Reporting',
    title: 'Send board-ready P&L report to CFO distribution list',
    actionType: 'Send external report',
    recipient: 'CFO distribution list',
    sponsor: 'Graham Hosking',
    subject: 'FIN-2026-0041 board-ready P&L distribution',
    bodyPreview: 'Morgan prepared the board-ready Q3 P&L report and recommends sending it to the CFO distribution list. The pack reconciles to the ledger and includes commentary on the 4.2% revenue beat and gross-margin movement.',
    rationale: 'The report leaves Finance to an external distribution list, so L2 approval is required before Morgan sends it.',
    triggeredBy: 'getFinancialKPIs',
    specialist: 'Reporting Analyst',
    tool: 'sendEmail draft / createWordDocument',
    evidence: ['reportReadiness: 100%', 'ledgerReconciled: true', 'revenueVariancePct: +4.2', 'recipients: 6'],
    createdAt: seededAt,
    timeoutAt,
    status: 'pending',
    action: { tool: 'sendEmail', params: { to: 'CFO distribution list', subject: 'FIN-2026-0041 board-ready P&L distribution', body: '[board-ready P&L artifact]' } },
  }),
  seededRequest({
    id: 'approval-budget-reforecast-l3',
    caseId: 'FIN-2026-0042',
    customer: 'Corporate FP&A',
    level: 'L3',
    stage: 'Forecast',
    title: 'Approve $250k budget reforecast commitment',
    actionType: 'Commit budget reforecast',
    recipient: 'Finance leadership / budget owners',
    sponsor: 'Graham Hosking',
    subject: 'FIN-2026-0042 $250k budget reforecast commitment',
    bodyPreview: 'Morgan recommends committing a $250k reforecast that moves spend from underused marketing lines into cloud infrastructure to cover the H2 demand uplift. The reforecast holds the full-year operating budget flat.',
    rationale: 'The action commits a material $250k budget change. It is a dollar-bearing decision and requires L3 approval before Morgan posts the reforecast.',
    triggeredBy: 'analyzeBudgetVsActuals',
    specialist: 'Forecast Planner',
    tool: 'createWordDocument / sendEmail draft',
    evidence: ['reforecastUsd: 250000', 'fullYearBudgetImpactUsd: 0', 'confidence: high', 'driver: H2 demand uplift'],
    createdAt: seededAt,
    timeoutAt,
    status: 'pending',
    action: { tool: 'commitBudgetReforecast', params: { amountUsd: 250000, caseId: 'FIN-2026-0042' } },
  }),
  seededRequest({
    id: 'approval-variance-summary-l2',
    caseId: 'FIN-2026-0043',
    customer: 'Finance Leadership',
    level: 'L2',
    stage: 'Reporting',
    title: 'Post Q3 variance summary to Finance Teams channel',
    actionType: 'Post to Teams channel',
    recipient: 'Finance Teams channel',
    sponsor: 'Graham Hosking',
    subject: 'FIN-2026-0043 Q3 variance summary post',
    bodyPreview: 'Morgan drafted a Q3 budget-vs-actuals variance summary highlighting the +4.2% revenue beat and a 1.8pt opex overrun in cloud spend, and recommends posting it to the Finance Teams channel ahead of the leadership review.',
    rationale: 'The summary is broadcast to a shared Finance Teams channel beyond the immediate desk, so L2 approval is required before Morgan posts it.',
    triggeredBy: 'detectAnomalies',
    specialist: 'Variance Analyst',
    tool: 'sendTeamsMessage',
    evidence: ['revenueVariancePct: +4.2', 'opexOverrunPct: 1.8', 'channel: Finance Leadership', 'period: Q3'],
    createdAt: seededAt,
    timeoutAt,
    status: 'pending',
    action: { tool: 'sendTeamsMessage', params: { channel_id: 'Finance Leadership', subject: 'FIN-2026-0043 Q3 variance summary post', message: '[Q3 variance summary]' } },
  }),
  seededRequest({
    id: 'approval-vendor-payment-l3',
    caseId: 'FIN-2026-0044',
    customer: 'Accounts Payable',
    level: 'L3',
    stage: 'Payments',
    title: 'Release vendor payment approval memo',
    actionType: 'Release payment approval',
    recipient: 'Accounts Payable / vendor',
    sponsor: 'Graham Hosking',
    subject: 'FIN-2026-0044 vendor payment approval memo',
    bodyPreview: 'Morgan prepared the approval memo to release a $180k milestone payment to the cloud infrastructure vendor. The milestone is evidenced by the signed delivery acceptance and matches the contracted schedule.',
    rationale: 'Releasing a vendor payment moves money out of the business, so this dollar-bearing action requires L3 approval before Morgan releases the memo.',
    triggeredBy: 'analyzeBudgetVsActuals',
    specialist: 'Payments Controller',
    tool: 'sendEmail draft / createWordDocument',
    evidence: ['paymentUsd: 180000', 'milestoneAccepted: true', 'contractMatch: true', 'vendor: Cloud Infrastructure Co'],
    createdAt: seededAt,
    timeoutAt,
    status: 'pending',
    action: { tool: 'releaseVendorPayment', params: { amountUsd: 180000, caseId: 'FIN-2026-0044' } },
  }),
];

function isApprovalRequest(value: StoredApprovalRecord): value is HitlApprovalRequest & StoredApprovalRecord {
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate.id === 'string'
    && typeof candidate.status === 'string'
    && typeof candidate.version === 'number'
    && typeof candidate.actionDigest === 'string'
    && Boolean(candidate.action && typeof candidate.action === 'object');
}

function loadApprovalRequests(): Map<string, HitlApprovalRequest> {
  const storage = getHitlApprovalStorage();
  const stored = storage.load();
  if (stored.length) {
    const requests = stored.filter(isApprovalRequest);
    if (requests.length !== stored.length) throw new Error('HITL approval store contains unsupported records.');
    return new Map(requests.map((request) => [request.id, request]));
  }
  const shouldSeed = process.env.MORGAN_SEED_DEMO_APPROVALS === 'true'
    || (process.env.NODE_ENV === 'development' && process.env.MORGAN_SEED_DEMO_APPROVALS !== 'false');
  const initial = shouldSeed ? seededApprovalRequests : [];
  storage.save(initial);
  return new Map(initial.map((request) => [request.id, request]));
}

const approvalRequests = loadApprovalRequests();

function persistApprovalRequests(): HitlApprovalDecisionResult | undefined {
  try {
    getHitlApprovalStorage().save(Array.from(approvalRequests.values()));
    return undefined;
  } catch (error) {
    return { ok: false, code: 'storage-error', error: error instanceof Error ? error.message : String(error) };
  }
}

function configuredList(name: string): string[] {
  return (process.env[name] || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
}

export function isAuthorizedHitlApprover(identity: HitlApproverIdentity): boolean {
  if (process.env.NODE_ENV === 'development' && identity.oid === 'local-development') return true;
  const oidAllowlist = configuredList('MORGAN_HITL_APPROVER_OIDS');
  const emailAllowlist = configuredList('MORGAN_HITL_APPROVER_EMAILS');
  const expectedTenant = (process.env.MORGAN_HITL_APPROVER_TENANT_ID || process.env.MicrosoftAppTenantId || '').toLowerCase();
  if (expectedTenant && (!identity.tenantId || identity.tenantId.toLowerCase() !== expectedTenant)) return false;
  if (oidAllowlist.length) return Boolean(identity.oid && oidAllowlist.includes(identity.oid.toLowerCase()));
  if (emailAllowlist.length) return Boolean(identity.email && emailAllowlist.includes(identity.email.toLowerCase()));
  return process.env.MORGAN_HITL_REQUIRE_EXPLICIT_APPROVERS === 'false' && Boolean(identity.oid);
}

function approvalSigningSecret(): string | undefined {
  return process.env.MORGAN_HITL_SIGNING_SECRET;
}

function signApprovalValue(value: string): string | undefined {
  const secret = approvalSigningSecret();
  return secret ? crypto.createHmac('sha256', secret).update(value).digest('base64url') : undefined;
}

function signaturesMatch(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signedDecisionToken(request: HitlApprovalRequest, decision: HitlApprovalDecision): string | undefined {
  const payload = Buffer.from(JSON.stringify({
    approvalId: request.id,
    version: request.version,
    actionDigest: request.actionDigest,
    decision,
    exp: new Date(request.timeoutAt).getTime(),
  })).toString('base64url');
  const signature = signApprovalValue(payload);
  return signature ? `${payload}.${signature}` : undefined;
}

function verifyDecisionToken(token: string | undefined, request: HitlApprovalRequest, decision: HitlApprovalDecision): boolean {
  if (!approvalSigningSecret()) return process.env.NODE_ENV === 'development';
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = signApprovalValue(payload);
  if (!expected || !signaturesMatch(expected, signature)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    return decoded.approvalId === request.id
      && decoded.version === request.version
      && decoded.actionDigest === request.actionDigest
      && decoded.decision === decision
      && typeof decoded.exp === 'number'
      && decoded.exp >= Date.now();
  } catch {
    return false;
  }
}

function configuredBaseUrl(): string {
  const localBaseUrl = `localhost:${process.env.PORT || '3978'}`;
  const raw = process.env.BASE_URL
    || process.env.PUBLIC_HOSTNAME
    || (process.env.NODE_ENV === 'development' ? localBaseUrl : process.env.WEBSITE_HOSTNAME)
    || localBaseUrl;
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/$/, '');
  const protocol = raw.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${raw.replace(/\/$/, '')}`;
}

function mapDecisionToStatus(decision: HitlApprovalDecision): HitlApprovalStatus {
  if (decision === 'approve') return 'approved';
  if (decision === 'approve_with_edits') return 'approved_with_edits';
  if (decision === 'decline') return 'declined';
  return 'cancelled';
}

function expirePendingApprovals(): void {
  const now = Date.now();
  let changed = false;
  for (const [id, request] of approvalRequests) {
    if (request.status !== 'pending' || new Date(request.timeoutAt).getTime() >= now) continue;
    const at = new Date().toISOString();
    approvalRequests.set(id, {
      ...request,
      status: 'expired',
      version: request.version + 1,
      transitionHistory: [...request.transitionHistory, { at, status: 'expired', actor: 'Morgan policy gateway', reason: 'Approval window elapsed.' }],
    });
    changed = true;
  }
  if (changed) persistApprovalRequests();
}

export function listHitlApprovalRequests(params: { status?: HitlApprovalStatus | 'open' | 'all'; level?: HitlApprovalLevel; includeDecisionTokens?: boolean } = {}) {
  expirePendingApprovals();
  const status = params.status || 'open';
  const requests = Array.from(approvalRequests.values())
    .filter((request) => !params.level || request.level === params.level)
    .filter((request) => {
      if (status === 'all') return true;
      if (status === 'open') return request.status === 'pending';
      return request.status === status;
    })
    .sort((a, b) => a.timeoutAt.localeCompare(b.timeoutAt));
  return {
    generatedAt: new Date().toISOString(),
    approvalSurfaceUrl: `${configuredBaseUrl()}/approvals`,
    pendingCount: requests.filter((request) => request.status === 'pending').length,
    storage: getHitlApprovalStorageStatus(),
    enforcement: {
      mode: 'server-side-policy',
      approverAllowlistConfigured: configuredList('MORGAN_HITL_APPROVER_OIDS').length > 0 || configuredList('MORGAN_HITL_APPROVER_EMAILS').length > 0,
      signedCardActions: Boolean(approvalSigningSecret()),
      singleInstanceOnly: true,
    },
    requests: requests.map((request) => ({
      ...request,
      decisionTokens: params.includeDecisionTokens && request.status === 'pending' ? {
        approve: signedDecisionToken(request, 'approve'),
        approve_with_edits: signedDecisionToken(request, 'approve_with_edits'),
        decline: signedDecisionToken(request, 'decline'),
        cancel: signedDecisionToken(request, 'cancel'),
      } : undefined,
    })),
  };
}

export function getHitlApprovalSurface(params: { requestId?: string } = {}) {
  const url = `${configuredBaseUrl()}/approvals${params.requestId ? `#${encodeURIComponent(params.requestId)}` : ''}`;
  const open = listHitlApprovalRequests({ status: 'open' });
  return {
    ok: true,
    url,
    pendingCount: open.pendingCount,
    requests: params.requestId
      ? open.requests.filter((request) => request.id === params.requestId)
      : open.requests,
  };
}

export function requestHitlApproval(params: {
  level: HitlApprovalLevel;
  action: { tool: string; params: Record<string, unknown> };
  title?: string;
  actionType?: string;
  recipient?: string;
  rationale?: string;
  evidence?: string[];
  triggeredBy?: string;
  expiresInMinutes?: number;
  expiresAt?: string;
}): HitlApprovalDecisionResult {
  const digest = actionDigest(params.action.tool, params.action.params);
  const existing = Array.from(approvalRequests.values()).find((request) =>
    request.status === 'pending'
    && request.actionDigest === digest
    && new Date(request.timeoutAt).getTime() >= Date.now(),
  );
  if (existing) return { ok: true, request: existing };

  const now = new Date();
  const createdAt = now.toISOString();
  const timeoutAtValue = params.expiresAt || new Date(now.getTime() + Math.max(5, params.expiresInMinutes || 240) * 60_000).toISOString();
  const safeActionParams = Object.fromEntries(Object.entries(params.action.params).map(([key, value]) => {
    if (/body|message|content|instructions|notes/i.test(key) && typeof value === 'string') {
      return [key, `[redacted content: ${Buffer.byteLength(value, 'utf8')} bytes; sha256 ${crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)}…]`];
    }
    return [key, value];
  }));
  const request: HitlApprovalRequest = {
    id: `approval-${params.level.toLowerCase()}-${crypto.randomUUID()}`,
    caseId: `MORGAN-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    customer: 'Morgan governed execution',
    level: params.level,
    stage: 'Policy gate',
    title: params.title || `${params.level} approval required for ${params.action.tool}`,
    actionType: params.actionType || params.action.tool,
    recipient: params.recipient || summarizeApprovalRecipient(params.action.params),
    sponsor: 'CFO / Finance Approver',
    subject: params.title || `${params.level} approval required`,
    bodyPreview: `Morgan has prepared ${params.action.tool} but has not executed it. The action digest is ${digest.slice(0, 12)}…`,
    rationale: params.rationale || `${params.level} server-side policy requires an authorized human decision before execution.`,
    triggeredBy: params.triggeredBy || 'tool-policy-gateway',
    specialist: 'Morgan policy gateway',
    tool: params.action.tool,
    evidence: params.evidence || [`actionDigest: ${digest}`, `tool: ${params.action.tool}`],
    createdAt,
    timeoutAt: timeoutAtValue,
    status: 'pending',
    version: 1,
    action: { tool: params.action.tool, params: safeActionParams },
    actionDigest: digest,
    transitionHistory: [{ at: createdAt, status: 'pending', actor: 'Morgan policy gateway', reason: params.rationale }],
  };
  approvalRequests.set(request.id, request);
  const storageError = persistApprovalRequests();
  if (storageError) {
    approvalRequests.delete(request.id);
    return storageError;
  }
  recordAuditEvent({
    kind: 'hitl.approval.requested',
    label: `${params.level} approval requested for ${params.action.tool}`,
    correlationId: request.id,
    actor: 'Morgan policy gateway',
    data: { requestId: request.id, level: request.level, tool: request.action.tool, actionDigest: request.actionDigest },
  });
  return { ok: true, request };
}

function summarizeApprovalRecipient(params: Record<string, unknown>): string {
  const value = params.to || params.recipient || params.channel_id || params.teams_user_aad_oid || params.assigned_to;
  if (Array.isArray(value)) return value.map(String).join(', ').slice(0, 160) || 'Configured destination';
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : 'Configured destination';
}

export function recordHitlApprovalDecision(params: {
  requestId: string;
  decision: HitlApprovalDecision;
  identity: HitlApproverIdentity;
  rationale?: string;
  editedBody?: string;
  expectedVersion?: number;
  expectedActionDigest?: string;
  decisionToken?: string;
}): HitlApprovalDecisionResult {
  const request = approvalRequests.get(params.requestId);
  if (!request) return { ok: false, code: 'unknown', error: `Unknown HITL approval request: ${params.requestId}` };
  if (!isAuthorizedHitlApprover(params.identity)) {
    return { ok: false, code: 'unauthorized', request, error: 'The signed-in identity is not authorized to decide Morgan finance approvals.' };
  }
  if (request.status === 'expired' || new Date(request.timeoutAt).getTime() < Date.now()) {
    return { ok: false, code: 'expired', request, error: 'This approval request has expired. Morgan must create a fresh request before execution.' };
  }
  if (request.status !== 'pending') return { ok: false, code: 'already-decided', request, error: `Request is already ${request.status}` };
  if (params.expectedVersion !== undefined && params.expectedVersion !== request.version) {
    return { ok: false, code: 'stale-version', request, error: `Approval version changed from ${params.expectedVersion} to ${request.version}; refresh before deciding.` };
  }
  if (params.expectedActionDigest && params.expectedActionDigest !== request.actionDigest) {
    return { ok: false, code: 'digest-mismatch', request, error: 'The approved action no longer matches the action shown to the approver.' };
  }
  if (!verifyDecisionToken(params.decisionToken, request, params.decision)) {
    return { ok: false, code: 'invalid-signature', request, error: 'The approval action signature is invalid or expired.' };
  }

  const now = new Date().toISOString();
  const actor = params.identity.name || params.identity.email || params.identity.oid || 'Authorized finance approver';
  let approvedAction = request.action;
  let approvedDigest = request.actionDigest;
  if (params.decision === 'approve_with_edits') {
    if (!params.editedBody?.trim()) {
      return { ok: false, code: 'digest-mismatch', request, error: 'Approve with edits requires the exact edited content.' };
    }
    const contentKey = Object.keys(request.action.params).find((key) => /body|message|content|instructions|notes/i.test(key));
    if (!contentKey) {
      return { ok: false, code: 'digest-mismatch', request, error: 'This action does not expose an editable content field; create a fresh approval request.' };
    }
    const exactEditedParams = { ...request.action.params, [contentKey]: params.editedBody };
    approvedDigest = actionDigest(request.action.tool, exactEditedParams);
    approvedAction = {
      tool: request.action.tool,
      params: {
        ...request.action.params,
        [contentKey]: `[approved edited content: ${Buffer.byteLength(params.editedBody, 'utf8')} bytes; sha256 ${crypto.createHash('sha256').update(params.editedBody).digest('hex').slice(0, 12)}…]`,
      },
    };
  }
  const updated: HitlApprovalRequest = {
    ...request,
    status: mapDecisionToStatus(params.decision),
    version: request.version + 1,
    decidedAt: now,
    decidedBy: actor,
    decidedByOid: params.identity.oid,
    decidedByTenantId: params.identity.tenantId,
    rationaleFromApprover: params.rationale,
    editedBody: params.editedBody,
    action: approvedAction,
    actionDigest: approvedDigest,
    transitionHistory: [
      ...request.transitionHistory,
      { at: now, status: mapDecisionToStatus(params.decision), actor, reason: params.rationale },
    ],
  };
  approvalRequests.set(updated.id, updated);
  const storageError = persistApprovalRequests();
  if (storageError) {
    approvalRequests.set(request.id, request);
    return storageError;
  }
  return { ok: true, request: updated };
}

export function getApprovalForAction(tool: string, params: Record<string, unknown>): HitlApprovalRequest | undefined {
  const digest = actionDigest(tool, params);
  const request = Array.from(approvalRequests.values()).find((request) =>
    (request.status === 'approved' || request.status === 'approved_with_edits')
    && request.actionDigest === digest
    && new Date(request.timeoutAt).getTime() >= Date.now(),
  );
  return request ? structuredClone(request) : undefined;
}

export function reserveApprovedAction(requestId: string, expectedDigest: string): HitlApprovalDecisionResult {
  const request = approvalRequests.get(requestId);
  if (!request) return { ok: false, code: 'unknown', error: `Unknown HITL approval request: ${requestId}` };
  if (request.actionDigest !== expectedDigest) return { ok: false, code: 'digest-mismatch', request, error: 'Approved action digest does not match the requested execution.' };
  if (request.status !== 'approved' && request.status !== 'approved_with_edits') {
    return { ok: false, code: 'already-decided', request, error: `Approval cannot execute from state ${request.status}.` };
  }
  if (new Date(request.timeoutAt).getTime() < Date.now()) return { ok: false, code: 'expired', request, error: 'Approval expired before execution.' };
  const now = new Date().toISOString();
  const updated: HitlApprovalRequest = {
    ...request,
    status: 'executing',
    version: request.version + 1,
    transitionHistory: [...request.transitionHistory, { at: now, status: 'executing', actor: 'Morgan policy gateway', reason: 'Reserved for one execution attempt.' }],
  };
  approvalRequests.set(requestId, updated);
  const storageError = persistApprovalRequests();
  if (storageError) {
    approvalRequests.set(requestId, request);
    return storageError;
  }
  return { ok: true, request: updated };
}

export function completeApprovedAction(requestId: string, succeeded: boolean, reason?: string): HitlApprovalDecisionResult {
  const request = approvalRequests.get(requestId);
  if (!request) return { ok: false, code: 'unknown', error: `Unknown HITL approval request: ${requestId}` };
  if (request.status !== 'executing') return { ok: false, code: 'already-decided', request, error: `Approval is ${request.status}, not executing.` };
  const now = new Date().toISOString();
  const status: HitlApprovalStatus = succeeded ? 'executed' : 'failed';
  const updated: HitlApprovalRequest = {
    ...request,
    status,
    version: request.version + 1,
    transitionHistory: [...request.transitionHistory, { at: now, status, actor: 'Morgan policy gateway', reason }],
  };
  approvalRequests.set(requestId, updated);
  const storageError = persistApprovalRequests();
  if (storageError) {
    approvalRequests.set(requestId, request);
    return storageError;
  }
  return { ok: true, request: updated };
}

export function getApprovalRequestById(requestId: string): HitlApprovalRequest | undefined {
  const request = approvalRequests.get(requestId);
  return request ? structuredClone(request) : undefined;
}

function configuredValue(value: string | undefined): string | undefined {
  if (!value || /<[^>]+>/.test(value) || /your-|example|optional-/i.test(value)) return undefined;
  return value.trim() || undefined;
}

function firstConfiguredValue(...values: Array<string | undefined>): string | undefined {
  return values.map(configuredValue).find(Boolean);
}

function modAdministratorRecipient(): { target?: string; teamsUserAadOid?: string; label: string } {
  const teamsUserAadOid = firstConfiguredValue(
    process.env.MOD_ADMINISTRATOR_TEAMS_USER_AAD_OID,
    process.env.MOD_ADMIN_TEAMS_USER_AAD_OID,
    process.env.MOD_ADMINISTRATOR_AAD_OID,
    process.env.MOD_ADMIN_AAD_OID,
    process.env.CFO_TEAMS_USER_AAD_OID,
    process.env.CFO_AAD_OID,
    process.env.GRAHAM_TEAMS_USER_AAD_OID,
  );
  const target = firstConfiguredValue(
    process.env.MOD_ADMINISTRATOR_TEAMS_UPN,
    process.env.MOD_ADMINISTRATOR_UPN,
    process.env.MOD_ADMINISTRATOR_EMAIL,
    process.env.MOD_ADMIN_EMAIL,
    process.env.CFO_TEAMS_UPN,
    process.env.CFO_UPN,
    process.env.CFO_EMAIL,
    process.env.GRAHAM_EMAIL,
  );
  return {
    target,
    teamsUserAadOid,
    label: firstConfiguredValue(
      process.env.MOD_ADMINISTRATOR_DISPLAY_NAME,
      process.env.MOD_ADMINISTRATOR_NAME,
      process.env.CFO_DISPLAY_NAME,
      process.env.CFO_NAME,
      process.env.GRAHAM_DISPLAY_NAME,
    ) || 'CFO / Finance Approver',
  };
}

function notesFieldId(requestId: string): string {
  return `decisionNotes_${requestId.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function cardFact(title: string, value: string | undefined): { title: string; value: string } {
  return { title, value: value || 'n/a' };
}

function selectedApprovalRequests(params: { requestId?: string; level?: HitlApprovalLevel; status?: HitlApprovalStatus | 'open' | 'all' } = {}): HitlApprovalRequest[] {
  const status = params.status || 'open';
  const level = params.level || 'L2';
  const listed = listHitlApprovalRequests({ status, level }).requests;
  return params.requestId ? listed.filter((request) => request.id === params.requestId) : listed;
}

export function buildHitlApprovalAdaptiveCard(params: { requestId?: string; level?: HitlApprovalLevel; approverLabel?: string } = {}): { card: Record<string, unknown>; requests: HitlApprovalRequest[] } {
  const requests = selectedApprovalRequests({ requestId: params.requestId, level: params.level || 'L2', status: 'open' });
  const surfaceUrl = `${configuredBaseUrl()}/approvals${params.requestId ? `#${encodeURIComponent(params.requestId)}` : ''}`;
  const card: Record<string, unknown> = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    msteams: { width: 'Full' },
    body: [
      { type: 'TextBlock', text: 'Morgan Level 2 HITL approval', weight: 'Bolder', size: 'Large', wrap: true },
      { type: 'TextBlock', text: `${requests.length} L2 decision${requests.length === 1 ? '' : 's'} pending for ${params.approverLabel || 'CFO / Finance Approver'}. Morgan has not sent the gated action; this card records the human decision first.`, wrap: true },
      ...requests.flatMap((request) => {
        const fieldId = notesFieldId(request.id);
        return [{
          type: 'Container',
          separator: true,
          spacing: 'Medium',
          items: [
            { type: 'TextBlock', text: request.title, weight: 'Bolder', wrap: true },
            {
              type: 'FactSet',
              facts: [
                cardFact('Level/status', `${request.level} pending`),
                cardFact('Case', `${request.caseId} - ${request.customer}`),
                cardFact('Stage', request.stage),
                cardFact('Action', request.actionType),
                cardFact('Recipient', request.recipient),
                cardFact('Sponsor', request.sponsor),
                cardFact('Tool path', request.tool),
              ],
            },
            { type: 'TextBlock', text: request.bodyPreview, wrap: true },
            { type: 'TextBlock', text: `Rationale: ${request.rationale}`, wrap: true, isSubtle: true },
            { type: 'TextBlock', text: `Evidence: ${request.evidence.join(' | ')}`, wrap: true, isSubtle: true, spacing: 'Small' },
            { type: 'Input.Text', id: fieldId, label: 'Decision notes or edited body', isMultiline: true, placeholder: 'Type approval rationale, edits, or decline/cancel reason' },
            {
              type: 'ActionSet',
              actions: [
                { type: 'Action.Submit', title: 'Approve', data: { morganAction: 'hitlApprovalDecision', requestId: request.id, version: request.version, actionDigest: request.actionDigest, decision: 'approve', decisionToken: signedDecisionToken(request, 'approve'), notesFieldId: fieldId } },
                { type: 'Action.Submit', title: 'Approve with edits', data: { morganAction: 'hitlApprovalDecision', requestId: request.id, version: request.version, actionDigest: request.actionDigest, decision: 'approve_with_edits', decisionToken: signedDecisionToken(request, 'approve_with_edits'), notesFieldId: fieldId } },
                { type: 'Action.Submit', title: 'Decline', style: 'destructive', data: { morganAction: 'hitlApprovalDecision', requestId: request.id, version: request.version, actionDigest: request.actionDigest, decision: 'decline', decisionToken: signedDecisionToken(request, 'decline'), notesFieldId: fieldId } },
                { type: 'Action.Submit', title: 'Cancel', data: { morganAction: 'hitlApprovalDecision', requestId: request.id, version: request.version, actionDigest: request.actionDigest, decision: 'cancel', decisionToken: signedDecisionToken(request, 'cancel'), notesFieldId: fieldId } },
              ],
            },
          ],
        }];
      }),
    ],
    actions: [
      { type: 'Action.OpenUrl', title: 'Open approval queue', url: surfaceUrl },
    ],
  };
  return { card, requests };
}

function adaptiveCardActivity(card: Record<string, unknown>, text: string): Activity {
  const activity = new Activity(ActivityTypes.Message);
  activity.text = text;
  activity.attachments = [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }];
  return activity;
}

function hitlFallbackText(requests: HitlApprovalRequest[], surfaceUrl: string): string {
  return [
    'Morgan Level 2 HITL approval requested',
    '',
    `${requests.length} L2 decision${requests.length === 1 ? '' : 's'} pending. Morgan has not sent the gated action.`,
    '',
    ...requests.flatMap((request) => [
      `**${request.title}**`,
      `${request.caseId} - ${request.customer} | ${request.level} pending`,
      `Action: ${request.actionType}`,
      `Recipient: ${request.recipient}`,
      `Rationale: ${request.rationale}`,
      `Evidence: ${request.evidence.join(' | ')}`,
      '',
    ]),
    `Open approval queue: ${surfaceUrl}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Morgan Digital CFO adaptation
// The original source imported sendTeamsDirectMessage (from tools/mcpToolSetup) and
// sendProactiveActivityToLatestConversation (from scheduler/proactiveMonitor).
// Neither helper is exported by Morgan Digital CFO yet, and this port may only
// touch its own files. To stay self-contained and keep behavior intact:
//  - the direct-message path reuses Morgan Digital CFO's real channel-based
//    sendTeamsMessage when a Teams channel is configured;
//  - the proactive path degrades gracefully so callers fall through to the
//    Teams channel send (the in-chat context path is unaffected).
async function sendTeamsDirectMessage(
  params: { to?: string; teamsUserAadOid?: string; message: string; subject?: string },
  context?: TurnContext,
): Promise<TeamsMessageResult> {
  const channelId = firstConfiguredValue(
    process.env.MORGAN_DIGITAL_CFO_TEAMS_CHANNEL_ID,
    process.env.MORGAN_DCFO_TEAMS_CHANNEL_ID,
    process.env.CFO_TEAMS_CHANNEL_ID,
    process.env.TEAMS_CHANNEL_ID,
  );
  if (channelId) {
    const result = await sendTeamsMessage({ channel_id: channelId, message: params.message, subject: params.subject }, context);
    return { ...result, source: result.source ? `${result.source}:hitl-direct` : 'hitl-direct' };
  }
  return {
    success: false,
    source: params.to || params.teamsUserAadOid ? 'teams-direct-unavailable' : 'teams-recipient-not-configured',
    error: 'No Teams channel is configured for Morgan Digital CFO HITL direct delivery. Set MORGAN_DIGITAL_CFO_TEAMS_CHANNEL_ID, CFO_TEAMS_CHANNEL_ID, or TEAMS_CHANNEL_ID.',
  };
}

async function sendProactiveActivityToLatestConversation(
  _activity: Activity,
  _label = 'proactive-activity',
): Promise<{ success: boolean; messageId?: string; target?: string; source: string; error?: string }> {
  return {
    success: false,
    source: 'bot-proactive',
    error: 'Proactive HITL delivery is not wired in Morgan Digital CFO; falling back to the configured Teams channel send.',
  };
}

export async function sendHitlApprovalCardToModAdministrator(params: { requestId?: string; level?: HitlApprovalLevel } = {}, context?: TurnContext): Promise<HitlApprovalCardDeliveryResult> {
  const recipient = modAdministratorRecipient();
  const { card, requests } = buildHitlApprovalAdaptiveCard({ ...params, level: params.level || 'L2', approverLabel: recipient.label });
  const surfaceUrl = `${configuredBaseUrl()}/approvals${params.requestId ? `#${encodeURIComponent(params.requestId)}` : ''}`;
  const fallbackText = hitlFallbackText(requests, surfaceUrl);
  if (!requests.length) {
    return { ok: false, adaptiveCardSent: false, requestCount: 0, targetLabel: recipient.label, source: 'hitl-card', error: 'No pending L2 HITL approvals are waiting.', adaptiveCard: card, fallbackText };
  }

  const label = `Morgan L2 HITL approval card to ${recipient.label}`;
  recordAgentEvent({ kind: 'graph.call', label, status: 'started', data: { requestIds: requests.map((request) => request.id), target: recipient.label } });

  try {
    if (context) {
      const direct = await sendTeamsDirectMessage({ to: recipient.target, teamsUserAadOid: recipient.teamsUserAadOid, subject: 'Morgan L2 HITL approval requested', message: fallbackText }, context);
      const demoOnly = /^demo-teams-direct/.test(direct.source || '');
      if (direct.success && !demoOnly) {
        recordAuditEvent({ kind: 'hitl.approval.card.fallback.sent', label: `${label} sent by WorkIQ Teams`, actor: 'Morgan, the CFO\'s Digital Finance Analyst', data: { requestIds: requests.map((request) => request.id), target: recipient.label, source: direct.source, messageId: direct.messageId } });
        return { ok: true, adaptiveCardSent: false, requestCount: requests.length, targetLabel: recipient.label, source: direct.source || 'workiq-teams-direct', messageId: direct.messageId, adaptiveCard: card, fallbackText };
      }
      const response = await context.sendActivity(adaptiveCardActivity(card, fallbackText));
      const deliveryError = direct.error || 'WorkIQ Teams direct message did not return a live delivery result.';
      recordAuditEvent({ kind: 'hitl.approval.card.failed', label: `${label} direct send failed`, actor: 'Morgan, the CFO\'s Digital Finance Analyst', severity: 'warning', data: { requestIds: requests.map((request) => request.id), target: recipient.label, source: direct.source || 'workiq-teams-direct', messageId: direct.messageId || response?.id, error: deliveryError } });
      return { ok: false, adaptiveCardSent: true, requestCount: requests.length, targetLabel: recipient.label, source: direct.source || 'bot-context-adaptive-card-after-direct-failure', messageId: direct.messageId || response?.id, error: deliveryError, adaptiveCard: card, fallbackText };
    }

    const proactive = await sendProactiveActivityToLatestConversation(adaptiveCardActivity(card, fallbackText), 'hitl-l2-approval-card');
    if (proactive.success) {
      recordAuditEvent({ kind: 'hitl.approval.card.sent', label, actor: 'Morgan, the CFO\'s Digital Finance Analyst', data: { requestIds: requests.map((request) => request.id), target: recipient.label, source: proactive.source, messageId: proactive.messageId } });
      return { ok: true, adaptiveCardSent: true, requestCount: requests.length, targetLabel: recipient.label, source: proactive.source, messageId: proactive.messageId, adaptiveCard: card, fallbackText };
    }

    const direct = await sendTeamsDirectMessage({ to: recipient.target, teamsUserAadOid: recipient.teamsUserAadOid, subject: 'Morgan L2 HITL approval requested', message: fallbackText });
    const demoOnly = /^demo-teams-direct/.test(direct.source || '');
    const delivered = direct.success && !demoOnly;
    const deliveryError = demoOnly
      ? direct.error || proactive.error || 'Demo Teams fallback logged only; no real Teams instant message was sent.'
      : direct.error || proactive.error;
    recordAuditEvent({ kind: delivered ? 'hitl.approval.card.fallback.sent' : 'hitl.approval.card.failed', label: delivered ? `${label} fallback sent` : `${label} failed`, actor: 'Morgan, the CFO\'s Digital Finance Analyst', severity: delivered ? 'info' : 'warning', data: { requestIds: requests.map((request) => request.id), target: recipient.label, source: direct.source, messageId: direct.messageId, error: deliveryError } });
    return { ok: delivered, adaptiveCardSent: false, requestCount: requests.length, targetLabel: recipient.label, source: direct.source || 'teams-direct-fallback', messageId: direct.messageId, error: delivered ? undefined : deliveryError, adaptiveCard: card, fallbackText };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordAuditEvent({ kind: 'hitl.approval.card.failed', label: `${label} failed`, actor: 'Morgan, the CFO\'s Digital Finance Analyst', severity: 'warning', data: { requestIds: requests.map((request) => request.id), target: recipient.label, error: message } });
    return { ok: false, adaptiveCardSent: false, requestCount: requests.length, targetLabel: recipient.label, source: 'hitl-card-error', error: message, adaptiveCard: card, fallbackText };
  }
}

function isHitlDecision(value: string): value is HitlApprovalDecision {
  return ['approve', 'approve_with_edits', 'decline', 'cancel'].includes(value);
}

export function handleHitlApprovalCardSubmit(value: unknown, identity: HitlApproverIdentity): HitlApprovalCardSubmitResult | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Record<string, unknown>;
  if (payload.morganAction !== 'hitlApprovalDecision') return null;
  const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
  const decisionRaw = typeof payload.decision === 'string' ? payload.decision : '';
  if (!requestId || !isHitlDecision(decisionRaw)) {
    return { handled: true, reply: 'I could not record that HITL card decision because the card payload was incomplete.' };
  }
  const noteKey = typeof payload.notesFieldId === 'string' ? payload.notesFieldId : notesFieldId(requestId);
  const rationale = typeof payload[noteKey] === 'string'
    ? payload[noteKey] as string
    : typeof payload.decisionNotes === 'string'
      ? payload.decisionNotes
      : undefined;
  const result = recordHitlApprovalDecision({
    requestId,
    decision: decisionRaw,
    identity,
    rationale,
    editedBody: decisionRaw === 'approve_with_edits' ? rationale : undefined,
    expectedVersion: typeof payload.version === 'number' ? payload.version : undefined,
    expectedActionDigest: typeof payload.actionDigest === 'string' ? payload.actionDigest : undefined,
    decisionToken: typeof payload.decisionToken === 'string' ? payload.decisionToken : undefined,
  });
  if (!result.ok) {
    return { handled: true, decision: decisionRaw, result, reply: `I could not record that L2 HITL decision: ${result.error || 'unknown error'}.` };
  }
  recordAuditEvent({ kind: 'hitl.approval.card.decision', label: `HITL approval ${decisionRaw} recorded from Adaptive Card`, correlationId: requestId, actor: identity.name || identity.email || identity.oid || 'Authorized finance approver', data: { requestId, decision: decisionRaw, status: result.request?.status, approverOid: identity.oid } });
  return {
    handled: true,
    decision: decisionRaw,
    result,
    reply: `Recorded **${decisionRaw}** for ${result.request?.level || 'L2'} approval: **${result.request?.title || requestId}**. Morgan will keep the gated action blocked until the approved path is executed deliberately.`,
  };
}

export const HITL_APPROVAL_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'listHitlApprovalRequests',
      description: 'List Morgan HITL approval requests that are pending or decided, including L2/L3 action details and the approval surface URL.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'all', 'pending', 'approved', 'approved_with_edits', 'declined', 'cancelled', 'expired', 'executing', 'executed', 'failed'] },
          level: { type: 'string', enum: ['L2', 'L3'] },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getHitlApprovalSurface',
      description: 'Return the web URL Morgan should give the CFO / Finance Approver when an L2 or L3 approval is required.',
      parameters: {
        type: 'object',
        properties: { requestId: { type: 'string' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sendHitlApprovalCardToModAdministrator',
      description: 'Send pending L2 HITL approval requests to the CFO / Finance Approver as a Microsoft Teams Adaptive Card with decision notes and approve/approve-with-edits/decline/cancel buttons.',
      parameters: {
        type: 'object',
        properties: {
          requestId: { type: 'string', description: 'Optional specific HITL approval request id. If omitted, send all pending L2 requests.' },
          level: { type: 'string', enum: ['L2', 'L3'], description: 'Approval level to send; defaults to L2.' },
        },
        required: [],
      },
    },
  },
];
