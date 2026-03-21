// Voice Live function-calling tools — Morgan's financial tools formatted for
// the Voice Live realtime API (OpenAI function-call schema, not ChatCompletionTool wrapper).

import {
  analyzeBudgetVsActuals,
  getFinancialKPIs,
  detectAnomalies,
  calculateTrend,
} from '../tools/financialTools';
import { lookupPerson } from '../tools/mcpToolSetup';

// Voice Live tool definitions (realtime API format — no `type: 'function'` wrapper)
export const VOICE_TOOLS = [
  {
    type: 'function',
    name: 'analyzeBudgetVsActuals',
    description:
      'Retrieve and analyse budget vs actual spend for the current period. Returns variance in dollars and percentages, and flags anomalies.',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'The financial period, e.g. "2026-03" or "March 2026".',
        },
        category: {
          type: 'string',
          description: 'Optional: filter to a single category like "Marketing" or "R&D".',
        },
      },
      required: ['period'],
    },
  },
  {
    type: 'function',
    name: 'getFinancialKPIs',
    description:
      'Retrieve key financial KPIs: Gross Margin percent, EBITDA, Cash Runway in months, Monthly Burn Rate, and Revenue Growth percent.',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'The financial period, e.g. "2026-Q1" or "2026-03".',
        },
      },
      required: ['period'],
    },
  },
  {
    type: 'function',
    name: 'detectAnomalies',
    description:
      'Scan all expense and revenue categories for items exceeding a variance threshold. Returns severity-classified anomaly alerts.',
    parameters: {
      type: 'object',
      properties: {
        period: {
          type: 'string',
          description: 'The financial period to scan.',
        },
        threshold_percent: {
          type: 'number',
          description: 'Variance threshold percentage. Use 10 for 10 percent.',
        },
      },
      required: ['period', 'threshold_percent'],
    },
  },
  {
    type: 'function',
    name: 'calculateTrend',
    description:
      'Calculate a historical trend for a financial metric over N months. Returns trend direction and overall change.',
    parameters: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          description: 'Metric to trend: revenue, gross_margin, ebitda, burn_rate, cash_runway, revenue_growth, opex, marketing.',
        },
        periods: {
          type: 'number',
          description: 'Number of months to include, e.g. 6.',
        },
      },
      required: ['metric', 'periods'],
    },
  },
  {
    type: 'function',
    name: 'get_current_date',
    description: 'Returns the current date and time.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function',
    name: 'get_company_context',
    description: 'Returns contextual information about the company — Contoso Financial.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    type: 'function',
    name: 'lookupPerson',
    description: 'Search for a person in the organization by name. Returns their display name, email address, job title, and department. Use this to find someone\'s email before sending them a message.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name or partial name of the person to look up.',
        },
      },
      required: ['name'],
    },
  },
];

// Execute a voice tool by name — same underlying functions as chat tools
export async function executeVoiceTool(name: string, params: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'analyzeBudgetVsActuals':
      return analyzeBudgetVsActuals(params as Parameters<typeof analyzeBudgetVsActuals>[0]);
    case 'getFinancialKPIs':
      return getFinancialKPIs(params as Parameters<typeof getFinancialKPIs>[0]);
    case 'detectAnomalies':
      return detectAnomalies(params as Parameters<typeof detectAnomalies>[0]);
    case 'calculateTrend':
      return calculateTrend(params as Parameters<typeof calculateTrend>[0]);
    case 'lookupPerson':
      return await lookupPerson(params as Parameters<typeof lookupPerson>[0]);
    case 'get_current_date':
      return { isoDate: new Date().toISOString(), utcString: new Date().toUTCString() };
    case 'get_company_context':
      return {
        name: 'Contoso Financial',
        ticker: 'CFIN',
        industry: 'Financial Services / FinTech',
        fiscalYearEnd: 'December 31',
        currency: 'USD',
      };
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
