import type { ChatCompletionTool } from 'openai/resources/chat';
import * as fs from 'fs';
import * as path from 'path';
import { TurnContext } from '@microsoft/agents-hosting';
import { McpToolServerConfigurationService } from '@microsoft/agents-a365-tooling';
import type { MCPServerConfig, McpClientTool } from '@microsoft/agents-a365-tooling';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// ---------------------------------------------------------------------------
// MCP Service (singleton per process)
// ---------------------------------------------------------------------------

const mcpService = new McpToolServerConfigurationService();

// Runtime server config cache — populated on first use per turn
let _serverConfigCache: MCPServerConfig[] | null = null;
let _serverConfigExpiry = 0;
const SERVER_CONFIG_TTL_MS = 5 * 60 * 1000; // 5 min

// Tool definition cache built from server configs
let _toolDefinitionCache: ChatCompletionTool[] | null = null;
// Maps prefixed tool name → MCPServerConfig
const _toolServerMap: Map<string, MCPServerConfig> = new Map();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isMcpAvailable(): boolean {
  return Boolean(process.env.MCP_PLATFORM_ENDPOINT);
}

async function getServerConfigs(context?: TurnContext): Promise<MCPServerConfig[]> {
  const now = Date.now();
  if (_serverConfigCache && now < _serverConfigExpiry) return _serverConfigCache;

  const blueprintId = process.env.MicrosoftAppId ?? process.env.agent_id ?? '';

  try {
    if (context) {
      // Preferred: TurnContext overload — performs OBO token exchange automatically
      // Import agentApplication lazily to avoid circular dep
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { agentApplication } = require('../agent') as { agentApplication: { authorization: import('@microsoft/agents-hosting').Authorization } };
      const configs = await mcpService.listToolServers(
        context,
        agentApplication.authorization,
        'AgenticAuthConnection',
      );
      _serverConfigCache = configs;
    } else {
      // Fallback: use blueprint app client credentials to get a plain token
      const { ClientSecretCredential } = await import('@azure/identity');
      const credential = new ClientSecretCredential(
        process.env.MicrosoftAppTenantId!,
        process.env.MicrosoftAppId!,
        process.env.MicrosoftAppPassword!,
      );
      const tokenResult = await credential.getToken('ea9ffc3e-8a23-4a7d-836d-234d7c7565c1/.default');
      const configs = await mcpService.listToolServers(blueprintId, tokenResult.token);
      _serverConfigCache = configs;
    }
    _serverConfigExpiry = now + SERVER_CONFIG_TTL_MS;
    console.log(`[MCP] Discovered ${_serverConfigCache.length} server(s) from tooling gateway`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[MCP] Failed to discover servers: ${msg}. Tool definitions will be empty.`);
    _serverConfigCache = [];
  }

  return _serverConfigCache;
}

async function buildToolDefinitions(context?: TurnContext): Promise<ChatCompletionTool[]> {
  if (_toolDefinitionCache) return _toolDefinitionCache;

  const configs = await getServerConfigs(context);
  const tools: ChatCompletionTool[] = [];
  _toolServerMap.clear();

  for (const config of configs) {
    try {
      const mcpTools: McpClientTool[] = await mcpService.getMcpClientTools(config.mcpServerName, config);
      for (const t of mcpTools) {
        const tool: ChatCompletionTool = {
          type: 'function',
          function: {
            name: t.name, // already prefixed with server name by SDK
            description: t.description ?? `${config.mcpServerName} tool: ${t.name}`,
            parameters: {
              type: t.inputSchema.type,
              properties: t.inputSchema.properties ?? {},
              required: t.inputSchema.required ?? [],
            },
          },
        };
        tools.push(tool);
        _toolServerMap.set(t.name, config);
      }
      console.log(`[MCP] Loaded ${mcpTools.length} tool(s) from ${config.mcpServerName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[MCP] Failed to load tools from ${config.mcpServerName}: ${msg}`);
    }
  }

  _toolDefinitionCache = tools;
  return tools;
}

// ---------------------------------------------------------------------------
// Call an MCP tool by name using StreamableHTTP transport
// ---------------------------------------------------------------------------

async function invokeMcpTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
  const serverConfig = _toolServerMap.get(toolName);
  if (!serverConfig) {
    throw new Error(`[MCP] No server found for tool "${toolName}"`);
  }

  const client = new Client({ name: 'morgan-finance-agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
    requestInit: { headers: serverConfig.headers ?? {} },
  });

  try {
    await client.connect(transport);
    const result = await client.callTool({ name: toolName, arguments: params });
    return result;
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Public API — called by tools/index.ts and agent.ts
// ---------------------------------------------------------------------------

/** Returns all live MCP tool definitions. Falls back to [] if MCP unavailable. */
export async function getLiveMcpToolDefinitions(context?: TurnContext): Promise<ChatCompletionTool[]> {
  if (!isMcpAvailable()) return [];
  return buildToolDefinitions(context);
}

/** Invalidates caches (call after config changes). */
export function invalidateMcpCache(): void {
  _serverConfigCache = null;
  _toolDefinitionCache = null;
  _toolServerMap.clear();
  console.log('[MCP] Cache invalidated');
}

// ---------------------------------------------------------------------------
// Typed wrappers (used by tools/index.ts dispatcher)
// ---------------------------------------------------------------------------

export interface McpToolInfo {
  available: boolean;
  endpoint: string;
  serverCount: number;
  toolCount: number;
}

export async function getMcpTools(context?: TurnContext): Promise<McpToolInfo> {
  if (!isMcpAvailable()) {
    return { available: false, endpoint: '', serverCount: 0, toolCount: 0 };
  }
  const tools = await getLiveMcpToolDefinitions(context);
  const servers = new Set(tools.map(t => _toolServerMap.get('function' in t ? t.function.name : '')?.mcpServerName)).size;
  return {
    available: true,
    endpoint: process.env.MCP_PLATFORM_ENDPOINT!,
    serverCount: servers,
    toolCount: tools.length,
  };
}

export interface TeamsMessageResult { success: boolean; messageId?: string; error?: string; }
export interface EmailResult { success: boolean; messageId?: string; error?: string; }
export interface WordDocumentResult { success: boolean; documentUrl?: string; localPath?: string; error?: string; }
export interface SharePointDataResult { success: boolean; data: unknown; source: 'mcp' | 'mock'; error?: string; }

export async function sendTeamsMessage(params: { channel_id: string; message: string; subject?: string }, context?: TurnContext): Promise<TeamsMessageResult> {
  if (isMcpAvailable()) {
    try {
      await buildToolDefinitions(context); // ensure tool map populated with this user's context
      const result = await invokeMcpTool('mcp_TeamsServer_sendChannelMessage', { channelId: params.channel_id, content: params.message, subject: params.subject }) as { messageId?: string };
      console.log(`[MCP] Teams message sent to channel ${params.channel_id}`);
      return { success: true, messageId: result?.messageId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[MCP] sendTeamsMessage failed: ${error}`);
      return { success: false, error };
    }
  }
  console.log(`[DEMO] sendTeamsMessage → channel:${params.channel_id} subject:${params.subject ?? '(none)'}`);
  console.log(`[DEMO] ${params.message.slice(0, 200)}`);
  return { success: true, messageId: `demo-${Date.now()}` };
}

export async function sendEmail(params: { to: string; subject: string; body: string; importance?: 'normal' | 'high' }, context?: TurnContext): Promise<EmailResult> {
  if (isMcpAvailable()) {
    try {
      await buildToolDefinitions(context);
      const result = await invokeMcpTool('mcp_MailTools_sendMail', { to: params.to, subject: params.subject, body: params.body, importance: params.importance ?? 'normal' }) as { messageId?: string };
      console.log(`[MCP] Email sent to ${params.to}`);
      return { success: true, messageId: result?.messageId };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[MCP] sendEmail failed: ${error}`);
      return { success: false, error };
    }
  }
  console.log(`[DEMO] sendEmail → to:${params.to} subject:${params.subject}`);
  return { success: true, messageId: `demo-email-${Date.now()}` };
}

export async function createWordDocument(params: { title: string; content: string; save_to_sharepoint?: boolean }, context?: TurnContext): Promise<WordDocumentResult> {
  if (isMcpAvailable()) {
    try {
      await buildToolDefinitions(context);
      const result = await invokeMcpTool('mcp_WordServer_createDocument', { title: params.title, content: params.content, saveToSharePoint: params.save_to_sharepoint ?? false }) as { documentUrl?: string };
      console.log(`[MCP] Word document created: "${params.title}"`);
      return { success: true, documentUrl: result?.documentUrl };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[MCP] createWordDocument failed: ${error}`);
      return { success: false, error };
    }
  }
  const tmpDir = process.env.TEMP ?? process.env.TMP ?? '/tmp';
  const safeName = params.title.replace(/[^a-z0-9_-]/gi, '_').slice(0, 80);
  const filePath = path.join(tmpDir, `${safeName}_${Date.now()}.md`);
  try {
    fs.writeFileSync(filePath, `# ${params.title}\n\n${params.content}`, 'utf8');
    console.log(`[DEMO] createWordDocument → saved to ${filePath}`);
    return { success: true, localPath: filePath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
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
      const data = await invokeMcpTool('mcp_SharePointRemoteServer_readFile', { site: params.site, filePath: params.file_path, dataType: params.data_type });
      console.log(`[MCP] SharePoint read: ${params.site}/${params.file_path}`);
      return { success: true, data, source: 'mcp' };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[MCP] readSharePointData failed: ${error}`);
      return { success: false, data: null, source: 'mcp', error };
    }
  }
  const mockData = MOCK_SHAREPOINT_DATA[params.data_type] ?? {};
  console.log(`[DEMO] readSharePointData → mock ${params.data_type}`);
  return { success: true, data: mockData, source: 'mock' };
}

// ---------------------------------------------------------------------------
// People lookup via Microsoft Graph
// ---------------------------------------------------------------------------

export interface PersonResult {
  displayName: string;
  email: string;
  jobTitle?: string;
  department?: string;
}

export interface LookupPersonResult {
  success: boolean;
  query: string;
  results: PersonResult[];
  error?: string;
}

export async function lookupPerson(params: { name: string }): Promise<LookupPersonResult> {
  try {
    const { ClientSecretCredential } = await import('@azure/identity');
    const credential = new ClientSecretCredential(
      process.env.MicrosoftAppTenantId!,
      process.env.MicrosoftAppId!,
      process.env.MicrosoftAppPassword!,
    );
    const tokenResult = await credential.getToken('https://graph.microsoft.com/.default');

    const searchQuery = encodeURIComponent(`"displayName:${params.name}"`);
    const url = `https://graph.microsoft.com/v1.0/users?$search=${searchQuery}&$select=displayName,mail,userPrincipalName,jobTitle,department&$top=5`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${tokenResult.token}`,
        'ConsistencyLevel': 'eventual',
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Graph] People search failed (${response.status}): ${errText}`);
      return { success: false, query: params.name, results: [], error: `Graph API error: ${response.status}` };
    }

    const data = await response.json() as { value: Array<{ displayName: string; mail?: string; userPrincipalName?: string; jobTitle?: string; department?: string }> };
    const results: PersonResult[] = data.value.map(u => ({
      displayName: u.displayName,
      email: u.mail || u.userPrincipalName || '',
      jobTitle: u.jobTitle || undefined,
      department: u.department || undefined,
    }));

    console.log(`[Graph] People search for "${params.name}" → ${results.length} result(s)`);
    return { success: true, query: params.name, results };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[Graph] lookupPerson failed: ${error}`);
    return { success: false, query: params.name, results: [], error };
  }
}

// ---------------------------------------------------------------------------
// Static tool definitions (for tools that don't come from live MCP discovery)
// These remain available even before MCP is initialised
// ---------------------------------------------------------------------------

export const MCP_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  { type: 'function', function: { name: 'getMcpTools', description: 'Check Work IQ MCP platform status and list available tools (Mail, Teams, SharePoint, Word, Calendar, Planner, Excel, OneDrive, Knowledge).', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'sendTeamsMessage', description: 'Send a message to a Microsoft Teams channel via Work IQ MCP.', parameters: { type: 'object', properties: { channel_id: { type: 'string', description: 'Teams channel ID.' }, message: { type: 'string', description: 'Message body (Markdown supported).' }, subject: { type: 'string', description: 'Optional subject/title.' } }, required: ['channel_id', 'message'] } } },
  { type: 'function', function: { name: 'sendEmail', description: 'Send an email via Microsoft 365 Mail using Work IQ MCP.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email.' }, subject: { type: 'string', description: 'Email subject.' }, body: { type: 'string', description: 'Email body (text or HTML).' }, importance: { type: 'string', enum: ['normal', 'high'], description: 'Importance flag.' } }, required: ['to', 'subject', 'body'] } } },
  { type: 'function', function: { name: 'createWordDocument', description: 'Create a Word document with the given title and content. Optionally saves to SharePoint.', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Document title.' }, content: { type: 'string', description: 'Document content in Markdown.' }, save_to_sharepoint: { type: 'boolean', description: 'Save to SharePoint after creation.' } }, required: ['title', 'content'] } } },
  { type: 'function', function: { name: 'readSharePointData', description: 'Read financial data from SharePoint (budget, actuals, or forecast).', parameters: { type: 'object', properties: { site: { type: 'string', description: 'SharePoint site URL.' }, file_path: { type: 'string', description: 'File path within the site.' }, data_type: { type: 'string', enum: ['budget', 'actuals', 'forecast'], description: 'Type of financial data.' } }, required: ['site', 'file_path', 'data_type'] } } },
  { type: 'function', function: { name: 'lookupPerson', description: 'Search for a person in the organization by name using Microsoft Graph. Returns their display name, email address, job title, and department. Use this to resolve a name to an email address before sending emails.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'The name (or partial name) of the person to search for.' } }, required: ['name'] } } },
];

