import crypto from 'crypto';
import type { ExecutionContext } from './executionContext';

export type ToolRiskClass =
  | 'read-only'
  | 'internal-write'
  | 'external-communication'
  | 'financial-commitment'
  | 'privileged-decision'
  | 'unknown';

export type ToolPolicyDecision = 'allow' | 'approval-required' | 'deny';

export interface ToolPolicy {
  risk: ToolRiskClass;
  approvalLevel?: 'L2' | 'L3';
  modelVisible: boolean;
  description: string;
}

export interface ToolPolicyEvaluation {
  tool: string;
  policy: ToolPolicy;
  decision: ToolPolicyDecision;
  reason: string;
  actionDigest: string;
  actionSummary: string;
}

const READ_ONLY_TOOLS = new Set([
  'analyzeBudgetVsActuals',
  'getFinancialKPIs',
  'detectAnomalies',
  'calculateTrend',
  'generateFinancialInsights',
  'getLatestPnL',
  'formatBudgetReport',
  'createWeeklyBriefingContent',
  'formatForTeams',
  'getMicrosoftIQCapabilityMap',
  'queryWorkIQSignals',
  'queryFoundryIQInsights',
  'queryFabricIQFinancials',
  'synthesizeMicrosoftIQBriefing',
  'getMcpTools',
  'findUser',
  'lookupPerson',
  'readSharePointData',
  'readSharePointList',
  'listUpcomingMeetings',
  'collectMeetingContext',
  'getMorganIdentity',
  'getWorkIQStatus',
  'getMissionControlSnapshot',
  'getCorpGenDigestDeliveryStatus',
  'getPaperAlignment',
  'getTodaysTaskRecords',
  'listHitlApprovalRequests',
  'getHitlApprovalSurface',
  'getRetrospectiveHistory',
  'generateCfoOperatingPlan',
  'listOpenMissionTasks',
  'getAutonomousKanbanBoard',
  'getAdaptiveMemorySummary',
  'getCognitiveToolchain',
  'getExperientialLearningPlaybook',
  'getEnterpriseReadiness',
  'evaluateMissionArtifact',
  'getEndOfDayReport',
  'getSubAgentRegistry',
  'getTeamsFederationCallingStatus',
  'listScheduledCallbacks',
  'get_current_date',
  'get_company_context',
]);

const INTERNAL_WRITE_TOOLS = new Set([
  'createWordDocument',
  'recordMissionTaskCompletion',
  'generateCfoRetrospective',
  'runAutonomousCfoWorkday',
]);

const EXTERNAL_L2_TOOLS = new Set([
  'sendTeamsMessage',
  'sendEmail',
  'createPlannerTask',
  'updatePlannerTask',
  'scheduleCalendarEvent',
  'callSubAgent',
  'initiateTeamsCallToCfo',
  'initiateTeamsFederatedCall',
  'scheduleAutonomousCallback',
  'cancelAutonomousCallback',
]);

const NEVER_MODEL_TOOLS = new Set([
  'recordHitlApprovalDecision',
  'sendHitlApprovalCardToModAdministrator',
]);

const READ_ONLY_PATTERNS = /(?:^|_)(get|list|read|search|find|lookup|query|describe|status|health|fetch|retrieve|inspect|analy[sz]e|detect|calculate|summari[sz]e)(?:_|$)/i;
const EXTERNAL_WRITE_PATTERNS = /(?:send|post|create|update|delete|remove|schedule|invite|call|write|publish|upload|share|grant|approve|commit|release|pay|transfer)/i;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function canonicalAction(tool: string, params: Record<string, unknown>): string {
  return JSON.stringify(stableValue({ tool, params }));
}

export function actionDigest(tool: string, params: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(canonicalAction(tool, params)).digest('hex');
}

function summaryValue(params: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  }
  return undefined;
}

export function summarizeAction(tool: string, params: Record<string, unknown>): string {
  const target = summaryValue(params, ['to', 'recipient', 'channel_id', 'teams_user_aad_oid', 'assigned_to', 'attendees']);
  const subject = summaryValue(params, ['subject', 'title', 'reason', 'message']);
  return [tool, subject, target ? `target ${target}` : undefined].filter(Boolean).join(' — ').slice(0, 300);
}

export function classifyTool(tool: string, discoveredMcp = false): ToolPolicy {
  if (NEVER_MODEL_TOOLS.has(tool)) {
    return { risk: 'privileged-decision', modelVisible: false, description: 'Human-only governance operation.' };
  }
  if (READ_ONLY_TOOLS.has(tool)) {
    return { risk: 'read-only', modelVisible: true, description: 'Read-only analysis, status, or evidence retrieval.' };
  }
  if (INTERNAL_WRITE_TOOLS.has(tool)) {
    return { risk: 'internal-write', modelVisible: true, description: 'Internal artifact or work-ledger update.' };
  }
  if (EXTERNAL_L2_TOOLS.has(tool)) {
    return { risk: 'external-communication', approvalLevel: 'L2', modelVisible: true, description: 'External communication or mutable Microsoft 365 action.' };
  }
  if (discoveredMcp) {
    const allowlist = new Set((process.env.MORGAN_MCP_TOOL_ALLOWLIST || '').split(',').map((value) => value.trim()).filter(Boolean));
    if (!allowlist.has(tool)) {
      return { risk: 'unknown', modelVisible: false, description: 'Discovered MCP tool is not present in MORGAN_MCP_TOOL_ALLOWLIST.' };
    }
    if (EXTERNAL_WRITE_PATTERNS.test(tool)) {
      return { risk: 'external-communication', approvalLevel: 'L2', modelVisible: true, description: 'Explicitly allowlisted discovered MCP write action.' };
    }
    if (READ_ONLY_PATTERNS.test(tool)) {
      return { risk: 'read-only', modelVisible: true, description: 'Discovered MCP read operation allowed by conservative naming policy.' };
    }
    return { risk: 'unknown', modelVisible: false, description: 'Unknown discovered MCP action denied by default.' };
  }
  return { risk: 'unknown', modelVisible: false, description: 'Unclassified tool denied by default.' };
}

export function isToolModelVisible(tool: string, discoveredMcp = false): boolean {
  return classifyTool(tool, discoveredMcp).modelVisible;
}

export function evaluateToolPolicy(
  tool: string,
  params: Record<string, unknown>,
  context: ExecutionContext,
  discoveredMcp = false,
): ToolPolicyEvaluation {
  const policy = tool === 'createWordDocument' && params.save_to_sharepoint === true
    ? { risk: 'external-communication' as const, approvalLevel: 'L2' as const, modelVisible: true, description: 'Publishing a document to SharePoint requires L2 approval.' }
    : classifyTool(tool, discoveredMcp);
  const digest = actionDigest(tool, params);
  const base = {
    tool,
    policy,
    actionDigest: digest,
    actionSummary: summarizeAction(tool, params),
  };

  if (policy.risk === 'unknown' || policy.risk === 'privileged-decision') {
    return { ...base, decision: 'deny', reason: policy.description };
  }
  if (policy.risk === 'read-only' || policy.risk === 'internal-write') {
    return { ...base, decision: 'allow', reason: policy.description };
  }
  if (context.approvalId && context.approvalActionDigest === digest) {
    return { ...base, decision: 'allow', reason: `Matching ${policy.approvalLevel} approval context supplied.` };
  }
  return {
    ...base,
    decision: 'approval-required',
    reason: `${policy.approvalLevel} human approval is required before ${tool} can execute.`,
  };
}
