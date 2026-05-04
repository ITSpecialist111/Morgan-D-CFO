import type { ChatCompletionTool } from 'openai/resources/chat';
import { analyzeBudgetVsActuals, calculateTrend, detectAnomalies, getFinancialKPIs } from './financialTools';
import { recordAgentEvent } from '../observability/agentEvents';

export type MicrosoftIQPillar = 'WorkIQ' | 'FoundryIQ' | 'FabricIQ';

export interface IQCapability {
  pillar: MicrosoftIQPillar;
  roleInMorgan: string;
  demoSource: string;
  productionSource: string;
  signals: string[];
  tools: string[];
  status: 'live-demo' | 'configured' | 'production-ready-path';
}

export interface WorkIQSignals {
  pillar: 'WorkIQ';
  generatedAt: string;
  period: string;
  meetingLoad: number;
  financeThreads: number;
  pendingApprovals: number;
  plannerTasksDue: number;
  sharePointArtifacts: string[];
  topSignals: string[];
  evidence: string[];
}

export interface FabricIQMetrics {
  pillar: 'FabricIQ';
  generatedAt: string;
  period: string;
  semanticModel: string;
  lakehouse: string;
  metrics: {
    revenue: number;
    grossMarginPct: number;
    ebitda: number;
    cashRunwayMonths: number;
    pipelineCoverage: number;
    netRevenueRetentionPct: number;
    headcountCost: number;
    supportCostPerCustomer: number;
  };
  crossFunctionalSignals: Array<{ function: string; signal: string; value: string; cfoImplication: string }>;
  evidence: string[];
}

export interface FoundryIQInsights {
  pillar: 'FoundryIQ';
  generatedAt: string;
  period: string;
  focus: string;
  knowledgeSources: string[];
  modelInsights: string[];
  evaluationSignals: Array<{ evaluator: string; score: number; finding: string }>;
  recommendedActions: string[];
  evidence: string[];
}

export interface MicrosoftIQBriefing {
  generatedAt: string;
  period: string;
  audience: string;
  operatingWindow: string;
  headline: string;
  pillars: {
    workIQ: WorkIQSignals;
    foundryIQ: FoundryIQInsights;
    fabricIQ: FabricIQMetrics;
  };
  executiveSummary: string[];
  autonomousActions: string[];
  evidence: string[];
  productionPath: string[];
}

function currentPeriod(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function periodSeed(period: string): number {
  return [...period].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function currency(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function getMicrosoftIQCapabilityMap(): { operatingWindow: string; capabilities: IQCapability[] } {
  return {
    operatingWindow: '09:00-17:00, seven days a week',
    capabilities: [
      {
        pillar: 'WorkIQ',
        roleInMorgan: 'Turns Microsoft 365 work context into CFO action: meetings, mail, Teams, Planner, SharePoint, and approvals.',
        demoSource: 'Deterministic Microsoft 365 work-graph signals plus live Agent 365 MCP/Graph tools when configured.',
        productionSource: 'Microsoft Graph, Agent 365 MCP servers, SharePoint/OneDrive, Teams, Outlook, Planner, Word, and Excel.',
        signals: ['meeting context', 'approval pressure', 'finance thread volume', 'document evidence', 'planner due work'],
        tools: ['collectMeetingContext', 'sendEmail', 'sendTeamsMessage', 'createPlannerTask', 'readSharePointData'],
        status: 'configured',
      },
      {
        pillar: 'FoundryIQ',
        roleInMorgan: 'Adds model, knowledge, evaluation, trace, and agent intelligence so Morgan can explain why an insight is reliable.',
        demoSource: 'Synthetic Foundry knowledge/evaluation signals generated from Morgan task records, prompt contract, and finance focus.',
        productionSource: 'Azure AI Foundry agents, model deployments, knowledge indexes, prompt/eval datasets, traces, and Application Insights.',
        signals: ['knowledge grounding', 'model reasoning confidence', 'evaluation drift', 'agent trace health', 'artifact readiness'],
        tools: ['queryFoundryIQInsights', 'evaluateMissionArtifact', 'getEnterpriseReadiness', 'POST /responses'],
        status: 'live-demo',
      },
      {
        pillar: 'FabricIQ',
        roleInMorgan: 'Supplies governed business figures and cross-functional metrics from the analytics estate.',
        demoSource: 'Deterministic Fabric-style semantic model and lakehouse metrics for Contoso Financial.',
        productionSource: 'Microsoft Fabric Lakehouse, Warehouse, Data Activator, Power BI semantic models, OneLake shortcuts, and Data Factory pipelines.',
        signals: ['revenue and margin', 'pipeline coverage', 'headcount cost', 'customer retention', 'support cost'],
        tools: ['queryFabricIQFinancials', 'synthesizeMicrosoftIQBriefing', 'analyzeBudgetVsActuals', 'getFinancialKPIs'],
        status: 'live-demo',
      },
    ],
  };
}

export function queryWorkIQSignals(params: { period?: string; focus?: string } = {}): WorkIQSignals {
  const period = params.period || currentPeriod();
  const seed = periodSeed(period);
  const focus = params.focus || 'CFO operating day';
  const meetingLoad = 8 + (seed % 5);
  const financeThreads = 21 + (seed % 9);
  const pendingApprovals = 3 + (seed % 4);
  const plannerTasksDue = 6 + (seed % 6);
  return {
    pillar: 'WorkIQ',
    generatedAt: new Date().toISOString(),
    period,
    meetingLoad,
    financeThreads,
    pendingApprovals,
    plannerTasksDue,
    sharePointArtifacts: [
      `${period} CFO pack draft.docx`,
      `${period} Budget variance workbook.xlsx`,
      'Board risk register - finance.xlsx',
    ],
    topSignals: [
      `${meetingLoad} finance-facing meetings require prep or follow-up across the 9-5 operating window.`,
      `${pendingApprovals} approval items should be checked before Morgan sends external-facing finance updates.`,
      `${plannerTasksDue} Planner tasks are due or near due for finance owners.`,
      `${focus} should prioritize the finance-health-check and Microsoft IQ synthesis loops.`,
    ],
    evidence: ['WorkIQ demo work graph', 'Agent 365 MCP/Graph tool catalog', 'Mission Control task cadence'],
  };
}

export function queryFabricIQFinancials(params: { period?: string; business_unit?: string } = {}): FabricIQMetrics {
  const period = params.period || currentPeriod();
  const businessUnit = params.business_unit || 'All business units';
  const kpis = getFinancialKPIs({ period });
  const budget = analyzeBudgetVsActuals({ period });
  const seed = periodSeed(`${period}:${businessUnit}`);
  const pipelineCoverage = Number((2.7 + (seed % 9) / 10).toFixed(1));
  const netRevenueRetentionPct = Number((104 + (seed % 8) * 1.3).toFixed(1));
  const headcountCost = 1_420_000 + (seed % 220_000);
  const supportCostPerCustomer = 128 + (seed % 34);
  return {
    pillar: 'FabricIQ',
    generatedAt: new Date().toISOString(),
    period,
    semanticModel: 'Contoso CFO Semantic Model',
    lakehouse: 'OneLake://contoso-finance/fabric-iq-showcase',
    metrics: {
      revenue: kpis.netRevenue,
      grossMarginPct: kpis.grossMarginPct,
      ebitda: kpis.ebitda,
      cashRunwayMonths: kpis.cashRunwayMonths,
      pipelineCoverage,
      netRevenueRetentionPct,
      headcountCost,
      supportCostPerCustomer,
    },
    crossFunctionalSignals: [
      { function: 'Sales', signal: 'Pipeline coverage', value: `${pipelineCoverage}x`, cfoImplication: pipelineCoverage < 3 ? 'Forecast risk needs CRO review.' : 'Coverage supports near-term revenue plan.' },
      { function: 'Customer Success', signal: 'Net revenue retention', value: pct(netRevenueRetentionPct), cfoImplication: netRevenueRetentionPct < 108 ? 'Retention drag may pressure ARR growth.' : 'Expansion motion is supporting plan.' },
      { function: 'People', signal: 'Headcount cost', value: currency(headcountCost), cfoImplication: headcountCost > 1_560_000 ? 'Hiring pace should be checked against runway.' : 'People cost is inside current operating envelope.' },
      { function: 'Support', signal: 'Cost per customer', value: currency(supportCostPerCustomer), cfoImplication: supportCostPerCustomer > 150 ? 'Support cost warrants workflow or product-deflection review.' : 'Support cost is stable for the current customer base.' },
      { function: 'Finance', signal: 'Budget variance', value: `${currency(budget.summary.totalVariance)} (${budget.summary.totalVariancePct}%)`, cfoImplication: budget.summary.anomalyCount ? 'Morgan should inspect variance drivers before stakeholder reporting.' : 'No material variance pattern in the demo semantic model.' },
    ],
    evidence: ['Fabric demo semantic model', 'Fabric lakehouse finance mart', 'Power BI executive KPI layer'],
  };
}

export function queryFoundryIQInsights(params: { period?: string; focus?: string } = {}): FoundryIQInsights {
  const period = params.period || currentPeriod();
  const focus = params.focus || 'autonomous CFO operating plan';
  const anomalies = detectAnomalies({ period, threshold_percent: 10 });
  const revenueTrend = calculateTrend({ metric: 'revenue', periods: 6 });
  const evaluationBase = anomalies.totalAnomalies > 0 ? 84 : 91;
  return {
    pillar: 'FoundryIQ',
    generatedAt: new Date().toISOString(),
    period,
    focus,
    knowledgeSources: [
      'Morgan system prompt and job contract',
      'CorpGen paper alignment matrix',
      'Foundry hosted-agent response traces',
      'Mission Control artifact judge results',
      'Synthetic finance knowledge index for Contoso Financial',
    ],
    modelInsights: [
      `Focus area "${focus}" maps to Morgan's CorpGen loop: plan, retrieve memory, call tools, record proof, reflect.`,
      `${anomalies.totalAnomalies} finance anomaly signal(s) should influence the next autonomous CFO task selection.`,
      `Revenue trend is ${revenueTrend.direction} over ${revenueTrend.periods.length} periods with ${revenueTrend.overallChangePct}% movement.`,
      'Foundry IQ should judge customer-facing outputs before Morgan treats them as final.',
    ],
    evaluationSignals: [
      { evaluator: 'intent_resolution', score: evaluationBase + 4, finding: 'Morgan can map CFO requests to IQ-backed tools and visible Mission Control proof.' },
      { evaluator: 'task_adherence', score: evaluationBase, finding: anomalies.totalAnomalies ? 'Variance work should remain first-class in the autonomous queue.' : 'Current plan follows the operating contract.' },
      { evaluator: 'groundedness', score: evaluationBase - 2, finding: 'Demo data is deterministic; production rollout should connect Foundry knowledge indexes and Fabric semantic models.' },
      { evaluator: 'artifact_readiness', score: evaluationBase + 1, finding: 'Briefings should include WorkIQ, FoundryIQ, and FabricIQ evidence labels.' },
    ],
    recommendedActions: [
      'Use Fabric IQ for governed KPI figures before writing financial claims.',
      'Use WorkIQ to find meetings, approvals, and stakeholder follow-up obligations.',
      'Use Foundry IQ to ground the narrative, evaluate output quality, and expose trace/evaluation evidence.',
      'Record the Microsoft IQ synthesis as a Mission Control task before day-end reporting.',
    ],
    evidence: ['Foundry demo knowledge index', 'Foundry evaluator bundle', 'Application Insights trace pattern', 'Mission Control Agent Mind'],
  };
}

export function synthesizeMicrosoftIQBriefing(params: { period?: string; audience?: string; focus?: string; record_event?: boolean } = {}): MicrosoftIQBriefing {
  const period = params.period || currentPeriod();
  const audience = params.audience || 'CFO and executive operators';
  const workIQ = queryWorkIQSignals({ period, focus: params.focus });
  const foundryIQ = queryFoundryIQInsights({ period, focus: params.focus });
  const fabricIQ = queryFabricIQFinancials({ period });
  const varianceSignal = fabricIQ.crossFunctionalSignals.find((signal) => signal.function === 'Finance');
  const headline = `Microsoft IQ briefing for ${period}: ${currency(fabricIQ.metrics.revenue)} revenue, ${fabricIQ.metrics.grossMarginPct}% gross margin, ${fabricIQ.metrics.pipelineCoverage}x pipeline coverage, ${workIQ.pendingApprovals} approval item(s).`;
  const executiveSummary = [
    `Fabric IQ shows ${currency(fabricIQ.metrics.revenue)} revenue, ${currency(fabricIQ.metrics.ebitda)} EBITDA, and ${fabricIQ.metrics.cashRunwayMonths} months cash runway.`,
    `WorkIQ shows ${workIQ.meetingLoad} finance meetings, ${workIQ.financeThreads} finance threads, and ${workIQ.pendingApprovals} pending approvals needing CFO-office attention.`,
    `Foundry IQ recommends grounding the narrative in the finance semantic model and judging the final artifact before delivery.`,
    varianceSignal ? `Finance signal: ${varianceSignal.value} total variance; ${varianceSignal.cfoImplication}` : 'Finance signal: no variance summary available.',
  ];
  const autonomousActions = [
    '09:00: refresh WorkIQ stakeholder and approval context.',
    '09:25-16:35: run Fabric IQ finance/cross-functional checks every execution cycle when the queue is open.',
    'Before sending: use Foundry IQ artifact readiness signals and Mission Control proof requirements.',
    '17:00: record Microsoft IQ synthesis in the CFO day-end breakdown.',
  ];
  const briefing: MicrosoftIQBriefing = {
    generatedAt: new Date().toISOString(),
    period,
    audience,
    operatingWindow: '09:00-17:00, seven days a week',
    headline,
    pillars: { workIQ, foundryIQ, fabricIQ },
    executiveSummary,
    autonomousActions,
    evidence: [...workIQ.evidence, ...foundryIQ.evidence, ...fabricIQ.evidence],
    productionPath: [
      'Connect WorkIQ to live Graph/Agent 365 MCP servers for mail, meetings, Teams, SharePoint, Planner, Word, and Excel.',
      'Connect Foundry IQ to Foundry knowledge indexes, trace telemetry, eval datasets, model deployments, and prompt optimization workflows.',
      'Connect Fabric IQ to the production OneLake/Lakehouse, Warehouse, Data Factory pipelines, Power BI semantic models, and governed shortcuts.',
      'Keep the same tool contracts so the showcase works now and the implementation swaps demo adapters for tenant-owned data later.',
    ],
  };
  if (params.record_event !== false) {
    recordAgentEvent({
      kind: 'tool.result',
      label: `Microsoft IQ briefing synthesized for ${period}`,
      status: 'ok',
      data: { source: 'Microsoft IQ showcase', period, audience, workSignals: workIQ.topSignals.length, foundryInsights: foundryIQ.modelInsights.length, fabricSignals: fabricIQ.crossFunctionalSignals.length },
    });
  }
  return briefing;
}

export const IQ_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'getMicrosoftIQCapabilityMap',
      description: 'Return how Morgan uses WorkIQ, Foundry IQ, and Fabric IQ in the autonomous CFO operating model, including demo and production data sources.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queryWorkIQSignals',
      description: 'Return Microsoft 365 work-context signals for Morgan: meetings, mail/Teams thread pressure, approvals, Planner due work, and SharePoint artifacts.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Optional yyyy-mm period. Defaults to current month.' },
          focus: { type: 'string', description: 'Optional CFO workflow focus.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queryFoundryIQInsights',
      description: 'Return Foundry IQ-style knowledge, model, trace, and evaluation insights for Morgan CFO work.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Optional yyyy-mm period. Defaults to current month.' },
          focus: { type: 'string', description: 'Optional business or CFO focus area.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queryFabricIQFinancials',
      description: 'Return Fabric IQ-style financial and cross-functional figures from a deterministic demo semantic model.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Optional yyyy-mm period. Defaults to current month.' },
          business_unit: { type: 'string', description: 'Optional business-unit filter.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'synthesizeMicrosoftIQBriefing',
      description: 'Combine WorkIQ, Foundry IQ, and Fabric IQ into an executive CFO briefing with evidence and autonomous actions.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Optional yyyy-mm period. Defaults to current month.' },
          audience: { type: 'string', description: 'Optional target audience.' },
          focus: { type: 'string', description: 'Optional CFO focus area.' },
          record_event: { type: 'boolean', description: 'Whether to record a visible Agent Mind event. Defaults to true.' },
        },
        required: [],
      },
    },
  },
];
