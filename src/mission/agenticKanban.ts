export type AgenticKanbanLink = {
  configured: boolean;
  label: string;
  provider: string;
  source: 'configured-url' | 'power-app-ids' | 'flightdeck-demo' | 'internal-fallback';
  url: string;
  fallbackUrl: string;
  demoUrl: string;
  openTarget: '_blank' | '_self';
  powerPlatform: {
    appDisplayName: string;
    appId?: string;
    environmentId?: string;
  };
  proof: {
    dataverseBacked: boolean;
    pollIntervalSeconds: number;
    subAgents: string[];
    tables: string[];
  };
};

const INTERNAL_KANBAN_URL = '/mission-control#autonomousKanban';
const FLIGHTDECK_DEMO_URL = 'https://demo-dev.yellowmeadow-084e6936.uksouth.azurecontainerapps.io';
const FLIGHTDECK_APP_ID = 'a18a78d8-3e49-4f1b-ab4d-36e1dbc82e03';
const FLIGHTDECK_ENVIRONMENT_ID = 'ab762569-955e-ec43-9a92-c2bbcbec9210';
const FLIGHTDECK_TENANT_ID = 'e4ccbd32-1a13-4cb6-8fda-c392e7ea359f';
const FLIGHTDECK_HINT = '0fdc48af-8b7e-4a3d-bbe7-4d69f224ab06';
const FLIGHTDECK_SOURCE_TIME = '1774506621012';

function configuredValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || /<[^>]+>|your-|example|\.\.\.|optional-/i.test(trimmed)) return undefined;
  return trimmed;
}

function safeLaunchUrl(value: string | undefined): string | undefined {
  const candidate = configuredValue(value);
  if (!candidate) return undefined;
  if (candidate.startsWith('/') && !candidate.startsWith('//')) return candidate;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function firstSafeLaunchUrl(...values: Array<string | undefined>): string | undefined {
  return values.map(safeLaunchUrl).find(Boolean);
}

function buildPowerAppsAppOpenUri(
  appId: string | undefined,
  environmentId: string | undefined,
  tenantId: string | undefined,
  hint: string | undefined,
  sourceTime: string | undefined,
): string | undefined {
  const app = configuredValue(appId);
  const environment = configuredValue(environmentId);
  const tenant = configuredValue(tenantId);
  const appHint = configuredValue(hint);
  if (!app || !environment || !tenant || !appHint) return undefined;
  const query = new URLSearchParams({ tenantId: tenant, hint: appHint });
  const appSourceTime = configuredValue(sourceTime);
  if (appSourceTime) query.set('sourcetime', appSourceTime);
  return `https://apps.powerapps.com/play/e/${encodeURIComponent(environment)}/app/${encodeURIComponent(app)}?${query.toString()}`;
}

export function getAgenticKanbanLink(): AgenticKanbanLink {
  const configuredUrl = firstSafeLaunchUrl(
    process.env.MORGAN_AGENTIC_KANBAN_URL,
    process.env.AGENTIC_KANBAN_URL,
    process.env.POWER_PLATFORM_KANBAN_URL,
    process.env.FLIGHTDECK_KANBAN_URL,
  );
  const appId = configuredValue(process.env.MORGAN_AGENTIC_KANBAN_APP_ID) || FLIGHTDECK_APP_ID;
  const environmentId = configuredValue(process.env.MORGAN_AGENTIC_KANBAN_ENVIRONMENT_ID) || FLIGHTDECK_ENVIRONMENT_ID;
  const tenantId = configuredValue(process.env.MORGAN_AGENTIC_KANBAN_TENANT_ID) || FLIGHTDECK_TENANT_ID;
  const hint = configuredValue(process.env.MORGAN_AGENTIC_KANBAN_HINT) || FLIGHTDECK_HINT;
  const sourceTime = configuredValue(process.env.MORGAN_AGENTIC_KANBAN_SOURCE_TIME) || FLIGHTDECK_SOURCE_TIME;
  const powerAppsUrl = safeLaunchUrl(buildPowerAppsAppOpenUri(appId, environmentId, tenantId, hint, sourceTime));
  const demoUrl = safeLaunchUrl(process.env.MORGAN_AGENTIC_KANBAN_DEMO_URL) || FLIGHTDECK_DEMO_URL;
  const url = configuredUrl || powerAppsUrl || INTERNAL_KANBAN_URL;
  const source: AgenticKanbanLink['source'] = configuredUrl
    ? 'configured-url'
    : powerAppsUrl
      ? 'power-app-ids'
      : 'internal-fallback';

  return {
    configured: Boolean(configuredUrl || powerAppsUrl),
    label: process.env.MORGAN_AGENTIC_KANBAN_LABEL || 'Live Finance Kanban',
    provider: process.env.MORGAN_AGENTIC_KANBAN_PROVIDER || 'Power Platform',
    source,
    url,
    fallbackUrl: INTERNAL_KANBAN_URL,
    demoUrl,
    openTarget: url.startsWith('/') ? '_self' : '_blank',
    powerPlatform: {
      appDisplayName: process.env.MORGAN_AGENTIC_KANBAN_APP_NAME || 'FlightDeck',
      appId,
      environmentId,
    },
    proof: {
      dataverseBacked: true,
      pollIntervalSeconds: 15,
      subAgents: ['Variance Analyst', 'Close Manager', 'Anomaly Monitor', 'Summary Agent'],
      tables: ['mc_task', 'mc_column', 'mc_board', 'mc_agentaction', 'mc_activitylog'],
    },
  };
}
