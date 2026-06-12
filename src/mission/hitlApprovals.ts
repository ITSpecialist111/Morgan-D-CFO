import type { ChatCompletionTool } from 'openai/resources/chat';
import type { TurnContext } from '@microsoft/agents-hosting';
import { Activity, ActivityTypes } from '@microsoft/agents-activity';
import { recordAgentEvent } from '../observability/agentEvents';
import { recordAuditEvent } from '../observability/agentAudit';
import { sendTeamsMessage, type TeamsMessageResult } from '../tools/mcpToolSetup';

export type HitlApprovalLevel = 'L2' | 'L3';
export type HitlApprovalStatus = 'pending' | 'approved' | 'approved_with_edits' | 'declined' | 'cancelled';
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
  decidedAt?: string;
  decidedBy?: string;
  rationaleFromApprover?: string;
  editedBody?: string;
}

export interface HitlApprovalDecisionResult {
  ok: boolean;
  request?: HitlApprovalRequest;
  error?: string;
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

const approvalRequests = new Map<string, HitlApprovalRequest>([
  ['approval-pnl-board-report-l2', {
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
  }],
  ['approval-budget-reforecast-l3', {
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
  }],
  ['approval-variance-summary-l2', {
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
  }],
  ['approval-vendor-payment-l3', {
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
  }],
]);

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

export function listHitlApprovalRequests(params: { status?: HitlApprovalStatus | 'open' | 'all'; level?: HitlApprovalLevel } = {}) {
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
    requests,
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

export function recordHitlApprovalDecision(params: {
  requestId: string;
  decision: HitlApprovalDecision;
  decidedBy?: string;
  rationale?: string;
  editedBody?: string;
}): HitlApprovalDecisionResult {
  const request = approvalRequests.get(params.requestId);
  if (!request) return { ok: false, error: `Unknown HITL approval request: ${params.requestId}` };
  if (request.status !== 'pending') return { ok: false, request, error: `Request is already ${request.status}` };

  const updated: HitlApprovalRequest = {
    ...request,
    status: mapDecisionToStatus(params.decision),
    decidedAt: new Date().toISOString(),
    decidedBy: params.decidedBy || 'Morgan chat operator',
    rationaleFromApprover: params.rationale,
    editedBody: params.editedBody,
  };
  approvalRequests.set(updated.id, updated);
  return { ok: true, request: updated };
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
    process.env.ECIF_SPONSOR_EMAIL,
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
                { type: 'Action.Submit', title: 'Approve', data: { morganAction: 'hitlApprovalDecision', requestId: request.id, decision: 'approve', notesFieldId: fieldId } },
                { type: 'Action.Submit', title: 'Approve with edits', data: { morganAction: 'hitlApprovalDecision', requestId: request.id, decision: 'approve_with_edits', notesFieldId: fieldId } },
                { type: 'Action.Submit', title: 'Decline', style: 'destructive', data: { morganAction: 'hitlApprovalDecision', requestId: request.id, decision: 'decline', notesFieldId: fieldId } },
                { type: 'Action.Submit', title: 'Cancel', data: { morganAction: 'hitlApprovalDecision', requestId: request.id, decision: 'cancel', notesFieldId: fieldId } },
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
// The ECIF source imported sendTeamsDirectMessage (from tools/mcpToolSetup) and
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

export function handleHitlApprovalCardSubmit(value: unknown, approverName?: string): HitlApprovalCardSubmitResult | null {
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
  const result = recordHitlApprovalDecision({ requestId, decision: decisionRaw, decidedBy: approverName || 'CFO / Finance Approver', rationale, editedBody: decisionRaw === 'approve_with_edits' ? rationale : undefined });
  if (!result.ok) {
    return { handled: true, decision: decisionRaw, result, reply: `I could not record that L2 HITL decision: ${result.error || 'unknown error'}.` };
  }
  recordAuditEvent({ kind: 'hitl.approval.card.decision', label: `HITL approval ${decisionRaw} recorded from Adaptive Card`, actor: approverName || 'CFO / Finance Approver', data: { requestId, decision: decisionRaw, status: result.request?.status } });
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
          status: { type: 'string', enum: ['open', 'all', 'pending', 'approved', 'approved_with_edits', 'declined', 'cancelled'] },
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
      name: 'recordHitlApprovalDecision',
      description: 'Record a CFO / Finance Approver decision for a pending Morgan HITL approval request. This records the decision only; it does not send external messages by itself.',
      parameters: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          decision: { type: 'string', enum: ['approve', 'approve_with_edits', 'decline', 'cancel'] },
          decidedBy: { type: 'string' },
          rationale: { type: 'string' },
          editedBody: { type: 'string' },
        },
        required: ['requestId', 'decision'],
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
