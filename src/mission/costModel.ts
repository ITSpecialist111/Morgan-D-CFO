import { DefaultAzureCredential } from '@azure/identity';
import { getRecentAgentEvents, type AgentEvent } from '../observability/agentEvents';
import { getRecentMissionTaskRecords } from './missionControl';

const credential = new DefaultAzureCredential();

const DEFAULT_SUBSCRIPTION_ID = '260948a4-1d5e-42c8-b095-33a6641ad189';
const DEFAULT_RESOURCE_GROUP = 'rg-morgan-finance-agent';
const DEFAULT_AZURE_COST_CACHE_SECONDS = 15 * 60;
const DEFAULT_AZURE_COST_STALE_SECONDS = 60 * 60;

type CostSource = 'actual' | 'estimated' | 'mixed';

interface AzureCostRow {
  date: string;
  serviceName: string;
  resourceId: string;
  cost: number;
  currency: string;
}

interface AzureCostSnapshot {
  available: boolean;
  scope: string;
  currency: string;
  total: number;
  rows: AzureCostRow[];
  generatedAt?: string;
  error?: string;
}

interface CategoryEstimate {
  id: string;
  label: string;
  description: string;
  dailyCost: number;
  weeklyCost: number;
  dailyActual?: number;
  weeklyActual?: number;
  dailyEstimate: number;
  weeklyEstimate: number;
  source: CostSource;
  confidence: 'high' | 'medium' | 'low';
  drivers: string[];
}

interface DailyCostPoint {
  date: string;
  actual: number;
  estimated: number;
}

interface CostRateConfig {
  currency: string;
  avatarSessionMinute: number;
  teamsCallMinute: number;
  llmTurn: number;
  toolCall: number;
  mcpGraphCall: number;
  foundryTraceOrEval: number;
  fabricQuery: number;
  computeDailyFallback: number;
  storageObservabilityDailyFallback: number;
  agent365Daily: number;
  financeHourlyValue: number;
  hoursPerCompletedTask: number;
  defaultVoiceSessionMinutes: number;
  defaultTeamsCallMinutes: number;
}

let cachedAzureCostSnapshot: AzureCostSnapshot | null = null;
let cachedAzureCostSnapshotAt = 0;

export interface MorganCostDashboard {
  generatedAt: string;
  currency: string;
  summary: {
    dailyRunRate: number;
    weeklyRunRate: number;
    monthlyProjected: number;
    avatarDailyCost: number;
    avatarWeeklyCost: number;
    avatarSharePct: number;
    azureActualWeekly: number;
    estimatedWeekly: number;
    source: CostSource;
  };
  value: {
    completedTasksToday: number;
    completedTasksWeekly: number;
    estimatedHoursSavedToday: number;
    estimatedHoursSavedWeekly: number;
    estimatedValueToday: number;
    estimatedValueWeekly: number;
    valueToCostRatio: number;
    costPerCompletedTask: number;
  };
  activity: {
    daily: Record<string, number>;
    weekly: Record<string, number>;
  };
  categories: CategoryEstimate[];
  dailyTrend: DailyCostPoint[];
  azure: {
    available: boolean;
    scope: string;
    total: number;
    currency: string;
    serviceBreakdown: Array<{ serviceName: string; resourceId: string; category: string; weeklyCost: number; dailyCost: number }>;
    error?: string;
  };
  assumptions: string[];
  recommendations: string[];
  detailDashboard: string;
}

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function azureCostCacheMs(): number {
  return parseNumberEnv('MORGAN_COST_AZURE_CACHE_SECONDS', DEFAULT_AZURE_COST_CACHE_SECONDS) * 1000;
}

function azureCostStaleMs(): number {
  return parseNumberEnv('MORGAN_COST_AZURE_STALE_SECONDS', DEFAULT_AZURE_COST_STALE_SECONDS) * 1000;
}

function getRates(): CostRateConfig {
  return {
    currency: process.env.MORGAN_COST_CURRENCY || 'USD',
    avatarSessionMinute: parseNumberEnv('MORGAN_COST_AVATAR_SESSION_MINUTE', 0.12),
    teamsCallMinute: parseNumberEnv('MORGAN_COST_TEAMS_CALL_MINUTE', 0.08),
    llmTurn: parseNumberEnv('MORGAN_COST_LLM_TURN', 0.025),
    toolCall: parseNumberEnv('MORGAN_COST_TOOL_CALL', 0.003),
    mcpGraphCall: parseNumberEnv('MORGAN_COST_MCP_GRAPH_CALL', 0.002),
    foundryTraceOrEval: parseNumberEnv('MORGAN_COST_FOUNDRY_TRACE_OR_EVAL', 0.04),
    fabricQuery: parseNumberEnv('MORGAN_COST_FABRIC_QUERY', 0.03),
    computeDailyFallback: parseNumberEnv('MORGAN_COST_COMPUTE_DAILY_FALLBACK', 1.75),
    storageObservabilityDailyFallback: parseNumberEnv('MORGAN_COST_STORAGE_OBSERVABILITY_DAILY_FALLBACK', 0.35),
    agent365Daily: parseNumberEnv('MORGAN_COST_AGENT365_DAILY', 0),
    financeHourlyValue: parseNumberEnv('MORGAN_VALUE_FINANCE_HOURLY_RATE', 125),
    hoursPerCompletedTask: parseNumberEnv('MORGAN_VALUE_HOURS_PER_COMPLETED_TASK', 1.25),
    defaultVoiceSessionMinutes: parseNumberEnv('MORGAN_COST_DEFAULT_VOICE_SESSION_MINUTES', 3),
    defaultTeamsCallMinutes: parseNumberEnv('MORGAN_COST_DEFAULT_TEAMS_CALL_MINUTES', 4),
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function daysAgo(days: number): Date {
  const date = startOfUtcDay(new Date());
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function parseUsageDate(value: unknown): string {
  if (typeof value === 'number') {
    const text = String(value);
    if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  if (typeof value === 'string') {
    if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return dateOnly(date);
  }
  return dateOnly(new Date());
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function subscriptionId(): string {
  return process.env.AZURE_SUBSCRIPTION_ID || process.env.MORGAN_AZURE_SUBSCRIPTION_ID || DEFAULT_SUBSCRIPTION_ID;
}

function resourceGroupName(): string {
  return process.env.AZURE_RESOURCE_GROUP || process.env.WEBSITE_RESOURCE_GROUP || process.env.MORGAN_AZURE_RESOURCE_GROUP || DEFAULT_RESOURCE_GROUP;
}

async function queryAzureCosts(days = 7): Promise<AzureCostSnapshot> {
  const subId = subscriptionId();
  const rg = resourceGroupName();
  const scope = `/subscriptions/${subId}/resourceGroups/${rg}`;
  const now = Date.now();
  if (cachedAzureCostSnapshot?.available && cachedAzureCostSnapshot.scope === scope && now - cachedAzureCostSnapshotAt < azureCostCacheMs()) {
    return cachedAzureCostSnapshot;
  }

  try {
    const token = await credential.getToken('https://management.azure.com/.default');
    if (!token?.token) throw new Error('No Azure management token returned.');

    const from = dateOnly(daysAgo(days - 1));
    const toDate = new Date();
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    const to = dateOnly(toDate);
    const response = await fetch(`https://management.azure.com${scope}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'ActualCost',
        timeframe: 'Custom',
        timePeriod: { from, to },
        dataset: {
          granularity: 'Daily',
          aggregation: {
            totalCost: { name: 'PreTaxCost', function: 'Sum' },
          },
          grouping: [
            { type: 'Dimension', name: 'ServiceName' },
            { type: 'Dimension', name: 'ResourceId' },
          ],
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401 || text.includes('RBACAccessDenied')) {
        throw new Error('Azure Cost Management actuals are pending RBAC access for the Morgan App Service identity. Assign Cost Management Reader, Reader, or the Morgan Cost Query Reader custom role at the Morgan resource-group or subscription scope, then allow Azure RBAC propagation.');
      }
      throw new Error(`Cost Management query failed (${response.status}): ${text.slice(0, 400)}`);
    }

    const payload = await response.json() as {
      properties?: {
        columns?: Array<{ name?: string }>;
        rows?: unknown[][];
      };
    };
    const columns = payload.properties?.columns || [];
    const columnIndex = new Map(columns.map((column, index) => [String(column.name || '').toLowerCase(), index]));
    const rows = payload.properties?.rows || [];
    const costIndex = columnIndex.get('pretaxcost') ?? columnIndex.get('cost') ?? 0;
    const dateIndex = columnIndex.get('usagedate') ?? columnIndex.get('date') ?? 1;
    const serviceIndex = columnIndex.get('servicename') ?? 2;
    const resourceIndex = columnIndex.get('resourceid') ?? 3;
    const currencyIndex = columnIndex.get('currency');
    const costRows = rows.map((row) => ({
      date: parseUsageDate(row[dateIndex]),
      serviceName: String(row[serviceIndex] || 'Unassigned service'),
      resourceId: String(row[resourceIndex] || ''),
      cost: Number(row[costIndex] || 0),
      currency: currencyIndex === undefined ? 'USD' : String(row[currencyIndex] || 'USD'),
    })).filter((row) => Number.isFinite(row.cost));
    const total = costRows.reduce((sum, row) => sum + row.cost, 0);
    const snapshot = {
      available: true,
      scope,
      currency: costRows.find((row) => row.currency)?.currency || 'USD',
      total,
      rows: costRows,
      generatedAt: new Date().toISOString(),
    };
    cachedAzureCostSnapshot = snapshot;
    cachedAzureCostSnapshotAt = now;
    return snapshot;
  } catch (error) {
    if (cachedAzureCostSnapshot?.available && cachedAzureCostSnapshot.scope === scope && Date.now() - cachedAzureCostSnapshotAt < azureCostStaleMs()) {
      return cachedAzureCostSnapshot;
    }
    return {
      available: false,
      scope,
      currency: 'USD',
      total: 0,
      rows: [],
      error: toErrorMessage(error),
    };
  }
}

function isInWindow(event: AgentEvent, sinceMs: number): boolean {
  const time = new Date(event.ts).getTime();
  return Number.isFinite(time) && time >= sinceMs;
}

function distinctCount(events: AgentEvent[], kind: string): number {
  const ids = new Set<string>();
  events.filter((event) => event.kind === kind).forEach((event) => ids.add(event.correlationId || event.id));
  return ids.size;
}

function countActivity(events: AgentEvent[]): Record<string, number> {
  const llmTurns = events.filter((event) => event.kind === 'llm.turn').length;
  const toolCalls = events.filter((event) => event.kind === 'tool.call').length;
  const toolResults = events.filter((event) => event.kind === 'tool.result').length;
  const mcpGraphCalls = events.filter((event) => event.kind === 'mcp.discover' || event.kind === 'mcp.invoke' || event.kind === 'graph.call').length;
  const voiceSessions = distinctCount(events, 'voice.session');
  const teamsCalls = distinctCount(events, 'teams.call');
  const completedTasks = events.filter((event) => event.kind === 'mission.task' && event.status === 'ok').length;
  const foundrySignals = events.filter((event) => String(event.data?.source || event.label || '').toLowerCase().includes('foundry')).length;
  const fabricSignals = events.filter((event) => {
    const text = `${String(event.data?.source || '')} ${String(event.data?.tool || '')} ${event.label}`.toLowerCase();
    return text.includes('fabric') || text.includes('powerbi') || text.includes('power bi');
  }).length;
  return {
    llmTurns,
    toolCalls,
    toolResults,
    mcpGraphCalls,
    voiceSessions,
    teamsCalls,
    completedTasks,
    foundrySignals,
    fabricSignals,
  };
}

function categoryForAzureRow(row: AzureCostRow): string {
  const text = `${row.serviceName} ${row.resourceId}`.toLowerCase();
  if (text.includes('communication') || text.includes('speech') || text.includes('voice') || text.includes('acs')) return 'voice-avatar';
  if (text.includes('openai') || text.includes('cognitive') || text.includes('ai services') || text.includes('machine learning')) return 'foundry-ai';
  if (text.includes('app service') || text.includes('web app') || text.includes('bandwidth') || text.includes('static web')) return 'compute';
  if (text.includes('application insights') || text.includes('log analytics') || text.includes('monitor')) return 'storage-observability';
  if (text.includes('cosmos') || text.includes('storage')) return 'storage-observability';
  if (text.includes('fabric') || text.includes('power bi')) return 'fabric-iq';
  return 'tools-integration';
}

function sumAzure(rows: AzureCostRow[], category: string, date?: string): number {
  return rows
    .filter((row) => categoryForAzureRow(row) === category)
    .filter((row) => !date || row.date === date)
    .reduce((sum, row) => sum + row.cost, 0);
}

function estimateCosts(activity: Record<string, number>, rates: CostRateConfig): Record<string, number> {
  const voiceMinutes = activity.voiceSessions * rates.defaultVoiceSessionMinutes;
  const teamsMinutes = activity.teamsCalls * rates.defaultTeamsCallMinutes;
  return {
    'voice-avatar': (voiceMinutes * rates.avatarSessionMinute) + (teamsMinutes * rates.teamsCallMinute),
    'foundry-ai': (activity.llmTurns * rates.llmTurn) + (activity.foundrySignals * rates.foundryTraceOrEval),
    'agent365-microsoft-iq': rates.agent365Daily + (activity.mcpGraphCalls * rates.mcpGraphCall),
    'fabric-iq': activity.fabricSignals * rates.fabricQuery,
    'tools-integration': Math.max(0, activity.toolCalls + activity.toolResults - activity.mcpGraphCalls) * rates.toolCall,
    compute: rates.computeDailyFallback,
    'storage-observability': rates.storageObservabilityDailyFallback,
  };
}

function categoryDefinition(id: string): { label: string; description: string; drivers: string[] } {
  const definitions: Record<string, { label: string; description: string; drivers: string[] }> = {
    'voice-avatar': {
      label: 'Realtime Avatar + Teams Voice',
      description: 'Azure Voice Live, Speech avatar relay, ACS media streaming, and Teams federation audio.',
      drivers: ['Avatar session minutes', 'Teams call minutes', 'Speech/ACS meters'],
    },
    'foundry-ai': {
      label: 'Foundry + AI Inference',
      description: 'Azure OpenAI / Foundry model turns, hosted responses, traces, evaluation, and reasoning loops.',
      drivers: ['LLM turns', 'Foundry traces', 'Evaluation signals'],
    },
    'agent365-microsoft-iq': {
      label: 'Agent 365 + Microsoft IQ',
      description: 'Agent identity, WorkIQ, Microsoft 365 Graph, MCP tool calls, and governed enterprise context.',
      drivers: ['Agent user/license assumptions', 'Graph calls', 'MCP invocations'],
    },
    'fabric-iq': {
      label: 'Fabric IQ + Business Data',
      description: 'Fabric/Power BI semantic model reads and cross-functional business insight lookups.',
      drivers: ['Semantic model queries', 'Capacity/licensing assumptions'],
    },
    'tools-integration': {
      label: 'Finance Tools + Automations',
      description: 'Budget analysis, KPI reports, anomaly detection, report creation, scheduler and sub-agent handoffs.',
      drivers: ['Tool calls', 'Planner/Word/Mail actions', 'Autonomous runs'],
    },
    compute: {
      label: 'Compute + Hosting',
      description: 'App Service runtime, always-on hosting, zip deployments, and background scheduler.',
      drivers: ['App Service plan', 'Always-on runtime', 'Outbound bandwidth'],
    },
    'storage-observability': {
      label: 'Storage + Observability',
      description: 'Cosmos state, Application Insights, Log Analytics, audit events, and trace retention.',
      drivers: ['State reads/writes', 'Telemetry volume', 'Retention'],
    },
  };
  return definitions[id] || { label: id, description: 'Unmapped Morgan project cost.', drivers: ['Azure service meter'] };
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function buildServiceBreakdown(rows: AzureCostRow[], today: string): Array<{ serviceName: string; resourceId: string; category: string; weeklyCost: number; dailyCost: number }> {
  const grouped = new Map<string, { serviceName: string; resourceId: string; category: string; weeklyCost: number; dailyCost: number }>();
  rows.forEach((row) => {
    const key = `${row.serviceName}|${row.resourceId}`;
    const existing = grouped.get(key) || {
      serviceName: row.serviceName,
      resourceId: row.resourceId,
      category: categoryForAzureRow(row),
      weeklyCost: 0,
      dailyCost: 0,
    };
    existing.weeklyCost += row.cost;
    if (row.date === today) existing.dailyCost += row.cost;
    grouped.set(key, existing);
  });
  return Array.from(grouped.values())
    .map((item) => ({ ...item, weeklyCost: roundMoney(item.weeklyCost), dailyCost: roundMoney(item.dailyCost) }))
    .sort((a, b) => b.weeklyCost - a.weeklyCost);
}

export async function getMorganCostDashboard(): Promise<MorganCostDashboard> {
  const rates = getRates();
  const now = new Date();
  const today = dateOnly(now);
  const events = getRecentAgentEvents({ limit: 1000 });
  const dailyEvents = events.filter((event) => isInWindow(event, Date.now() - 24 * 60 * 60_000));
  const weeklyEvents = events.filter((event) => isInWindow(event, Date.now() - 7 * 24 * 60 * 60_000));
  const dailyActivity = countActivity(dailyEvents);
  const weeklyActivity = countActivity(weeklyEvents);
  const dailyMissionRecords = getRecentMissionTaskRecords(1);
  const weeklyMissionRecords = getRecentMissionTaskRecords(7);
  dailyActivity.completedTasks = Math.max(dailyActivity.completedTasks, dailyMissionRecords.filter((record) => record.status === 'completed').length);
  weeklyActivity.completedTasks = Math.max(weeklyActivity.completedTasks, weeklyMissionRecords.filter((record) => record.status === 'completed').length);
  const dailyEstimates = estimateCosts(dailyActivity, rates);
  const weeklyEstimates = estimateCosts({ ...weeklyActivity, completedTasks: weeklyActivity.completedTasks }, { ...rates, computeDailyFallback: rates.computeDailyFallback * 7, storageObservabilityDailyFallback: rates.storageObservabilityDailyFallback * 7, agent365Daily: rates.agent365Daily * 7 });
  const azure = await queryAzureCosts(7);
  const categoryIds = ['voice-avatar', 'foundry-ai', 'agent365-microsoft-iq', 'fabric-iq', 'tools-integration', 'compute', 'storage-observability'];
  const categories = categoryIds.map((id) => {
    const definition = categoryDefinition(id);
    const dailyActual = azure.available ? sumAzure(azure.rows, id, today) : undefined;
    const weeklyActual = azure.available ? sumAzure(azure.rows, id) : undefined;
    const actualDailyUseful = typeof dailyActual === 'number' && dailyActual > 0;
    const actualWeeklyUseful = typeof weeklyActual === 'number' && weeklyActual > 0;
    const dailyEstimate = dailyEstimates[id] || 0;
    const weeklyEstimate = weeklyEstimates[id] || dailyEstimate * 7;
    const dailyCost = actualDailyUseful ? dailyActual : dailyEstimate;
    const weeklyCost = actualWeeklyUseful ? weeklyActual : weeklyEstimate;
    const source: CostSource = actualWeeklyUseful && weeklyEstimate > 0 ? 'mixed' : actualWeeklyUseful ? 'actual' : 'estimated';
    return {
      id,
      label: definition.label,
      description: definition.description,
      dailyCost: roundMoney(dailyCost),
      weeklyCost: roundMoney(weeklyCost),
      dailyActual: typeof dailyActual === 'number' ? roundMoney(dailyActual) : undefined,
      weeklyActual: typeof weeklyActual === 'number' ? roundMoney(weeklyActual) : undefined,
      dailyEstimate: roundMoney(dailyEstimate),
      weeklyEstimate: roundMoney(weeklyEstimate),
      source,
      confidence: actualWeeklyUseful ? 'high' : id === 'agent365-microsoft-iq' || id === 'fabric-iq' ? 'low' : 'medium',
      drivers: definition.drivers,
    } satisfies CategoryEstimate;
  });
  const dailyRunRate = categories.reduce((sum, category) => sum + category.dailyCost, 0);
  const weeklyRunRate = categories.reduce((sum, category) => sum + category.weeklyCost, 0);
  const avatar = categories.find((category) => category.id === 'voice-avatar');
  const completedTasksToday = dailyActivity.completedTasks;
  const completedTasksWeekly = weeklyActivity.completedTasks;
  const estimatedHoursSavedToday = roundMoney((completedTasksToday * rates.hoursPerCompletedTask) + (dailyActivity.toolCalls * 0.05) + (dailyActivity.mcpGraphCalls * 0.03));
  const estimatedHoursSavedWeekly = roundMoney((completedTasksWeekly * rates.hoursPerCompletedTask) + (weeklyActivity.toolCalls * 0.05) + (weeklyActivity.mcpGraphCalls * 0.03));
  const estimatedValueToday = roundMoney(estimatedHoursSavedToday * rates.financeHourlyValue);
  const estimatedValueWeekly = roundMoney(estimatedHoursSavedWeekly * rates.financeHourlyValue);
  const dailyTrend = Array.from({ length: 7 }).map((_, index) => {
    const date = dateOnly(daysAgo(6 - index));
    const actual = azure.rows.filter((row) => row.date === date).reduce((sum, row) => sum + row.cost, 0);
    return { date, actual: roundMoney(actual), estimated: roundMoney(weeklyRunRate / 7) };
  });
  return {
    generatedAt: now.toISOString(),
    currency: azure.available ? azure.currency : rates.currency,
    summary: {
      dailyRunRate: roundMoney(dailyRunRate),
      weeklyRunRate: roundMoney(weeklyRunRate),
      monthlyProjected: roundMoney(dailyRunRate * 30.4),
      avatarDailyCost: avatar?.dailyCost || 0,
      avatarWeeklyCost: avatar?.weeklyCost || 0,
      avatarSharePct: weeklyRunRate > 0 ? Math.round(((avatar?.weeklyCost || 0) / weeklyRunRate) * 100) : 0,
      azureActualWeekly: roundMoney(azure.total),
      estimatedWeekly: roundMoney(categories.reduce((sum, category) => sum + category.weeklyEstimate, 0)),
      source: azure.available ? 'mixed' : 'estimated',
    },
    value: {
      completedTasksToday,
      completedTasksWeekly,
      estimatedHoursSavedToday,
      estimatedHoursSavedWeekly,
      estimatedValueToday,
      estimatedValueWeekly,
      valueToCostRatio: weeklyRunRate > 0 ? roundMoney(estimatedValueWeekly / weeklyRunRate) : 0,
      costPerCompletedTask: completedTasksWeekly > 0 ? roundMoney(weeklyRunRate / completedTasksWeekly) : 0,
    },
    activity: { daily: dailyActivity, weekly: weeklyActivity },
    categories: categories.sort((a, b) => b.weeklyCost - a.weeklyCost),
    dailyTrend,
    azure: {
      available: azure.available,
      scope: azure.scope,
      total: roundMoney(azure.total),
      currency: azure.currency,
      serviceBreakdown: buildServiceBreakdown(azure.rows, today),
      error: azure.error,
    },
    assumptions: [
      'Azure Cost Management data is grouped at the Morgan resource-group scope and can lag behind live usage until billing data refreshes.',
      'Realtime avatar and Teams voice are modelled from observed voice/Teams sessions unless the exact Speech, Voice Live, and ACS meters are present in Azure Cost Management.',
      'Agent 365, Microsoft 365, Fabric, Power BI, and Copilot licensing may not appear in Azure subscription costs; configure MORGAN_COST_* environment variables for customer-specific chargeback.',
      `Value uses ${rates.financeHourlyValue} ${rates.currency}/hour and ${rates.hoursPerCompletedTask} hour(s) saved per completed CFO task.`,
    ],
    recommendations: [
      'Tag all Morgan resources with project=Morgan and costCenter=DigitalCFO so Cost Management can split project cost cleanly across shared subscriptions.',
      'Track avatar session minutes separately; the realtime avatar/voice path is expected to be the largest variable cost during demos.',
      'Set customer-specific MORGAN_COST_AGENT365_DAILY, MORGAN_COST_FABRIC_QUERY, and MORGAN_COST_AVATAR_SESSION_MINUTE values when moving from showcase estimates to enterprise chargeback.',
      'Add a budget alert at the Morgan resource-group scope and review weekly run-rate changes before customer demos.',
    ],
    detailDashboard: '/mission-control/costs',
  };
}