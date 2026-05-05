import type { ChatCompletionTool } from 'openai/resources/chat';
import * as fs from 'fs';
import * as path from 'path';
import { TurnContext } from '@microsoft/agents-hosting';
import { McpToolServerConfigurationService, Utility as ToolingUtility } from '@microsoft/agents-a365-tooling';
import type { MCPServerConfig, McpClientTool, ToolOptions } from '@microsoft/agents-a365-tooling';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { recordAgentEvent } from '../observability/agentEvents';

const mcpService = new McpToolServerConfigurationService();
const MCP_PLATFORM_SCOPE = 'ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default';
const SERVER_CONFIG_TTL_MS = 5 * 60 * 1000;
const MCP_DISCOVERY_TIMEOUT_MS = Number(process.env.MCP_DISCOVERY_TIMEOUT_MS || 4_000);
const MCP_SERVER_TOOL_DISCOVERY_TIMEOUT_MS = Number(process.env.MCP_SERVER_TOOL_DISCOVERY_TIMEOUT_MS || 3_000);
const MCP_TOOL_TIMEOUT_MS = Number(process.env.MCP_TOOL_TIMEOUT_MS || 45_000);

let serverConfigCache: MCPServerConfig[] | null = null;
let serverConfigExpiry = 0;
let toolDefinitionCache: ChatCompletionTool[] | null = null;
const toolServerMap: Map<string, MCPServerConfig> = new Map();

function isMcpAvailable(): boolean {
  return Boolean(process.env.MCP_PLATFORM_ENDPOINT);
}

function getAuthHandlerName(): string {
  return process.env.agentic_connectionName || 'AgenticAuthConnection';
}

function getToolOptions(): ToolOptions | undefined {
  const orchestratorName = process.env.AGENTIC_ORCHESTRATOR_NAME || process.env.WEBSITE_SITE_NAME;
  return orchestratorName ? { orchestratorName } : undefined;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeServerConfig(config: MCPServerConfig, context?: TurnContext): MCPServerConfig {
  const tenantId =
    context?.activity?.conversation?.tenantId ||
    process.env.connections__service_connection__settings__tenantId ||
    process.env.MicrosoftAppTenantId;
  if (!tenantId) return config;

  const headers = { ...(config.headers || {}) };
  const tenantHeaderKeys = ['x-ms-tenant-id', 'x-tenant-id', 'tenant-id', 'tenantId'];
  let hasTenantHeader = false;
  for (const key of tenantHeaderKeys) {
    if (Object.prototype.hasOwnProperty.call(headers, key)) {
      hasTenantHeader = true;
      if (!headers[key]?.trim()) headers[key] = tenantId;
    }
  }
  if (!hasTenantHeader) headers['x-ms-tenant-id'] = tenantId;
  return { ...config, headers };
}

async function getOboToolHeaders(context: TurnContext): Promise<Record<string, string>> {
  try {
    const { agentApplication } = require('../agent') as {
      agentApplication: { authorization: import('@microsoft/agents-hosting').Authorization };
    };
    const runtime = await import('@microsoft/agents-a365-runtime') as {
      AgenticAuthenticationService: {
        GetAgenticUserToken: (
          authorization: import('@microsoft/agents-hosting').Authorization,
          authHandlerName: string,
          context: TurnContext,
          scopes: string[],
        ) => Promise<string | undefined>;
      };
    };
    const token = await runtime.AgenticAuthenticationService.GetAgenticUserToken(
      agentApplication.authorization,
      getAuthHandlerName(),
      context,
      [MCP_PLATFORM_SCOPE],
    );
    if (!token) return {};
    return ToolingUtility.GetToolRequestHeaders(token, context, getToolOptions());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP] Could not obtain OBO tool headers: ${message}`);
    return {};
  }
}

async function discoverViaClientCredentials(blueprintId: string): Promise<MCPServerConfig[]> {
  if (!process.env.MicrosoftAppTenantId || !process.env.MicrosoftAppId || !process.env.MicrosoftAppPassword) return [];
  const { ClientSecretCredential } = await import('@azure/identity');
  const credential = new ClientSecretCredential(
    process.env.MicrosoftAppTenantId,
    process.env.MicrosoftAppId,
    process.env.MicrosoftAppPassword,
  );
  const tokenResult = await credential.getToken(MCP_PLATFORM_SCOPE);
  return withTimeout(
    mcpService.listToolServers(blueprintId, tokenResult.token, getToolOptions()),
    MCP_DISCOVERY_TIMEOUT_MS,
    'MCP client-credentials server discovery',
  );
}

async function getServerConfigs(context?: TurnContext): Promise<MCPServerConfig[]> {
  const now = Date.now();
  if (!context && serverConfigCache && serverConfigCache.length > 0 && now < serverConfigExpiry) return serverConfigCache;

  const blueprintId = process.env.MicrosoftAppId || process.env.agent_id || '';

  if (context) {
    try {
      const { agentApplication } = require('../agent') as {
        agentApplication: { authorization: import('@microsoft/agents-hosting').Authorization };
      };
      const configs = await withTimeout(
        mcpService.listToolServers(
          context,
          agentApplication.authorization,
          getAuthHandlerName(),
          undefined,
          getToolOptions(),
        ),
        MCP_DISCOVERY_TIMEOUT_MS,
        'MCP OBO server discovery',
      );
      serverConfigCache = configs;
      serverConfigExpiry = now + SERVER_CONFIG_TTL_MS;
      recordAgentEvent({
        kind: 'mcp.discover',
        label: `Discovered ${configs.length} Agent 365 MCP server(s)`,
        status: configs.length > 0 ? 'ok' : 'partial',
        data: { servers: configs.map((config) => config.mcpServerName) },
      });
      return configs;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[MCP] OBO discovery failed: ${message}`);
      recordAgentEvent({ kind: 'mcp.discover', label: 'Agent 365 MCP discovery failed', status: 'error', data: { error: message } });
      serverConfigCache = null;
      serverConfigExpiry = 0;
      return [];
    }
  }

  try {
    const configs = await discoverViaClientCredentials(blueprintId);
    serverConfigCache = configs;
    serverConfigExpiry = now + SERVER_CONFIG_TTL_MS;
    recordAgentEvent({
      kind: 'mcp.discover',
      label: `Client credentials discovered ${configs.length} MCP server(s)`,
      status: configs.length > 0 ? 'ok' : 'partial',
      data: { servers: configs.map((config) => config.mcpServerName) },
    });
    return configs;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP] Client-credentials discovery failed: ${message}`);
    recordAgentEvent({ kind: 'mcp.discover', label: 'Client-credentials MCP discovery failed', status: 'error', data: { error: message } });
    serverConfigCache = [];
    serverConfigExpiry = now + SERVER_CONFIG_TTL_MS;
    return [];
  }
}

async function buildToolDefinitions(context?: TurnContext): Promise<ChatCompletionTool[]> {
  if (!context && toolDefinitionCache && toolDefinitionCache.length > 0) return toolDefinitionCache;

  const configs = await getServerConfigs(context);
  const tools: ChatCompletionTool[] = [];
  toolServerMap.clear();
  const oboHeaders = context ? await getOboToolHeaders(context) : {};

  for (const config of configs) {
    try {
      const mergedHeaders: Record<string, string> = { ...oboHeaders };
      for (const [key, value] of Object.entries(config.headers || {})) {
        if (value?.trim()) mergedHeaders[key] = value;
      }
      const normalizedConfig = normalizeServerConfig({ ...config, headers: mergedHeaders }, context);
      const mcpTools: McpClientTool[] = await withTimeout(
        mcpService.getMcpClientTools(normalizedConfig.mcpServerName, normalizedConfig),
        MCP_SERVER_TOOL_DISCOVERY_TIMEOUT_MS,
        `${normalizedConfig.mcpServerName} tool discovery`,
      );
      for (const mcpTool of mcpTools) {
        const tool: ChatCompletionTool = {
          type: 'function',
          function: {
            name: mcpTool.name,
            description: mcpTool.description || `${normalizedConfig.mcpServerName} tool: ${mcpTool.name}`,
            parameters: {
              type: mcpTool.inputSchema.type,
              properties: mcpTool.inputSchema.properties || {},
              required: mcpTool.inputSchema.required || [],
            },
          },
        };
        tools.push(tool);
        toolServerMap.set(mcpTool.name, normalizedConfig);
      }
      recordAgentEvent({
        kind: 'mcp.discover',
        label: `${normalizedConfig.mcpServerName}: ${mcpTools.length} tool(s) loaded`,
        status: 'ok',
        data: { server: normalizedConfig.mcpServerName, toolCount: mcpTools.length },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[MCP] Failed to load tools from ${config.mcpServerName}: ${message}`);
      recordAgentEvent({
        kind: 'mcp.discover',
        label: `${config.mcpServerName}: tool load failed`,
        status: 'error',
        data: { server: config.mcpServerName, error: message },
      });
    }
  }

  if (!context) toolDefinitionCache = tools;
  return tools;
}

export async function invokeMcpTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
  const serverConfig = toolServerMap.get(toolName);
  if (!serverConfig) throw new Error(`[MCP] No server found for tool "${toolName}"`);

  const client = new Client({ name: 'morgan-finance-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
    requestInit: { headers: serverConfig.headers || {} },
  });

  const started = Date.now();
  recordAgentEvent({
    kind: 'mcp.invoke',
    label: `${serverConfig.mcpServerName} -> ${toolName}`,
    status: 'started',
    data: { server: serverConfig.mcpServerName, tool: toolName, parameterKeys: Object.keys(params || {}) },
  });
  try {
    await client.connect(transport);
    const result = await withTimeout(client.callTool({ name: toolName, arguments: params }), MCP_TOOL_TIMEOUT_MS, `[MCP] Tool "${toolName}"`);
    recordAgentEvent({
      kind: 'mcp.invoke',
      label: `${serverConfig.mcpServerName} -> ${toolName}`,
      status: 'ok',
      durationMs: Date.now() - started,
      data: { server: serverConfig.mcpServerName, tool: toolName },
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordAgentEvent({
      kind: 'mcp.invoke',
      label: `${serverConfig.mcpServerName} -> ${toolName}`,
      status: 'error',
      durationMs: Date.now() - started,
      data: { server: serverConfig.mcpServerName, tool: toolName, error: message },
    });
    throw err;
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
}

export function hasMcpToolServer(toolName: string): boolean {
  return toolServerMap.has(toolName);
}

export function describeMcpTool(toolName: string): { source: 'mcp' | 'static'; serverName?: string } {
  const server = toolServerMap.get(toolName);
  return server ? { source: 'mcp', serverName: server.mcpServerName } : { source: 'static' };
}

async function invokeFirstAvailableMcpTool(toolNames: string[], params: Record<string, unknown>): Promise<{ toolName: string; result: unknown } | null> {
  for (const toolName of toolNames) {
    if (!toolServerMap.has(toolName)) continue;
    return { toolName, result: await invokeMcpTool(toolName, params) };
  }
  return null;
}

export async function getLiveMcpToolDefinitions(context?: TurnContext): Promise<ChatCompletionTool[]> {
  if (!isMcpAvailable()) return [];
  return buildToolDefinitions(context);
}

export function invalidateMcpCache(): void {
  serverConfigCache = null;
  toolDefinitionCache = null;
  toolServerMap.clear();
  console.log('[MCP] Cache invalidated');
}

export interface McpToolInfo {
  available: boolean;
  endpoint: string;
  serverCount: number;
  toolCount: number;
  servers: string[];
  tools: string[];
}

export async function getMcpTools(context?: TurnContext): Promise<McpToolInfo> {
  if (!isMcpAvailable()) return { available: false, endpoint: '', serverCount: 0, toolCount: 0, servers: [], tools: [] };
  const tools = await getLiveMcpToolDefinitions(context);
  const toolNames = tools.flatMap((tool) => tool.type === 'function' ? [tool.function.name] : []);
  const servers = Array.from(new Set(toolNames.map((name) => toolServerMap.get(name)?.mcpServerName).filter((name): name is string => Boolean(name))));
  return {
    available: true,
    endpoint: process.env.MCP_PLATFORM_ENDPOINT || '',
    serverCount: servers.length,
    toolCount: tools.length,
    servers,
    tools: toolNames,
  };
}

export interface TeamsMessageResult { success: boolean; messageId?: string; error?: string; source?: string; }
export interface EmailResult { success: boolean; messageId?: string; error?: string; source?: string; }
export interface WordDocumentResult { success: boolean; documentUrl?: string; localPath?: string; error?: string; source?: string; }
export interface PlannerTaskResult { success: boolean; taskId?: string; taskUrl?: string; error?: string; source?: string; }
export interface CalendarEventResult { success: boolean; eventId?: string; joinUrl?: string; error?: string; source?: string; }
export interface SharePointDataResult { success: boolean; data: unknown; source: 'mcp' | 'mock'; error?: string; }
export interface SharePointListResult { success: boolean; data: unknown; source: 'mcp' | 'mock'; error?: string; }
export interface PersonResult { displayName: string; email: string; jobTitle?: string; department?: string; }
export interface LookupPersonResult { success: boolean; query: string; results: PersonResult[]; error?: string; source?: string; }
export interface MeetingContextResult { success: boolean; source: 'mcp' | 'graph' | 'unavailable'; events?: unknown; messages?: unknown; transcripts?: unknown; error?: string; }

function configuredValue(value: string | undefined): string | undefined {
  if (!value || /<[^>]+>/.test(value) || /your-|example|\.\.\.|optional-/i.test(value)) return undefined;
  return value.trim() || undefined;
}

function firstConfiguredValue(...values: Array<string | undefined>): string | undefined {
  return values.map(configuredValue).find(Boolean);
}

function normalizePersonQuery(value: string | undefined): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9@._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function looksLikeEmail(value: string | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function demoEmailFallbackEnabled(): boolean {
  const explicit = process.env.MORGAN_DEMO_EMAIL_FALLBACK;
  if (explicit !== undefined) return ['1', 'true', 'yes', 'on'].includes(explicit.trim().toLowerCase());
  return process.env.NODE_ENV !== 'production' && !process.env.WEBSITE_INSTANCE_ID;
}

function graphSendMailUser(): string | undefined {
  const explicit = firstConfiguredValue(
    process.env.MORGAN_GRAPH_SENDMAIL_USER,
    process.env.MORGAN_MAILBOX_UPN,
    process.env.AGENT_MAILBOX_UPN,
    process.env.AGENTIC_USER_UPN,
  );
  if (explicit && looksLikeEmail(explicit)) return explicit;
  const fallback = firstConfiguredValue(process.env.CFO_EMAIL, process.env.CORPGEN_DIGEST_EMAIL_TO);
  return fallback && looksLikeEmail(fallback) ? fallback : undefined;
}

function graphMailCredentialConfig(): { tenantId: string; clientId: string; clientSecret: string } | null {
  const tenantId = firstConfiguredValue(process.env.MORGAN_GRAPH_TENANT_ID, process.env.MicrosoftAppTenantId);
  const clientId = firstConfiguredValue(process.env.MORGAN_GRAPH_CLIENT_ID, process.env.MicrosoftAppId);
  const clientSecret = firstConfiguredValue(process.env.MORGAN_GRAPH_CLIENT_SECRET, process.env.MicrosoftAppPassword);
  return tenantId && clientId && clientSecret ? { tenantId, clientId, clientSecret } : null;
}

async function sendEmailViaGraph(
  recipient: string,
  params: { subject: string; body: string; importance?: 'normal' | 'high'; bodyContentType?: 'text' | 'html' },
): Promise<EmailResult | null> {
  const sender = graphSendMailUser();
  const graphCredentials = graphMailCredentialConfig();
  if (!sender || !graphCredentials) return null;

  try {
    const { ClientSecretCredential } = await import('@azure/identity');
    const credential = new ClientSecretCredential(graphCredentials.tenantId, graphCredentials.clientId, graphCredentials.clientSecret);
    const tokenResult = await credential.getToken('https://graph.microsoft.com/.default');
    const contentType = params.bodyContentType === 'html' ? 'HTML' : 'Text';
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResult.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: params.subject,
          importance: params.importance || 'normal',
          body: { contentType, content: params.body },
          toRecipients: [{ emailAddress: { address: recipient } }],
        },
        saveToSentItems: true,
      }),
    });
    if (response.status === 202) {
      return { success: true, messageId: `graph-sendMail-${Date.now()}`, source: 'graph-sendMail' };
    }
    const errorText = await response.text().catch(() => '');
    return {
      success: false,
      error: `Graph sendMail failed with HTTP ${response.status}${errorText ? `: ${errorText.slice(0, 500)}` : ''}`,
      source: 'graph-sendMail',
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error), source: 'graph-sendMail' };
  }
}

function contactMatches(contact: PersonResult & { aliases?: string[] }, query: string): boolean {
  const normalizedQuery = normalizePersonQuery(query);
  if (!normalizedQuery) return false;
  const candidates = [contact.displayName, contact.email, contact.email.split('@')[0], ...(contact.aliases || [])]
    .map(normalizePersonQuery)
    .filter(Boolean);
  return candidates.some((candidate) => candidate === normalizedQuery || candidate.includes(normalizedQuery) || normalizedQuery.includes(candidate));
}

function contactsFromJson(value: string | undefined): Array<PersonResult & { aliases?: string[] }> {
  const raw = configuredValue(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const contact = item as { name?: string; displayName?: string; email?: string; mail?: string; jobTitle?: string; department?: string; aliases?: string[] };
      const email = configuredValue(contact.email || contact.mail);
      if (!email || !looksLikeEmail(email)) return [];
      return [{
        displayName: configuredValue(contact.displayName || contact.name) || email,
        email,
        jobTitle: configuredValue(contact.jobTitle),
        department: configuredValue(contact.department),
        aliases: Array.isArray(contact.aliases) ? contact.aliases.filter((alias): alias is string => typeof alias === 'string') : [],
      }];
    });
  } catch {
    return [];
  }
}

function configuredContacts(): Array<PersonResult & { aliases?: string[] }> {
  const contacts: Array<PersonResult & { aliases?: string[] }> = [];
  contacts.push(...contactsFromJson(process.env.MORGAN_CONTACTS_JSON));

  const cfoEmail = firstConfiguredValue(process.env.CFO_EMAIL, process.env.MANAGER_EMAIL);
  if (cfoEmail && looksLikeEmail(cfoEmail)) {
    const cfoAliases = ['cfo', 'operator', 'manager', 'graham'];
    const digestDisplayTarget = firstConfiguredValue(process.env.CORPGEN_DIGEST_EMAIL_TO);
    if (digestDisplayTarget && !looksLikeEmail(digestDisplayTarget)) cfoAliases.push(digestDisplayTarget, 'mod administrator', 'mod admin', 'administrator');
    contacts.push({
      displayName: firstConfiguredValue(process.env.CFO_DISPLAY_NAME, process.env.MANAGER_NAME) || 'CFO/operator',
      email: cfoEmail,
      jobTitle: 'Finance operator',
      aliases: cfoAliases,
    });
  }

  const modAdminEmail = firstConfiguredValue(process.env.MOD_ADMINISTRATOR_EMAIL, process.env.MOD_ADMIN_EMAIL, process.env.MOD_ADMINISTRATOR_UPN);
  if (modAdminEmail && looksLikeEmail(modAdminEmail)) {
    contacts.push({
      displayName: firstConfiguredValue(process.env.MOD_ADMINISTRATOR_NAME, process.env.CORPGEN_DIGEST_MANAGER_NAME) || 'Mod Administrator',
      email: modAdminEmail,
      jobTitle: 'Mod Administrator',
      aliases: ['mod administrator', 'mod admin', 'administrator'],
    });
  }

  const digestEmail = firstConfiguredValue(process.env.CORPGEN_DIGEST_EMAIL_TO);
  if (digestEmail && looksLikeEmail(digestEmail)) {
    contacts.push({
      displayName: firstConfiguredValue(process.env.CORPGEN_DIGEST_MANAGER_NAME, process.env.MOD_ADMINISTRATOR_NAME) || 'Mod Administrator',
      email: digestEmail,
      jobTitle: 'Digest recipient',
      aliases: ['mod administrator', 'mod admin', 'digest recipient'],
    });
  }

  const operatorEmail = firstConfiguredValue(process.env.GRAHAM_EMAIL, process.env.MORGAN_OPERATOR_EMAIL);
  if (operatorEmail && looksLikeEmail(operatorEmail)) {
    contacts.push({ displayName: 'Graham', email: operatorEmail, jobTitle: 'Operator', aliases: ['graham', 'operator'] });
  }

  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const key = contact.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function lookupConfiguredContact(query: string): LookupPersonResult | null {
  const exact = query.trim();
  if (looksLikeEmail(exact)) {
    return { success: true, query, results: [{ displayName: exact, email: exact }], source: 'exact-email' };
  }
  const results = configuredContacts().filter((contact) => contactMatches(contact, query));
  return results.length ? { success: true, query, results, source: 'configured-contact' } : null;
}

function normalizeMcpPeopleResult(result: unknown): PersonResult[] {
  const maybe = result as { users?: unknown[]; value?: unknown[]; results?: unknown[] };
  const rows = maybe?.users || maybe?.value || maybe?.results || [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const user = item as { displayName?: string; name?: string; mail?: string; email?: string; userPrincipalName?: string; jobTitle?: string; department?: string };
    const email = user.mail || user.email || user.userPrincipalName;
    if (!email) return [];
    return [{ displayName: user.displayName || user.name || email, email, jobTitle: user.jobTitle, department: user.department }];
  });
}

async function searchMcpPeople(query: string, context?: TurnContext): Promise<LookupPersonResult | null> {
  if (!isMcpAvailable()) return null;
  try {
    await buildToolDefinitions(context);
    const invoked = await invokeFirstAvailableMcpTool(['mcp_PeopleTools_searchUsers', 'mcp_DirectoryTools_searchUsers', 'mcp_GraphTools_searchUsers'], { query });
    if (!invoked) return null;
    return { success: true, query, results: normalizeMcpPeopleResult(invoked.result), source: invoked.toolName };
  } catch (error) {
    return { success: false, query, results: [], error: error instanceof Error ? error.message : String(error), source: 'mcp-people-search' };
  }
}

function odataString(value: string): string {
  return value.replace(/'/g, "''");
}

async function resolveEmailAddress(target: string, context?: TurnContext): Promise<{ email?: string; lookup?: LookupPersonResult }> {
  if (looksLikeEmail(target)) return { email: target.trim(), lookup: lookupConfiguredContact(target) || undefined };
  const lookup = await lookupPerson({ name: target }, context);
  const email = lookup.success ? lookup.results.find((person) => looksLikeEmail(person.email))?.email : undefined;
  return { email, lookup };
}

export async function sendTeamsMessage(params: { channel_id: string; message: string; subject?: string }, context?: TurnContext): Promise<TeamsMessageResult> {
  if (isMcpAvailable()) {
    try {
      await buildToolDefinitions(context);
      const invoked = await invokeFirstAvailableMcpTool(['mcp_TeamsServer_sendChannelMessage'], { channelId: params.channel_id, content: params.message, subject: params.subject });
      if (invoked) return { success: true, messageId: (invoked.result as { messageId?: string })?.messageId, source: invoked.toolName };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), source: 'mcp_TeamsServer_sendChannelMessage' };
    }
  }
  console.log(`[DEMO] sendTeamsMessage -> channel:${params.channel_id} subject:${params.subject || '(none)'}`);
  return { success: true, messageId: `demo-${Date.now()}`, source: 'demo' };
}

export async function sendEmail(params: { to: string; subject: string; body: string; importance?: 'normal' | 'high'; bodyContentType?: 'text' | 'html' }, context?: TurnContext): Promise<EmailResult> {
  const resolved = await resolveEmailAddress(params.to, context);
  if (!resolved.email) {
    return {
      success: false,
      error: resolved.lookup?.error || `Could not resolve recipient "${params.to}" to an email address. Use an exact email address or configure MORGAN_CONTACTS_JSON / MOD_ADMINISTRATOR_EMAIL / GRAHAM_EMAIL.`,
      source: resolved.lookup?.source || 'recipient-resolution',
    };
  }
  const recipient = resolved.email;
  if (isMcpAvailable()) {
    try {
      await buildToolDefinitions(context);
      const invoked = await invokeFirstAvailableMcpTool(['mcp_MailTools_sendMail'], { to: recipient, subject: params.subject, body: params.body, bodyContentType: params.bodyContentType || 'text', importance: params.importance || 'normal' });
      if (invoked) return { success: true, messageId: (invoked.result as { messageId?: string })?.messageId, source: invoked.toolName };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), source: 'mcp_MailTools_sendMail' };
    }
  }
  const graphResult = await sendEmailViaGraph(recipient, params);
  if (graphResult) return graphResult;
  if (!demoEmailFallbackEnabled()) {
    const source = isMcpAvailable() ? 'workiq-mail-unavailable' : 'workiq-mail-not-configured';
    return {
      success: false,
      error: isMcpAvailable()
        ? 'WorkIQ Mail MCP is configured, but mcp_MailTools_sendMail was not available in this turn and Graph sendMail is not configured. No real email was sent.'
        : 'WorkIQ Mail MCP is not configured and Graph sendMail is not configured for this runtime. No real email was sent.',
      source,
    };
  }
  console.log(`[DEMO] sendEmail -> to:${recipient} subject:${params.subject}`);
  return { success: true, messageId: `demo-email-${Date.now()}`, source: 'demo' };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownToWordHtml(title: string, content: string): string {
  const body = content.split(/\r?\n/).map((line) => {
    if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
    if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
    if (line.startsWith('### ')) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
    if (line.startsWith('- ')) return `<p class="bullet">${escapeHtml(line.slice(2))}</p>`;
    if (!line.trim()) return '<p>&nbsp;</p>';
    return `<p>${escapeHtml(line)}</p>`;
  }).join('\n');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Aptos, Calibri, Arial, sans-serif; color: #1f2937; line-height: 1.45; }
    h1 { color: #0f766e; font-size: 22pt; }
    h2 { color: #111827; border-bottom: 1px solid #d1d5db; padding-bottom: 4px; margin-top: 22px; }
    h3 { color: #374151; }
    p { margin: 7px 0; }
    .bullet { margin-left: 18px; }
    .bullet::before { content: "• "; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

export async function createWordDocument(params: { title: string; content: string; save_to_sharepoint?: boolean }, context?: TurnContext): Promise<WordDocumentResult> {
  if (isMcpAvailable()) {
    try {
      await buildToolDefinitions(context);
      const invoked = await invokeFirstAvailableMcpTool(['mcp_WordServer_createDocument'], { title: params.title, content: params.content, saveToSharePoint: params.save_to_sharepoint || false });
      if (invoked) return { success: true, documentUrl: (invoked.result as { documentUrl?: string })?.documentUrl, source: invoked.toolName };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), source: 'mcp_WordServer_createDocument' };
    }
  }
  const tmpDir = process.env.TEMP || process.env.TMP || '/tmp';
  const safeName = params.title.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
  const filePath = path.join(tmpDir, `${safeName}_${Date.now()}.doc`);
  try {
    fs.writeFileSync(filePath, markdownToWordHtml(params.title, params.content), 'utf8');
    return { success: true, localPath: filePath, source: 'local-word-html-fallback' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), source: 'local-fallback' };
  }
}

const MOCK_SHAREPOINT_DATA: Record<string, unknown> = {
  budget: { source: 'mock', fiscalYear: new Date().getFullYear(), company: 'Contoso Financial', categories: { Revenue: 5_200_000, COGS: 1_820_000, OPEX: 750_000, 'R&D': 420_000, Sales: 310_000, Marketing: 220_000 } },
  actuals: { source: 'mock', asOf: new Date().toISOString().slice(0, 10), company: 'Contoso Financial', categories: { Revenue: 4_980_000, COGS: 1_960_000, OPEX: 832_000, 'R&D': 398_000, Sales: 345_000, Marketing: 258_000 } },
  forecast: { source: 'mock', forecastDate: new Date().toISOString().slice(0, 10), company: 'Contoso Financial', nextQuarter: { Revenue: 5_400_000, COGS: 1_890_000, OPEX: 770_000, 'R&D': 435_000, Sales: 320_000, Marketing: 240_000 } },
};

export async function readSharePointData(params: { site: string; file_path: string; data_type: 'budget' | 'actuals' | 'forecast' }, context?: TurnContext): Promise<SharePointDataResult> {
  if (isMcpAvailable()) {
    try {
      await buildToolDefinitions(context);
      const invoked = await invokeFirstAvailableMcpTool(['mcp_SharePointRemoteServer_readFile', 'mcp_SharePointServer_readFile', 'mcp_OneDriveServer_readFile'], { site: params.site, filePath: params.file_path, dataType: params.data_type });
      if (invoked) return { success: true, data: invoked.result, source: 'mcp' };
    } catch (err) {
      return { success: false, data: null, source: 'mcp', error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { success: true, data: MOCK_SHAREPOINT_DATA[params.data_type] || {}, source: 'mock' };
}

export async function lookupPerson(params: { name: string }, context?: TurnContext): Promise<LookupPersonResult> {
  const started = Date.now();
  const query = params.name.trim();
  const configured = lookupConfiguredContact(query);
  if (configured) {
    recordAgentEvent({ kind: 'graph.call', label: `Configured contact lookup: ${query}`, status: 'ok', data: { source: configured.source, resultCount: configured.results.length } });
    return configured;
  }

  const mcpLookup = await searchMcpPeople(query, context);
  if (mcpLookup?.success && mcpLookup.results.length) return mcpLookup;

  try {
    if (!process.env.MicrosoftAppTenantId || !process.env.MicrosoftAppId || !process.env.MicrosoftAppPassword) {
      const error = 'Graph client credentials are not configured; use an exact email address or configure contact aliases.';
      return { success: false, query, results: [], error, source: 'graph' };
    }
    const { ClientSecretCredential } = await import('@azure/identity');
    const credential = new ClientSecretCredential(process.env.MicrosoftAppTenantId!, process.env.MicrosoftAppId!, process.env.MicrosoftAppPassword!);
    const tokenResult = await credential.getToken('https://graph.microsoft.com/.default');
    const searchQuery = encodeURIComponent(`"displayName:${query}"`);
    const url = `https://graph.microsoft.com/v1.0/users?$search=${searchQuery}&$select=displayName,mail,userPrincipalName,jobTitle,department&$top=5`;
    recordAgentEvent({ kind: 'graph.call', label: `Graph people search: ${query}`, status: 'started', data: { endpoint: '/v1.0/users', query } });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${tokenResult.token}`, ConsistencyLevel: 'eventual' } });
    if (!response.ok) {
      if (response.status === 403) {
        const error = 'Graph directory lookup returned 403. The app registration needs User.Read.All or Directory.Read.All application permission with admin consent, or use Agent 365 MCP People tools / configured contact aliases.';
        recordAgentEvent({ kind: 'graph.call', label: 'Graph people search permission denied', status: 'error', durationMs: Date.now() - started, data: { endpoint: '/v1.0/users', query, status: 403 } });
        return { success: false, query, results: [], error, source: 'graph' };
      }
      return { success: false, query, results: [], error: `Graph API error: ${response.status}`, source: 'graph' };
    }
    const data = await response.json() as { value: Array<{ displayName: string; mail?: string; userPrincipalName?: string; jobTitle?: string; department?: string }> };
    const results = data.value.map((user) => ({ displayName: user.displayName, email: user.mail || user.userPrincipalName || '', jobTitle: user.jobTitle || undefined, department: user.department || undefined }));
    recordAgentEvent({ kind: 'graph.call', label: `Graph people search: ${results.length} result(s)`, status: 'ok', durationMs: Date.now() - started, data: { endpoint: '/v1.0/users', resultCount: results.length } });
    if (results.length) return { success: true, query, results, source: 'graph' };

    const filter = encodeURIComponent(`startswith(displayName,'${odataString(query)}') or startswith(mail,'${odataString(query)}') or startswith(userPrincipalName,'${odataString(query)}')`);
    const filterUrl = `https://graph.microsoft.com/v1.0/users?$filter=${filter}&$select=displayName,mail,userPrincipalName,jobTitle,department&$top=5`;
    const filterResponse = await fetch(filterUrl, { headers: { Authorization: `Bearer ${tokenResult.token}` } });
    if (!filterResponse.ok) return { success: false, query, results: [], error: `Graph API error: ${filterResponse.status}`, source: 'graph' };
    const filterData = await filterResponse.json() as { value: Array<{ displayName: string; mail?: string; userPrincipalName?: string; jobTitle?: string; department?: string }> };
    const filterResults = filterData.value.map((user) => ({ displayName: user.displayName, email: user.mail || user.userPrincipalName || '', jobTitle: user.jobTitle || undefined, department: user.department || undefined }));
    return { success: filterResults.length > 0, query, results: filterResults, source: 'graph-filter', error: filterResults.length ? undefined : 'No matching person found.' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    recordAgentEvent({ kind: 'graph.call', label: 'Graph people search failed', status: 'error', durationMs: Date.now() - started, data: { error } });
    return { success: false, query, results: [], error, source: 'graph' };
  }
}

export async function findUser(params: { query: string }, context?: TurnContext): Promise<LookupPersonResult> {
  return lookupPerson({ name: params.query }, context);
}

export async function createPlannerTask(params: { title: string; assigned_to?: string; due_date?: string; bucket_name?: string; notes?: string; priority?: number }, context?: TurnContext): Promise<PlannerTaskResult> {
  try {
    await buildToolDefinitions(context);
    const invoked = await invokeFirstAvailableMcpTool(['mcp_PlannerServer_createTask'], { title: params.title, assignedTo: params.assigned_to, dueDate: params.due_date, bucketName: params.bucket_name, notes: params.notes, priority: params.priority || 5 });
    if (invoked) return { success: true, taskId: (invoked.result as { taskId?: string })?.taskId, taskUrl: (invoked.result as { taskUrl?: string })?.taskUrl, source: invoked.toolName };
    return { success: false, error: 'Planner MCP tool is not available in this turn.', source: 'mcp_PlannerServer_createTask' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), source: 'mcp_PlannerServer_createTask' };
  }
}

export async function updatePlannerTask(params: { task_id: string; title?: string; percent_complete?: number; due_date?: string; notes?: string }, context?: TurnContext): Promise<PlannerTaskResult> {
  try {
    await buildToolDefinitions(context);
    const invoked = await invokeFirstAvailableMcpTool(['mcp_PlannerServer_updateTask'], { taskId: params.task_id, title: params.title, percentComplete: params.percent_complete, dueDate: params.due_date, notes: params.notes });
    if (invoked) return { success: true, taskId: (invoked.result as { taskId?: string })?.taskId, source: invoked.toolName };
    return { success: false, error: 'Planner update MCP tool is not available in this turn.', source: 'mcp_PlannerServer_updateTask' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), source: 'mcp_PlannerServer_updateTask' };
  }
}

export async function scheduleCalendarEvent(params: { title: string; attendees: string[]; start_datetime: string; end_datetime: string; body?: string; is_online_meeting?: boolean }, context?: TurnContext): Promise<CalendarEventResult> {
  try {
    await buildToolDefinitions(context);
    const invoked = await invokeFirstAvailableMcpTool(['mcp_CalendarTools_createEvent'], { title: params.title, attendees: params.attendees, startDateTime: params.start_datetime, endDateTime: params.end_datetime, body: params.body, isOnlineMeeting: params.is_online_meeting !== false });
    if (invoked) return { success: true, eventId: (invoked.result as { eventId?: string })?.eventId, joinUrl: (invoked.result as { joinUrl?: string })?.joinUrl, source: invoked.toolName };
    return { success: false, error: 'Calendar MCP tool is not available in this turn.', source: 'mcp_CalendarTools_createEvent' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err), source: 'mcp_CalendarTools_createEvent' };
  }
}

export async function readSharePointList(params: { site_url: string; list_name: string; filter?: string }, context?: TurnContext): Promise<SharePointListResult> {
  try {
    await buildToolDefinitions(context);
    const invoked = await invokeFirstAvailableMcpTool(['mcp_SharePointListsTools_getListItems', 'mcp_SharePointServer_getListItems'], { siteUrl: params.site_url, listName: params.list_name, filter: params.filter });
    if (invoked) return { success: true, data: invoked.result, source: 'mcp' };
    return { success: false, data: null, source: 'mock', error: 'SharePoint list MCP tool is not available in this turn.' };
  } catch (err) {
    return { success: false, data: null, source: 'mcp', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function listUpcomingMeetings(params: { days?: number; query?: string }, context?: TurnContext): Promise<MeetingContextResult> {
  try {
    await buildToolDefinitions(context);
    const invoked = await invokeFirstAvailableMcpTool(['mcp_CalendarTools_listEvents', 'mcp_CalendarTools_getEvents', 'mcp_CalendarTools_listCalendarEvents'], { days: params.days || 7, query: params.query });
    if (invoked) return { success: true, source: 'mcp', events: invoked.result };
    return { success: false, source: 'unavailable', error: 'Calendar MCP list-events tool is not available in this turn.' };
  } catch (err) {
    return { success: false, source: 'mcp', error: err instanceof Error ? err.message : String(err) };
  }
}

export async function collectMeetingContext(params: { meeting_id?: string; meeting_url?: string; chat_id?: string; topic?: string }, context?: TurnContext): Promise<MeetingContextResult> {
  try {
    await buildToolDefinitions(context);
    const eventInvoke = await invokeFirstAvailableMcpTool(['mcp_CalendarTools_getEvent', 'mcp_CalendarTools_getMeeting'], { meetingId: params.meeting_id, meetingUrl: params.meeting_url, topic: params.topic });
    const chatInvoke = params.chat_id
      ? await invokeFirstAvailableMcpTool(['mcp_TeamsServer_getChatMessages', 'mcp_TeamsServer_getMeetingChatMessages'], { chatId: params.chat_id })
      : null;
    const transcriptInvoke = await invokeFirstAvailableMcpTool(['mcp_TeamsServer_getMeetingTranscript', 'mcp_CalendarTools_getMeetingTranscript'], { meetingId: params.meeting_id, meetingUrl: params.meeting_url });
    if (eventInvoke || chatInvoke || transcriptInvoke) {
      return { success: true, source: 'mcp', events: eventInvoke?.result, messages: chatInvoke?.result, transcripts: transcriptInvoke?.result };
    }
    return { success: false, source: 'unavailable', error: 'Meeting context MCP tools are not available in this turn.' };
  } catch (err) {
    return { success: false, source: 'mcp', error: err instanceof Error ? err.message : String(err) };
  }
}

export const MCP_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  { type: 'function', function: { name: 'getMcpTools', description: 'Check Agent 365 MCP status and list available live Microsoft 365 tools from Graph-backed MCP servers.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'findUser', description: 'Resolve a person with the WorkIQ People/Directory MCP tools first, then configured contact aliases, then Microsoft Graph fallback. Use before sending email or scheduling meetings.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Name, partial name, or email to search for.' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'sendTeamsMessage', description: 'Send a message to a Microsoft Teams channel via Agent 365 MCP Teams tools.', parameters: { type: 'object', properties: { channel_id: { type: 'string', description: 'Teams channel ID.' }, message: { type: 'string', description: 'Message body.' }, subject: { type: 'string', description: 'Optional subject/title.' } }, required: ['channel_id', 'message'] } } },
  { type: 'function', function: { name: 'sendEmail', description: 'Send an email through Morgan WorkIQ Mail first, then Microsoft Graph sendMail if configured. Resolve names with Agent 365 MCP/Graph/contact aliases before sending.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email or resolvable display name.' }, subject: { type: 'string', description: 'Email subject.' }, body: { type: 'string', description: 'Email body.' }, bodyContentType: { type: 'string', enum: ['text', 'html'], description: 'Email body format. Use html for enterprise-formatted reports.' }, importance: { type: 'string', enum: ['normal', 'high'], description: 'Importance flag.' } }, required: ['to', 'subject', 'body'] } } },
  { type: 'function', function: { name: 'createWordDocument', description: 'Create a Word document through Agent 365 MCP Word tools. Optionally saves to SharePoint.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Document title.' }, content: { type: 'string', description: 'Document content in Markdown.' }, save_to_sharepoint: { type: 'boolean', description: 'Save to SharePoint after creation.' } }, required: ['title', 'content'] } } },
  { type: 'function', function: { name: 'createPlannerTask', description: 'Create a new Microsoft Planner task via Agent 365 MCP Planner tools.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Task title.' }, assigned_to: { type: 'string', description: 'User email or display name.' }, due_date: { type: 'string', description: 'Due date in ISO format.' }, bucket_name: { type: 'string', description: 'Planner bucket name.' }, notes: { type: 'string', description: 'Task notes.' }, priority: { type: 'number', description: 'Priority 0-10.' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'updatePlannerTask', description: 'Update a Microsoft Planner task through Agent 365 MCP Planner tools.', parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Planner task ID.' }, title: { type: 'string' }, percent_complete: { type: 'number' }, due_date: { type: 'string' }, notes: { type: 'string' } }, required: ['task_id'] } } },
  { type: 'function', function: { name: 'scheduleCalendarEvent', description: 'Create a calendar event or Teams online meeting via Agent 365 MCP Calendar tools.', parameters: { type: 'object', properties: { title: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } }, start_datetime: { type: 'string' }, end_datetime: { type: 'string' }, body: { type: 'string' }, is_online_meeting: { type: 'boolean' } }, required: ['title', 'attendees', 'start_datetime', 'end_datetime'] } } },
  { type: 'function', function: { name: 'listUpcomingMeetings', description: 'List upcoming meetings from Microsoft 365 Calendar through Agent 365 MCP Calendar tools.', parameters: { type: 'object', properties: { days: { type: 'number', description: 'Number of days ahead.' }, query: { type: 'string', description: 'Optional title/topic search.' } }, required: [] } } },
  { type: 'function', function: { name: 'collectMeetingContext', description: 'Collect available meeting context such as calendar details, Teams chat, and transcript through Agent 365 MCP/Graph tools.', parameters: { type: 'object', properties: { meeting_id: { type: 'string' }, meeting_url: { type: 'string' }, chat_id: { type: 'string' }, topic: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'readSharePointData', description: 'Read financial data from SharePoint or OneDrive through Agent 365 MCP.', parameters: { type: 'object', properties: { site: { type: 'string' }, file_path: { type: 'string' }, data_type: { type: 'string', enum: ['budget', 'actuals', 'forecast'] } }, required: ['site', 'file_path', 'data_type'] } } },
  { type: 'function', function: { name: 'readSharePointList', description: 'Read items from a SharePoint list through Agent 365 MCP SharePoint list tools.', parameters: { type: 'object', properties: { site_url: { type: 'string' }, list_name: { type: 'string' }, filter: { type: 'string' } }, required: ['site_url', 'list_name'] } } },
  { type: 'function', function: { name: 'lookupPerson', description: 'Resolve a person by exact email, configured aliases, WorkIQ MCP People/Directory, then Microsoft Graph fallback. Returns display name, email, job title, and department.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
];