export type AuditSeverity = 'info' | 'warning' | 'error';

export interface MorganAuditEvent {
  id: string;
  timestamp: string;
  kind: string;
  label: string;
  severity: AuditSeverity;
  correlationId: string;
  actor?: string;
  data?: Record<string, unknown>;
}

interface AppInsightsClient {
  trackEvent: (event: { name: string; properties?: Record<string, string> }) => void;
  trackException?: (event: { exception: Error; properties?: Record<string, string> }) => void;
  flush?: () => void;
}

const MAX_EVENTS = 1000;
const auditEvents: MorganAuditEvent[] = [];
let appInsightsClient: AppInsightsClient | null = null;
let appInsightsConfigured = false;

function safeString(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.slice(0, 2048);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value).slice(0, 2048); } catch { return String(value).slice(0, 2048); }
}

function configuredValue(value: string | undefined): string | null {
  if (!value || /<[^>]+>/.test(value) || /your-|example|\.\.\.|optional-/i.test(value)) return null;
  return value;
}

function propertiesFor(event: MorganAuditEvent): Record<string, string> {
  const data = event.data || {};
  return {
    eventId: event.id,
    kind: event.kind,
    label: event.label,
    severity: event.severity,
    correlationId: event.correlationId,
    actor: event.actor || '',
    agentName: process.env.AGENT_NAME || 'Morgan',
    foundryProjectEndpoint: process.env.FOUNDRY_PROJECT_ENDPOINT || '',
    purviewAuditEnabled: process.env.PURVIEW_AUDIT_ENABLED || 'false',
    ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, safeString(value)])),
  };
}

export async function initObservability(): Promise<void> {
  const connectionString = configuredValue(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || undefined);
  if (!connectionString) {
    recordAuditEvent({
      kind: 'observability.startup',
      label: 'Application Insights not configured; audit events will be written to stdout and memory only',
      severity: 'warning',
      data: { purviewAuditEnabled: process.env.PURVIEW_AUDIT_ENABLED === 'true' },
    });
    return;
  }

  try {
    const appInsights = await import('applicationinsights');
    appInsights
      .setup(connectionString)
      .setAutoCollectConsole(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectRequests(true)
      .setAutoCollectDependencies(true)
      .setSendLiveMetrics(true)
      .start();
    appInsightsClient = appInsights.defaultClient as AppInsightsClient;
    appInsightsConfigured = true;
    recordAuditEvent({
      kind: 'observability.startup',
      label: 'Application Insights telemetry started',
      data: { purviewAuditEnabled: process.env.PURVIEW_AUDIT_ENABLED === 'true' },
    });
  } catch (err) {
    recordAuditEvent({
      kind: 'observability.startup.failed',
      label: 'Application Insights telemetry failed to start',
      severity: 'error',
      data: { error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export function recordAuditEvent(input: {
  kind: string;
  label: string;
  severity?: AuditSeverity;
  correlationId?: string;
  actor?: string;
  data?: Record<string, unknown>;
}): MorganAuditEvent {
  const event: MorganAuditEvent = {
    id: `${Date.now()}-${auditEvents.length + 1}`,
    timestamp: new Date().toISOString(),
    kind: input.kind,
    label: input.label,
    severity: input.severity || 'info',
    correlationId: input.correlationId || `morgan-${Date.now()}`,
    actor: input.actor,
    data: input.data,
  };

  auditEvents.push(event);
  if (auditEvents.length > MAX_EVENTS) auditEvents.splice(0, auditEvents.length - MAX_EVENTS);

  const properties = propertiesFor(event);
  console.log(JSON.stringify({ morganAuditEvent: event }));
  if (appInsightsClient) {
    appInsightsClient.trackEvent({ name: `Morgan.${event.kind}`, properties });
    if (event.severity === 'error') {
      appInsightsClient.trackException?.({ exception: new Error(event.label), properties });
    }
  }
  return event;
}

export function getRecentAuditEvents(limit = 100): MorganAuditEvent[] {
  return auditEvents.slice(-Math.max(1, Math.min(limit, MAX_EVENTS))).reverse();
}

export function getObservabilityStatus(): Record<string, unknown> {
  return {
    agent: process.env.AGENT_NAME || 'Morgan',
    applicationInsightsConfigured: appInsightsConfigured || Boolean(configuredValue(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || undefined)),
    applicationInsightsResourceId: configuredValue(process.env.APPLICATIONINSIGHTS_RESOURCE_ID || undefined),
    logAnalyticsWorkspaceId: configuredValue(process.env.LOG_ANALYTICS_WORKSPACE_ID || undefined),
    purviewAuditEnabled: process.env.PURVIEW_AUDIT_ENABLED === 'true',
    purviewAuditWorkspaceId: process.env.PURVIEW_AUDIT_WORKSPACE_ID || null,
    auditEventCount: auditEvents.length,
    agent365Sdk: {
      mcpPlatformEndpointConfigured: Boolean(process.env.MCP_PLATFORM_ENDPOINT),
      appIdentityConfigured: Boolean(process.env.MicrosoftAppId && process.env.MicrosoftAppTenantId),
      agenticAuthConnectionName: process.env.agentic_connectionName || 'AgenticAuthConnection',
    },
    purviewNotes: [
      'Microsoft 365 actions executed through Graph, Teams, Exchange, SharePoint, and Agent 365 MCP are auditable in Microsoft Purview under the executing user/app identity.',
      'Morgan custom events are emitted to stdout and Application Insights for export to Log Analytics; connect that workspace to Microsoft Sentinel/Purview workflows for central audit review.',
      'Use correlationId to join Morgan custom events with Agent 365, Entra, Teams, Exchange, and SharePoint audit records.',
    ],
  };
}

export function flushObservability(): void {
  appInsightsClient?.flush?.();
}
