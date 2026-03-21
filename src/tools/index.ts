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
  getMcpTools,
  sendTeamsMessage,
  sendEmail,
  createWordDocument,
  readSharePointData,
  lookupPerson,
  MCP_TOOL_DEFINITIONS,
} from './mcpToolSetup';

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
];

// ---------------------------------------------------------------------------
// 1. getAllTools
// ---------------------------------------------------------------------------

export function getAllTools(): ChatCompletionTool[] {
  return [
    ...FINANCIAL_TOOL_DEFINITIONS,
    ...REPORT_TOOL_DEFINITIONS,
    ...MCP_TOOL_DEFINITIONS,
    ...UTILITY_TOOL_DEFINITIONS,
  ];
}

// ---------------------------------------------------------------------------
// 2. executeTool — master dispatcher
// ---------------------------------------------------------------------------

type ToolResult = unknown;

export async function executeTool(name: string, params: Record<string, unknown>, context?: TurnContext): Promise<string> {
  console.log(`[Morgan] Tool call → ${name}`, JSON.stringify(params, null, 2));

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

      // MCP tools — pass context for OBO token exchange
      case 'getMcpTools':
        result = await getMcpTools(context);
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
      case 'lookupPerson':
        result = await lookupPerson(params as Parameters<typeof lookupPerson>[0]);
        break;

      // Utility tools
      case 'get_current_date':
        result = getCurrentDate();
        break;
      case 'get_company_context':
        result = getCompanyContext();
        break;

      default:
        return JSON.stringify({ error: `Unknown tool: "${name}"` });
    }

    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Morgan] Tool "${name}" threw an error: ${message}`);
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

// Re-export tool definition arrays and all individual functions so consumers
// can import everything they need from this single entry point.
export {
  FINANCIAL_TOOL_DEFINITIONS,
  REPORT_TOOL_DEFINITIONS,
  MCP_TOOL_DEFINITIONS,
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
  // Utility
  getCurrentDate,
  getCompanyContext,
};
