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
  return mcpService.listToolServers(blueprintId, tokenResult.token, getToolOptions());
}

async function getServerConfigs(context?: TurnContext): Promise<MCPServerConfig[]> {
  const now = Date.now();
  if (serverConfigCache && serverConfigCache.length > 0 && now < serverConfigExpiry) return serverConfigCache;

  const blueprintId = process.env.MicrosoftAppId || process.env.agent_id || '';

  if (context) {
    try {
      const { agentApplication } = require('../agent') as {
        agentApplication: { authorization: import('@microsoft/agents-hosting').Authorization };
      };
      const configs = await mcpService.listToolServers(
        context,
        agentApplication.authorization,
        getAuthHandlerName(),
        undefined,
        getToolOptions(),
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
  if (toolDefinitionCache && toolDefinitionCache.length > 0) return toolDefinitionCache;

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
      const mcpTools: McpClientTool[] = await mcpService.getMcpClientTools(normalizedConfig.mcpServerName, normalizedConfig);
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

  toolDefinitionCache = tools;
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
    const result = await Promise.race([
      client.callTool({ name: toolName, arguments: params }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`[MCP] Tool "${toolName}" timeout after ${MCP_TOOL_TIMEOUT_MS / 1000}s`)), MCP_TOOL_TIMEOUT_MS)),
    ]);
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

export async function sendEmail(params: { to: string; subject: string; body: string; importance?: 'normal' | 'high' }, context?: TurnContext): Promise<EmailResult> {
  if (isMcpAvailable()) {
    try {
      await buildToolDefinitions(context);
      const invoked = await invokeFirstAvailableMcpTool(['mcp_MailTools_sendMail'], { to: params.to, subject: params.subject, body: params.body, importance: params.importance || 'normal' });
      if (invoked) return { success: true, messageId: (invoked.result as { messageId?: string })?.messageId, source: invoked.toolName };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), source: 'mcp_MailTools_sendMail' };
    }
  }
  console.log(`[DEMO] sendEmail -> to:${params.to} subject:${params.subject}`);
  return { success: true, messageId: `demo-email-${Date.now()}`, source: 'demo' };
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
  const filePath = path.join(tmpDir, `${safeName}_${Date.now()}.md`);
  try {
    fs.writeFileSync(filePath, `# ${params.title}\n\n${params.content}`, 'utf8');
    return { success: true, localPath: filePath, source: 'local-fallback' };
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

export async function lookupPerson(params: { name: string }): Promise<LookupPersonResult> {
  const started = Date.now();
  try {
    const { ClientSecretCredential } = await import('@azure/identity');
    const credential = new ClientSecretCredential(process.env.MicrosoftAppTenantId!, process.env.MicrosoftAppId!, process.env.MicrosoftAppPassword!);
    const tokenResult = await credential.getToken('https://graph.microsoft.com/.default');
    const searchQuery = encodeURIComponent(`"displayName:${params.name}"`);
    const url = `https://graph.microsoft.com/v1.0/users?$search=${searchQuery}&$select=displayName,mail,userPrincipalName,jobTitle,department&$top=5`;
    recordAgentEvent({ kind: 'graph.call', label: `Graph people search: ${params.name}`, status: 'started', data: { endpoint: '/v1.0/users', query: params.name } });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${tokenResult.token}`, ConsistencyLevel: 'eventual' } });
    if (!response.ok) return { success: false, query: params.name, results: [], error: `Graph API error: ${response.status}`, source: 'graph' };
    const data = await response.json() as { value: Array<{ displayName: string; mail?: string; userPrincipalName?: string; jobTitle?: string; department?: string }> };
    const results = data.value.map((user) => ({ displayName: user.displayName, email: user.mail || user.userPrincipalName || '', jobTitle: user.jobTitle || undefined, department: user.department || undefined }));
    recordAgentEvent({ kind: 'graph.call', label: `Graph people search: ${results.length} result(s)`, status: 'ok', durationMs: Date.now() - started, data: { endpoint: '/v1.0/users', resultCount: results.length } });
    return { success: true, query: params.name, results, source: 'graph' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    recordAgentEvent({ kind: 'graph.call', label: 'Graph people search failed', status: 'error', durationMs: Date.now() - started, data: { error } });
    return { success: false, query: params.name, results: [], error, source: 'graph' };
  }
}

export async function findUser(params: { query: string }, context?: TurnContext): Promise<LookupPersonResult> {
  if (isMcpAvailable()) {
    try {
      await buildToolDefinitions(context);
      const invoked = await invokeFirstAvailableMcpTool(['mcp_PeopleTools_searchUsers', 'mcp_DirectoryTools_searchUsers', 'mcp_GraphTools_searchUsers'], { query: params.query });
      if (invoked) {
        const users = (invoked.result as { users?: PersonResult[]; value?: PersonResult[] })?.users || (invoked.result as { value?: PersonResult[] })?.value || [];
        return { success: true, query: params.query, results: users, source: invoked.toolName };
      }
    } catch {
      // Fall back to direct Graph lookup below.
    }
  }
  return lookupPerson({ name: params.query });
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
  { type: 'function', function: { name: 'findUser', description: 'Search Microsoft Graph / Agent 365 directory for a user by name, email, or display name. Use before sending email or scheduling meetings.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Name, partial name, or email to search for.' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'sendTeamsMessage', description: 'Send a message to a Microsoft Teams channel via Agent 365 MCP Teams tools.', parameters: { type: 'object', properties: { channel_id: { type: 'string', description: 'Teams channel ID.' }, message: { type: 'string', description: 'Message body.' }, subject: { type: 'string', description: 'Optional subject/title.' } }, required: ['channel_id', 'message'] } } },
  { type: 'function', function: { name: 'sendEmail', description: 'Send an email via Microsoft 365 Mail using Agent 365 MCP Mail tools.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email.' }, subject: { type: 'string', description: 'Email subject.' }, body: { type: 'string', description: 'Email body.' }, importance: { type: 'string', enum: ['normal', 'high'], description: 'Importance flag.' } }, required: ['to', 'subject', 'body'] } } },
  { type: 'function', function: { name: 'createWordDocument', description: 'Create a Word document through Agent 365 MCP Word tools. Optionally saves to SharePoint.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Document title.' }, content: { type: 'string', description: 'Document content in Markdown.' }, save_to_sharepoint: { type: 'boolean', description: 'Save to SharePoint after creation.' } }, required: ['title', 'content'] } } },
  { type: 'function', function: { name: 'createPlannerTask', description: 'Create a new Microsoft Planner task via Agent 365 MCP Planner tools.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Task title.' }, assigned_to: { type: 'string', description: 'User email or display name.' }, due_date: { type: 'string', description: 'Due date in ISO format.' }, bucket_name: { type: 'string', description: 'Planner bucket name.' }, notes: { type: 'string', description: 'Task notes.' }, priority: { type: 'number', description: 'Priority 0-10.' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'updatePlannerTask', description: 'Update a Microsoft Planner task through Agent 365 MCP Planner tools.', parameters: { type: 'object', properties: { task_id: { type: 'string', description: 'Planner task ID.' }, title: { type: 'string' }, percent_complete: { type: 'number' }, due_date: { type: 'string' }, notes: { type: 'string' } }, required: ['task_id'] } } },
  { type: 'function', function: { name: 'scheduleCalendarEvent', description: 'Create a calendar event or Teams online meeting via Agent 365 MCP Calendar tools.', parameters: { type: 'object', properties: { title: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } }, start_datetime: { type: 'string' }, end_datetime: { type: 'string' }, body: { type: 'string' }, is_online_meeting: { type: 'boolean' } }, required: ['title', 'attendees', 'start_datetime', 'end_datetime'] } } },
  { type: 'function', function: { name: 'listUpcomingMeetings', description: 'List upcoming meetings from Microsoft 365 Calendar through Agent 365 MCP Calendar tools.', parameters: { type: 'object', properties: { days: { type: 'number', description: 'Number of days ahead.' }, query: { type: 'string', description: 'Optional title/topic search.' } }, required: [] } } },
  { type: 'function', function: { name: 'collectMeetingContext', description: 'Collect available meeting context such as calendar details, Teams chat, and transcript through Agent 365 MCP/Graph tools.', parameters: { type: 'object', properties: { meeting_id: { type: 'string' }, meeting_url: { type: 'string' }, chat_id: { type: 'string' }, topic: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'readSharePointData', description: 'Read financial data from SharePoint or OneDrive through Agent 365 MCP.', parameters: { type: 'object', properties: { site: { type: 'string' }, file_path: { type: 'string' }, data_type: { type: 'string', enum: ['budget', 'actuals', 'forecast'] } }, required: ['site', 'file_path', 'data_type'] } } },
  { type: 'function', function: { name: 'readSharePointList', description: 'Read items from a SharePoint list through Agent 365 MCP SharePoint list tools.', parameters: { type: 'object', properties: { site_url: { type: 'string' }, list_name: { type: 'string' }, filter: { type: 'string' } }, required: ['site_url', 'list_name'] } } },
  { type: 'function', function: { name: 'lookupPerson', description: 'Search for a person in Microsoft Graph by name. Returns display name, email, job title, and department.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } } },
];