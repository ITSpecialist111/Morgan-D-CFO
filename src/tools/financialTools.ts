import type { ChatCompletionTool } from 'openai/resources/chat';

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

interface CategoryRow {
  category: string;
  budget: number;
  actual: number;
  variance: number;
  variancePct: number;
  isAnomaly: boolean;
}

const MOCK_BASE: Record<string, { budget: number; actual: number }> = {
  Revenue:   { budget: 5_200_000, actual: 4_980_000 },
  COGS:      { budget: 1_820_000, actual: 1_960_000 },
  OPEX:      { budget:   750_000, actual:   832_000 },
  'R&D':     { budget:   420_000, actual:   398_000 },
  Sales:     { budget:   310_000, actual:   345_000 },
  Marketing: { budget:   220_000, actual:   258_000 },
};

function applyPeriodJitter(
  base: number,
  period: string,
  seed: number,
): number {
  // Deterministic pseudo-jitter so the same period always returns the same value
  const hash = [...period].reduce((a, c) => a + c.charCodeAt(0), seed);
  const factor = 1 + ((hash % 19) - 9) / 100; // ±9%
  return Math.round(base * factor);
}

function buildCategoryRows(period: string, filterCategory?: string): CategoryRow[] {
  const entries = filterCategory
    ? Object.entries(MOCK_BASE).filter(([k]) => k.toLowerCase() === filterCategory.toLowerCase())
    : Object.entries(MOCK_BASE);

  return entries.map(([category, base], i) => {
    const budget = applyPeriodJitter(base.budget, period, i * 7);
    const actual = applyPeriodJitter(base.actual, period, i * 13 + 3);
    const variance = actual - budget;
    const variancePct = parseFloat(((variance / budget) * 100).toFixed(2));
    const isAnomaly = variancePct > 10; // over budget by more than 10%
    return { category, budget, actual, variance, variancePct, isAnomaly };
  });
}

// ---------------------------------------------------------------------------
// 1. analyzeBudgetVsActuals
// ---------------------------------------------------------------------------

export interface BudgetAnalysisResult {
  company: string;
  period: string;
  summary: {
    totalBudget: number;
    totalActual: number;
    totalVariance: number;
    totalVariancePct: number;
    anomalyCount: number;
  };
  table: CategoryRow[];
  anomalies: CategoryRow[];
}

export function analyzeBudgetVsActuals(params: {
  period: string;
  category?: string;
}): BudgetAnalysisResult {
  const rows = buildCategoryRows(params.period, params.category);

  const totalBudget  = rows.reduce((s, r) => s + r.budget, 0);
  const totalActual  = rows.reduce((s, r) => s + r.actual, 0);
  const totalVariance = totalActual - totalBudget;
  const totalVariancePct = parseFloat(((totalVariance / totalBudget) * 100).toFixed(2));
  const anomalies = rows.filter(r => r.isAnomaly);

  return {
    company: 'Contoso Financial',
    period: params.period,
    summary: { totalBudget, totalActual, totalVariance, totalVariancePct, anomalyCount: anomalies.length },
    table: rows,
    anomalies,
  };
}

// ---------------------------------------------------------------------------
// 2. getFinancialKPIs
// ---------------------------------------------------------------------------

export interface FinancialKPIs {
  period: string;
  grossMarginPct: number;
  ebitda: number;
  cashRunwayMonths: number;
  burnRateMonthly: number;
  revenueGrowthPct: number;
  netRevenue: number;
}

export function getFinancialKPIs(params: { period: string }): FinancialKPIs {
  const rows = buildCategoryRows(params.period);
  const revenue = rows.find(r => r.category === 'Revenue')!.actual;
  const cogs    = rows.find(r => r.category === 'COGS')!.actual;
  const opex    = rows.find(r => r.category === 'OPEX')!.actual;
  const rnd     = rows.find(r => r.category === 'R&D')!.actual;

  const grossProfit    = revenue - cogs;
  const grossMarginPct = parseFloat(((grossProfit / revenue) * 100).toFixed(2));
  const ebitda         = Math.round(grossProfit - opex - rnd);

  // Cash runway: deterministic mock based on period hash
  const periodHash = [...params.period].reduce((a, c) => a + c.charCodeAt(0), 0);
  const cashOnHand   = 3_800_000 + (periodHash % 400_000);
  const burnRate     = Math.round((opex + rnd) / 1);
  const cashRunwayMonths = parseFloat((cashOnHand / burnRate).toFixed(1));

  // Revenue growth vs a synthetic prior period
  const priorRevenue = applyPeriodJitter(MOCK_BASE.Revenue.actual, params.period + '_prior', 99);
  const revenueGrowthPct = parseFloat((((revenue - priorRevenue) / priorRevenue) * 100).toFixed(2));

  return {
    period: params.period,
    grossMarginPct,
    ebitda,
    cashRunwayMonths,
    burnRateMonthly: burnRate,
    revenueGrowthPct,
    netRevenue: revenue,
  };
}

// ---------------------------------------------------------------------------
// 3. detectAnomalies
// ---------------------------------------------------------------------------

export interface AnomalyItem {
  category: string;
  variancePct: number;
  overBudgetAmount: number;
  severity: 'critical' | 'warning' | 'info';
}

export interface AnomalyDetectionResult {
  period: string;
  threshold: number;
  anomalies: AnomalyItem[];
  totalAnomalies: number;
}

export function detectAnomalies(params: {
  threshold_percent: number;
  period: string;
}): AnomalyDetectionResult {
  const rows = buildCategoryRows(params.period);
  const anomalies: AnomalyItem[] = rows
    .filter(r => r.variancePct > params.threshold_percent)
    .map(r => ({
      category: r.category,
      variancePct: r.variancePct,
      overBudgetAmount: r.variance,
      severity:
        r.variancePct > 25 ? 'critical' :
        r.variancePct > 15 ? 'warning'  : 'info',
    }));

  return {
    period: params.period,
    threshold: params.threshold_percent,
    anomalies,
    totalAnomalies: anomalies.length,
  };
}

// ---------------------------------------------------------------------------
// 4. calculateTrend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  period: string;
  value: number;
}

export interface TrendResult {
  metric: string;
  periods: TrendPoint[];
  direction: 'up' | 'down' | 'stable';
  overallChangePct: number;
}

const METRIC_BASE: Record<string, number> = {
  revenue:        4_980_000,
  gross_margin:   60.4,
  ebitda:         980_000,
  burn_rate:      185_000,
  cash_runway:    20.5,
  revenue_growth: 7.2,
  opex:           832_000,
  marketing:      258_000,
};

export function calculateTrend(params: {
  metric: string;
  periods: number;
}): TrendResult {
  const baseValue = METRIC_BASE[params.metric.toLowerCase()] ?? 1_000_000;
  const now = new Date();
  const trendPoints: TrendPoint[] = [];

  for (let i = params.periods - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const seed  = i * 17 + label.length;
    const value = applyPeriodJitter(baseValue, label, seed);
    trendPoints.push({ period: label, value });
  }

  const first = trendPoints[0].value;
  const last  = trendPoints[trendPoints.length - 1].value;
  const overallChangePct = parseFloat((((last - first) / first) * 100).toFixed(2));
  const direction: 'up' | 'down' | 'stable' =
    overallChangePct > 2  ? 'up'   :
    overallChangePct < -2 ? 'down' : 'stable';

  return { metric: params.metric, periods: trendPoints, direction, overallChangePct };
}

// ---------------------------------------------------------------------------
// 5. generateFinancialInsights
// ---------------------------------------------------------------------------

export interface InsightsResult {
  insights: string[];
  generatedAt: string;
}

export function generateFinancialInsights(params: {
  data_summary: string;
}): InsightsResult {
  const summary = params.data_summary.toLowerCase();

  const insights: string[] = [];

  if (summary.includes('over budget') || summary.includes('anomal')) {
    insights.push('• Investigate overspend categories immediately — multi-month overruns compress EBITDA and may signal process control gaps.');
  }
  if (summary.includes('revenue') && (summary.includes('miss') || summary.includes('below') || summary.includes('decline'))) {
    insights.push('• Revenue underperformance should trigger a pipeline review; assess whether deals slipped or were lost to identify corrective action.');
  }
  if (summary.includes('marketing') || summary.includes('sales')) {
    insights.push('• Evaluate Sales & Marketing ROI: if spend is rising while revenue is flat or declining, re-allocate budget toward higher-converting channels.');
  }
  if (summary.includes('cash') || summary.includes('burn') || summary.includes('runway')) {
    insights.push('• Monitor cash runway closely — if it falls below 12 months, initiate a funding or cost-reduction contingency plan.');
  }
  if (summary.includes('r&d') || summary.includes('research')) {
    insights.push('• R&D spend discipline is healthy; ensure milestones align with spend to demonstrate return on innovation investment to the board.');
  }

  // Always guarantee at least 3 insights
  if (insights.length < 3) {
    insights.push('• Consider rolling quarterly forecasts to replace static annual budgets — this improves agility in volatile markets.');
  }
  if (insights.length < 3) {
    insights.push('• Benchmark key cost ratios (COGS/Revenue, OPEX/Revenue) against industry peers to validate structural efficiency.');
  }
  if (insights.length < 4) {
    insights.push('• Automate variance alerts at the 5% and 10% thresholds so Finance can act in-period rather than post-close.');
  }

  return {
    insights: insights.slice(0, 5),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// OpenAI Tool Definitions
// ---------------------------------------------------------------------------

export const FINANCIAL_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'analyzeBudgetVsActuals',
      description:
        'Retrieve and analyse budget vs actual spend for Contoso Financial. Returns variance in $ and %, and flags categories that are more than 10% over budget as anomalies.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'The financial period to analyse, e.g. "2025-Q1", "2025-06", or "June 2025".',
          },
          category: {
            type: 'string',
            description: 'Optional: filter to a single expense/revenue category (e.g. "Marketing", "R&D").',
          },
        },
        required: ['period'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getFinancialKPIs',
      description:
        'Retrieve key financial KPIs for a given period: Gross Margin %, EBITDA, Cash Runway (months), Monthly Burn Rate, and Revenue Growth %.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'The financial period, e.g. "2025-Q2" or "2025-06".',
          },
        },
        required: ['period'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detectAnomalies',
      description:
        'Scan all expense and revenue categories for items that exceed a specified variance threshold, returning severity-classified anomaly alerts.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'The financial period to scan, e.g. "2025-Q1".',
          },
          threshold_percent: {
            type: 'number',
            description: 'The percentage variance threshold above which an item is flagged as an anomaly (e.g. 10 for 10%).',
          },
        },
        required: ['period', 'threshold_percent'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculateTrend',
      description:
        'Calculate a historical trend for a given financial metric over N months. Returns data points, overall % change, and trend direction (up/down/stable).',
      parameters: {
        type: 'object',
        properties: {
          metric: {
            type: 'string',
            description:
              'The metric to trend. Supported: revenue, gross_margin, ebitda, burn_rate, cash_runway, revenue_growth, opex, marketing.',
          },
          periods: {
            type: 'number',
            description: 'Number of monthly periods to include (e.g. 6 for the last 6 months).',
          },
        },
        required: ['metric', 'periods'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generateFinancialInsights',
      description:
        'Generate 3–5 actionable financial insights based on a plain-text summary of financial data. Returns bullet-point recommendations.',
      parameters: {
        type: 'object',
        properties: {
          data_summary: {
            type: 'string',
            description:
              'A plain-text description of the current financial situation, e.g. "Marketing is 18% over budget, revenue missed target by 4%, EBITDA is positive."',
          },
        },
        required: ['data_summary'],
      },
    },
  },
];
