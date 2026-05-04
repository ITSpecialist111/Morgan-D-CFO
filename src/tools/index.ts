import type { ChatCompletionTool } from 'openai/resources/chat';
import { TurnContext } from '@microsoft/agents-hosting';

import {
  analyzeBudgetVsActuals,
  getFinancialKPIs,
  detectAnomalies,
  calculateTrend,
  generateFinancialInsights,
  FINANCIAL_TOOL_DEFINITIONS,
} from './financialTools';

import {
  formatBudgetReport,
  createWeeklyBriefingContent,
  formatForTeams,
  REPORT_TOOL_DEFINITIONS,
} from './reportTools';

import {
  getMicrosoftIQCapabilityMap,
  IQ_TOOL_DEFINITIONS,
  queryFabricIQFinancials,
  queryFoundryIQInsights,
  queryWorkIQSignals,
  synthesizeMicrosoftIQBriefing,
} from './iqTools';

import {
  collectMeetingContext,
  createPlannerTask,
  getMcpTools,
  describeMcpTool,
  findUser,
  hasMcpToolServer,
  invokeMcpTool,
  listUpcomingMeetings,
  sendTeamsMessage,
  sendEmail,
  createWordDocument,
  readSharePointData,
  readSharePointList,
  scheduleCalendarEvent,
  lookupPerson,
  MCP_TOOL_DEFINITIONS,
  updatePlannerTask,
} from './mcpToolSetup';

import {
  getEndOfDayReport,
  getAutonomousKanbanBoard,
  getCognitiveToolchain,
  getPaperAlignment,
  getTodaysTaskRecords,
  evaluateMissionArtifact,
  generateCfoOperatingPlan,
  getAdaptiveMemorySummary,
  getEnterpriseReadiness,
  getExperientialLearningPlaybook,
  getMissionControlSnapshot,
  listOpenMissionTasks,
  MISSION_TOOL_DEFINITIONS,
  recordMissionTaskCompletion,
  runAutonomousCfoWorkday,
} from '../mission/missionControl';

import {
  callSubAgent,
  getSubAgentRegistry,
  SUB_AGENT_TOOL_DEFINITIONS,
} from '../orchestrator/subAgents';

import {
  getTeamsFederationCallingStatus,
  initiateOutboundTeamsCall,
  isAcsConfigured,
} from '../voice/acsBridge';
import { recordAuditEvent } from '../observability/agentAudit';

// ---------------------------------------------------------------------------
// Built-in utility tools (definitions + implementations inline)
// ---------------------------------------------------------------------------

function getCurrentDate(): { isoDate: string; utcString: string } {
  const now = new Date();
  return { isoDate: now.toISOString(), utcString: now.toUTCString() };
}

function getCompanyContext(): {
  name: string;
  ticker: string;
  industry: string;
  fiscalYearEnd: string;
  currency: string;
  headquarters: string;
  description: string;
} {
  return {
    name: 'Contoso Financial',
    ticker: 'CFIN',
    industry: 'Financial Services / FinTech',
    fiscalYearEnd: 'December 31',
    currency: 'USD',
    headquarters: 'Seattle, WA',
    description:
      'Contoso Financial is a mid-market FinTech company offering digital banking, payments, and investment management solutions to retail and SMB customers across North America.',
  };
}

const UTILITY_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_date',
      description: 'Returns the current date and time as an ISO 8601 string and UTC string.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_company_context',
      description:
        'Returns contextual information about Contoso Financial — the company Morgan operates for. Use this to ground responses with accurate company metadata.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTeamsFederationCallingStatus',
      description: 'Return Morgan Teams federation calling readiness, active ACS calls, tenant federation command, and video-presence roadmap status.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'initiateTeamsFederatedCall',
      description: 'Ring any Microsoft Teams user over ACS-to-Teams federation for a governed Morgan voice escalation. Use only when the user asks Morgan to call someone or escalation rules require live contact.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short reason for the Teams call.' },
          teams_user_aad_oid: { type: 'string', description: 'Target Microsoft Entra user object ID for the Teams user.' },
          target_display_name: { type: 'string', description: 'Optional target display name for logs and call context.' },
          requested_by: { type: 'string', description: 'Optional requester display name.' },
          instructions: { type: 'string', description: 'Optional call-specific realtime voice instructions.' },
        },
        required: ['reason', 'teams_user_aad_oid'],
      },
    },
  },
];

const CALL_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'initiateTeamsCallToCfo',
      description: 'Ring the CFO or operator in Microsoft Teams through the Cassidy-style ACS bridge for urgent finance escalation. Use only when the user asks for a call or the escalation rules require immediate voice contact.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short reason for the Teams call.' },
          teams_user_aad_oid: { type: 'string', description: 'Optional target Microsoft Entra user object ID. Defaults to CFO_TEAMS_USER_AAD_OID.' },
          requested_by: { type: 'string', description: 'Optional requester display name.' },
          instructions: { type: 'string', description: 'Optional call-specific realtime voice instructions.' },
        },
        required: ['reason'],
      },
    },
  },
];

function definitionNames(tools: ChatCompletionTool[]): Set<string> {
  return new Set(tools.map((tool) => tool.type === 'function' ? tool.function.name : '').filter(Boolean));
}

const TOOL_SOURCE_SETS = {
  finance: definitionNames(FINANCIAL_TOOL_DEFINITIONS),
  report: definitionNames(REPORT_TOOL_DEFINITIONS),
  iq: definitionNames(IQ_TOOL_DEFINITIONS),
  mcpStatic: definitionNames(MCP_TOOL_DEFINITIONS),
  mission: definitionNames(MISSION_TOOL_DEFINITIONS),
  subAgent: definitionNames(SUB_AGENT_TOOL_DEFINITIONS),
  teamsCall: definitionNames(CALL_TOOL_DEFINITIONS),
  utility: definitionNames(UTILITY_TOOL_DEFINITIONS),
};

function toolSource(name: string): string {
  if (TOOL_SOURCE_SETS.finance.has(name)) return 'morgan-finance';
  if (TOOL_SOURCE_SETS.report.has(name)) return 'morgan-report';
  if (TOOL_SOURCE_SETS.iq.has(name)) return 'microsoft-iq';
  if (TOOL_SOURCE_SETS.mcpStatic.has(name)) return 'agent365-mcp-static';
  if (TOOL_SOURCE_SETS.mission.has(name)) return 'mission-control';
  if (TOOL_SOURCE_SETS.subAgent.has(name)) return 'sub-agent-orchestration';
  if (TOOL_SOURCE_SETS.teamsCall.has(name)) return 'teams-federation-calling';
  if (TOOL_SOURCE_SETS.utility.has(name)) return 'utility';
  if (hasMcpToolServer(name)) return 'agent365-mcp-discovered';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// 1. getAllTools
// ---------------------------------------------------------------------------

export function getAllTools(): ChatCompletionTool[] {
  return [
    ...FINANCIAL_TOOL_DEFINITIONS,
    ...REPORT_TOOL_DEFINITIONS,
    ...IQ_TOOL_DEFINITIONS,
    ...MCP_TOOL_DEFINITIONS,
    ...MISSION_TOOL_DEFINITIONS,
    ...SUB_AGENT_TOOL_DEFINITIONS,
    ...CALL_TOOL_DEFINITIONS,
    ...UTILITY_TOOL_DEFINITIONS,
  ];
}

// ---------------------------------------------------------------------------
// 2. executeTool — master dispatcher
// ---------------------------------------------------------------------------

type ToolResult = unknown;

export async function executeTool(name: string, params: Record<string, unknown>, context?: TurnContext): Promise<string> {
  console.log(`[Morgan] Tool call → ${name}`, JSON.stringify(params, null, 2));
  const correlationId = `tool-${Date.now()}-${name}`;
  const source = toolSource(name);
  recordAuditEvent({
    kind: 'tool.call',
    label: `Tool call: ${name}`,
    correlationId,
    data: { tool: name, source, parameterKeys: Object.keys(params || {}) },
  });

  try {
    let result: ToolResult;

    switch (name) {
      // Financial tools
      case 'analyzeBudgetVsActuals':
        result = analyzeBudgetVsActuals(params as Parameters<typeof analyzeBudgetVsActuals>[0]);
        break;
      case 'getFinancialKPIs':
        result = getFinancialKPIs(params as Parameters<typeof getFinancialKPIs>[0]);
        break;
      case 'detectAnomalies':
        result = detectAnomalies(params as Parameters<typeof detectAnomalies>[0]);
        break;
      case 'calculateTrend':
        result = calculateTrend(params as Parameters<typeof calculateTrend>[0]);
        break;
      case 'generateFinancialInsights':
        result = generateFinancialInsights(params as Parameters<typeof generateFinancialInsights>[0]);
        break;

      // Report tools
      case 'formatBudgetReport':
        result = formatBudgetReport(params as Parameters<typeof formatBudgetReport>[0]);
        break;
      case 'createWeeklyBriefingContent':
        result = createWeeklyBriefingContent(params as Parameters<typeof createWeeklyBriefingContent>[0]);
        break;
      case 'formatForTeams':
        result = formatForTeams(params as Parameters<typeof formatForTeams>[0]);
        break;

      // Microsoft IQ showcase tools
      case 'getMicrosoftIQCapabilityMap':
        result = getMicrosoftIQCapabilityMap();
        break;
      case 'queryWorkIQSignals':
        result = queryWorkIQSignals(params as Parameters<typeof queryWorkIQSignals>[0]);
        break;
      case 'queryFoundryIQInsights':
        result = queryFoundryIQInsights(params as Parameters<typeof queryFoundryIQInsights>[0]);
        break;
      case 'queryFabricIQFinancials':
        result = queryFabricIQFinancials(params as Parameters<typeof queryFabricIQFinancials>[0]);
        break;
      case 'synthesizeMicrosoftIQBriefing':
        result = synthesizeMicrosoftIQBriefing(params as Parameters<typeof synthesizeMicrosoftIQBriefing>[0]);
        break;

      // MCP tools — pass context for OBO token exchange
      case 'getMcpTools':
        result = await getMcpTools(context);
        break;
      case 'findUser':
        result = await findUser(params as Parameters<typeof findUser>[0], context);
        break;
      case 'sendTeamsMessage':
        result = await sendTeamsMessage(params as Parameters<typeof sendTeamsMessage>[0], context);
        break;
      case 'sendEmail':
        result = await sendEmail(params as Parameters<typeof sendEmail>[0], context);
        break;
      case 'createWordDocument':
        result = await createWordDocument(params as Parameters<typeof createWordDocument>[0], context);
        break;
      case 'readSharePointData':
        result = await readSharePointData(params as Parameters<typeof readSharePointData>[0], context);
        break;
      case 'readSharePointList':
        result = await readSharePointList(params as Parameters<typeof readSharePointList>[0], context);
        break;
      case 'createPlannerTask':
        result = await createPlannerTask(params as Parameters<typeof createPlannerTask>[0], context);
        break;
      case 'updatePlannerTask':
        result = await updatePlannerTask(params as Parameters<typeof updatePlannerTask>[0], context);
        break;
      case 'scheduleCalendarEvent':
        result = await scheduleCalendarEvent(params as Parameters<typeof scheduleCalendarEvent>[0], context);
        break;
      case 'listUpcomingMeetings':
        result = await listUpcomingMeetings(params as Parameters<typeof listUpcomingMeetings>[0], context);
        break;
      case 'collectMeetingContext':
        result = await collectMeetingContext(params as Parameters<typeof collectMeetingContext>[0], context);
        break;
      case 'lookupPerson':
        result = await lookupPerson(params as Parameters<typeof lookupPerson>[0]);
        break;

      // Mission Control / autonomy tools
      case 'getMissionControlSnapshot':
        result = getMissionControlSnapshot();
        break;
      case 'getPaperAlignment':
        result = getPaperAlignment();
        break;
      case 'getTodaysTaskRecords':
        result = getTodaysTaskRecords(typeof params.date === 'string' ? params.date : undefined);
        break;
      case 'recordMissionTaskCompletion':
        result = recordMissionTaskCompletion(params as Parameters<typeof recordMissionTaskCompletion>[0]);
        break;
      case 'generateCfoOperatingPlan':
        result = generateCfoOperatingPlan();
        break;
      case 'listOpenMissionTasks':
        result = listOpenMissionTasks();
        break;
      case 'getAutonomousKanbanBoard':
        result = getAutonomousKanbanBoard();
        break;
      case 'getAdaptiveMemorySummary':
        result = getAdaptiveMemorySummary();
        break;
      case 'getCognitiveToolchain':
        result = getCognitiveToolchain();
        break;
      case 'getExperientialLearningPlaybook':
        result = getExperientialLearningPlaybook();
        break;
      case 'getEnterpriseReadiness':
        result = getEnterpriseReadiness();
        break;
      case 'evaluateMissionArtifact':
        result = evaluateMissionArtifact(params as Parameters<typeof evaluateMissionArtifact>[0]);
        break;
      case 'getEndOfDayReport':
        result = getEndOfDayReport(params as Parameters<typeof getEndOfDayReport>[0]);
        break;
      case 'runAutonomousCfoWorkday':
        result = await runAutonomousCfoWorkday({ source: 'user_request' });
        break;

      // Sub-agent orchestration tools
      case 'getSubAgentRegistry':
        result = getSubAgentRegistry();
        break;
      case 'callSubAgent':
        result = await callSubAgent(params as Parameters<typeof callSubAgent>[0]);
        break;

      // Teams voice escalation
      case 'initiateTeamsCallToCfo': {
        const typed = params as { reason?: string; teams_user_aad_oid?: string; requested_by?: string; instructions?: string };
        const target = typed.teams_user_aad_oid || process.env.CFO_TEAMS_USER_AAD_OID;
        if (!isAcsConfigured()) {
          result = { success: false, error: 'ACS calling is not configured. Set ACS_CONNECTION_STRING and related app settings.' };
          break;
        }
        if (!target) {
          result = { success: false, error: 'No Teams target configured. Set CFO_TEAMS_USER_AAD_OID or pass teams_user_aad_oid.' };
          break;
        }
        const call = await initiateOutboundTeamsCall({
          teamsUserAadOid: target,
          targetDisplayName: typed.requested_by || 'CFO/operator',
          requestedBy: typed.requested_by || 'Morgan',
          instructions: typed.instructions || `You are Morgan, the Digital CFO. Call reason: ${typed.reason || 'urgent finance escalation'}. Be concise and explain what needs attention.`,
        });
        result = { success: true, reason: typed.reason, ...call };
        break;
      }
      case 'getTeamsFederationCallingStatus':
        result = getTeamsFederationCallingStatus();
        break;
      case 'initiateTeamsFederatedCall': {
        const typed = params as { reason?: string; teams_user_aad_oid?: string; target_display_name?: string; requested_by?: string; instructions?: string };
        if (!isAcsConfigured()) {
          result = { success: false, error: 'ACS calling is not configured. Set ACS_CONNECTION_STRING and Teams federation app settings.' };
          break;
        }
        if (!typed.teams_user_aad_oid) {
          result = { success: false, error: 'teams_user_aad_oid is required for a federated Teams call.' };
          break;
        }
        const call = await initiateOutboundTeamsCall({
          teamsUserAadOid: typed.teams_user_aad_oid,
          targetDisplayName: typed.target_display_name,
          requestedBy: typed.requested_by || 'Morgan',
          instructions: typed.instructions || `You are Morgan, the Digital CFO. Federated Teams call reason: ${typed.reason || 'finance escalation'}. Introduce yourself, explain the reason for the call, and keep the exchange concise.`,
        });
        result = { success: true, reason: typed.reason, federationMode: 'acs_to_teams', videoPresence: getTeamsFederationCallingStatus().videoPresence, ...call };
        break;
      }

      // Utility tools
      case 'get_current_date':
        result = getCurrentDate();
        break;
      case 'get_company_context':
        result = getCompanyContext();
        break;

      default: {
        if (hasMcpToolServer(name)) {
          const metadata = describeMcpTool(name);
          result = await invokeMcpTool(name, params);
          result = { source: 'agent365-mcp', server: metadata.serverName, tool: name, result };
          break;
        }
        return JSON.stringify({ error: `Unknown tool: "${name}"` });
      }
    }

    recordAuditEvent({
      kind: 'tool.completed',
      label: `Tool completed: ${name}`,
      correlationId,
      data: { tool: name, source },
    });
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Morgan] Tool "${name}" threw an error: ${message}`);
    recordAuditEvent({
      kind: 'tool.failed',
      label: `Tool failed: ${name}`,
      severity: 'error',
      correlationId,
      data: { tool: name, error: message },
    });
    return JSON.stringify({ error: message, tool: name });
  }
}

// ---------------------------------------------------------------------------
// 3. executeAutonomousBriefing
// ---------------------------------------------------------------------------

export interface BriefingSummary {
  timestamp: string;
  period: string;
  weekNumber: number;
  actionsCompleted: string[];
  teamsResult?: { success: boolean; messageId?: string };
  emailResult?: { success: boolean; messageId?: string };
}

export interface EndOfDayDeliverySummary {
  reportDate: string;
  actionsCompleted: string[];
  teamsResult?: { success: boolean; messageId?: string; error?: string };
  emailResult?: { success: boolean; messageId?: string; error?: string };
}

// _openaiClient is accepted for API compatibility with agent.ts but not used
// internally — all tool calls are handled by this module's own implementations.
export async function executeAutonomousBriefing(_openaiClient?: unknown): Promise<BriefingSummary> {
  const actionsCompleted: string[] = [];

  // Step 1 — current date & period
  const { isoDate } = getCurrentDate();
  const now         = new Date(isoDate);
  const period      = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // ISO week number
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const weekNumber  = Math.ceil(
    ((now.valueOf() - startOfYear.valueOf()) / 86_400_000 + startOfYear.getDay() + 1) / 7,
  );

  console.log(`[Morgan] Starting autonomous briefing for ${period} (Week ${weekNumber})`);

  // Step 2 — budget vs actuals
  const budgetAnalysis = analyzeBudgetVsActuals({ period });
  actionsCompleted.push(`Analysed budget vs actuals for ${period} — ${budgetAnalysis.summary.anomalyCount} anomaly(ies) found`);

  // Step 3 — weekly briefing content
  const briefingMarkdown = createWeeklyBriefingContent({ week_number: weekNumber, include_kpis: true });
  actionsCompleted.push(`Generated weekly briefing content for Week ${weekNumber}`);

  // Step 4 — post to Teams
  const channelId = process.env.FINANCE_TEAMS_CHANNEL_ID ?? 'demo-channel';
  const teamsMessage = formatForTeams({ content: briefingMarkdown, message_type: 'report' });
  const teamsResult  = await sendTeamsMessage({
    channel_id: channelId,
    message:    teamsMessage,
    subject:    `Weekly Finance Briefing — Week ${weekNumber}`,
  });
  actionsCompleted.push(
    teamsResult.success
      ? `Teams message posted to channel ${channelId} (id: ${teamsResult.messageId})`
      : `Teams message failed: ${(teamsResult as { error?: string }).error}`,
  );

  // Step 5 — email CFO
  const cfoEmail = process.env.CFO_EMAIL ?? 'cfo@contoso-financial.example.com';
  const emailResult = await sendEmail({
    to:         cfoEmail,
    subject:    `[Morgan] Weekly Finance Briefing — Week ${weekNumber}, ${now.getFullYear()}`,
    body:       briefingMarkdown,
    importance: budgetAnalysis.summary.anomalyCount > 0 ? 'high' : 'normal',
  });
  actionsCompleted.push(
    emailResult.success
      ? `Email sent to CFO (${cfoEmail}) — id: ${emailResult.messageId}`
      : `Email to CFO failed: ${(emailResult as { error?: string }).error}`,
  );

  const summary: BriefingSummary = {
    timestamp: isoDate,
    period,
    weekNumber,
    actionsCompleted,
    teamsResult,
    emailResult,
  };

  console.log(`[Morgan] Autonomous briefing completed at ${isoDate}`);
  console.log(`[Morgan] Actions taken:`);
  actionsCompleted.forEach(a => console.log(`  ✔ ${a}`));

  return summary;
}

export async function executeEndOfDayReport(): Promise<EndOfDayDeliverySummary> {
  const actionsCompleted: string[] = [];

  const workday = await runAutonomousCfoWorkday({ source: 'scheduled_job' });
  actionsCompleted.push(workday.headline);

  const report = getEndOfDayReport();
  actionsCompleted.push(`Generated end-of-day breakdown for ${report.date}`);

  const channelId = process.env.FINANCE_TEAMS_CHANNEL_ID ?? 'demo-channel';
  const teamsResult = await sendTeamsMessage({
    channel_id: channelId,
    subject: `Morgan End-of-Day CFO Report - ${report.date}`,
    message: report.summaryMarkdown,
  });
  actionsCompleted.push(
    teamsResult.success
      ? `End-of-day report posted to Teams channel ${channelId}`
      : `Teams end-of-day report failed: ${teamsResult.error}`,
  );

  const cfoEmail = process.env.CFO_EMAIL;
  let emailResult: EndOfDayDeliverySummary['emailResult'];
  if (cfoEmail) {
    emailResult = await sendEmail({
      to: cfoEmail,
      subject: `[Morgan] End-of-Day CFO Report - ${report.date}`,
      body: report.summaryMarkdown,
      importance: report.blockedTasks.length || report.failedTasks.length ? 'high' : 'normal',
    });
    actionsCompleted.push(
      emailResult.success
        ? `End-of-day report emailed to CFO (${cfoEmail})`
        : `End-of-day email failed: ${emailResult.error}`,
    );
  } else {
    actionsCompleted.push('CFO_EMAIL not configured, skipped email delivery.');
  }

  return {
    reportDate: report.date,
    actionsCompleted,
    teamsResult,
    emailResult,
  };
}

// Re-export tool definition arrays and all individual functions so consumers
// can import everything they need from this single entry point.
export {
  FINANCIAL_TOOL_DEFINITIONS,
  REPORT_TOOL_DEFINITIONS,
  MCP_TOOL_DEFINITIONS,
  MISSION_TOOL_DEFINITIONS,
  SUB_AGENT_TOOL_DEFINITIONS,
  CALL_TOOL_DEFINITIONS,
  UTILITY_TOOL_DEFINITIONS,
  // Financial
  analyzeBudgetVsActuals,
  getFinancialKPIs,
  detectAnomalies,
  calculateTrend,
  generateFinancialInsights,
  // Report
  formatBudgetReport,
  createWeeklyBriefingContent,
  formatForTeams,
  // MCP
  getMcpTools,
  sendTeamsMessage,
  sendEmail,
  createWordDocument,
  readSharePointData,
  getMissionControlSnapshot,
  recordMissionTaskCompletion,
  generateCfoOperatingPlan,
  listOpenMissionTasks,
  getAutonomousKanbanBoard,
  getAdaptiveMemorySummary,
  getExperientialLearningPlaybook,
  getEnterpriseReadiness,
  evaluateMissionArtifact,
  getEndOfDayReport,
  runAutonomousCfoWorkday,
  getSubAgentRegistry,
  callSubAgent,
  // Utility
  getCurrentDate,
  getCompanyContext,
};
