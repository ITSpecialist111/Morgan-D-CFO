import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import express, { Response } from 'express';
import { AzureOpenAI } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat';
import { MORGAN_SYSTEM_PROMPT } from '../persona';
import { executeTool, getAllTools } from '../tools';
import { getLiveMcpToolDefinitions } from '../tools/mcpToolSetup';
import { recordAuditEvent } from '../observability/agentAudit';
import { recordAgentEvent } from '../observability/agentEvents';
import { tryHandleShowcaseShortcut } from '../showcaseShortcuts';

interface FoundryResponsesRequest {
  input?: string | Array<{ role?: string; content?: string | Array<{ text?: string; type?: string }> }>;
  instructions?: string;
  metadata?: Record<string, unknown>;
}

function extractInputText(input: FoundryResponsesRequest['input']): string {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  return input.map((item) => {
    if (typeof item.content === 'string') return item.content;
    if (Array.isArray(item.content)) return item.content.map((part) => part.text || '').join(' ');
    return '';
  }).filter(Boolean).join('\n');
}

function outputResponse(text: string, metadata?: Record<string, unknown>): Record<string, unknown> {
  const responseId = `resp_${Date.now()}`;
  return {
    id: responseId,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5',
    metadata: metadata || {},
    output: [
      {
        id: `msg_${Date.now()}`,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      },
    ],
    output_text: text,
  };
}

function createOpenAiClient(): AzureOpenAI | null {
  if (!process.env.AZURE_OPENAI_ENDPOINT) return null;
  const credential = new DefaultAzureCredential();
  const azureADTokenProvider = getBearerTokenProvider(credential, 'https://cognitiveservices.azure.com/.default');
  return new AzureOpenAI({
    azureADTokenProvider,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2025-04-01-preview',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5',
  });
}

function toolName(tool: ChatCompletionTool): string {
  return tool.type === 'function' ? tool.function.name : '';
}

interface EnterpriseReadinessCheckSummary {
  id?: string;
  area?: string;
  status?: string;
  signal?: string;
  control?: string;
  evidence?: string[];
}

interface WorkIQStatusSummary {
  available?: boolean;
  endpoint?: string;
  serverCount?: number;
  toolCount?: number;
  cassidyParity?: { matched?: string[]; missing?: string[]; optional?: string[] };
  notes?: string[];
}

function parseToolJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isConfigured(value: string | undefined): boolean {
  return Boolean(value && !/^<.*>$/.test(value) && !/your-|example|\.\.\.|optional-/i.test(value));
}

function envStatus(required: string[]): string {
  const missing = required.filter((name) => !isConfigured(process.env[name]));
  return missing.length ? `needs ${missing.join(', ')}` : 'configured';
}

function readinessLine(checks: EnterpriseReadinessCheckSummary[], id: string, fallbackArea: string): string {
  const check = checks.find((item) => item.id === id);
  if (!check) return `- **${fallbackArea}**: not reported by readiness tool.`;
  return `- **${check.area || fallbackArea}**: ${check.status || 'unknown'} — ${check.signal || 'no signal reported'}`;
}

function isHostedConfigurationQuestion(inputText: string): boolean {
  return /\b(required settings|settings required|fully live|full(y)? configured|production parity|production readiness|integration settings|what.*configured|which.*configured|readiness|Graph\/MCP|MCP|WorkIQ|Fabric\/Power BI|Application Insights|durable storage|ACS voice)\b/i.test(inputText);
}

async function tryHandleHostedConfigurationQuestion(inputText: string, correlationId: string): Promise<string | null> {
  if (!isHostedConfigurationQuestion(inputText)) return null;

  const readiness = parseToolJson<EnterpriseReadinessCheckSummary[]>(await executeTool('getEnterpriseReadiness', {}), []);
  const workIq = parseToolJson<WorkIQStatusSummary>(await executeTool('getWorkIQStatus', {}), {});
  recordAgentEvent({
    kind: 'agent.reply',
    label: 'Foundry hosted readiness/configuration answer generated deterministically',
    status: 'ok',
    correlationId,
    data: {
      responsePreview: inputText.slice(0, 300),
      reasoningSummary: 'Morgan used readiness/status tools for a hosted configuration question instead of the Microsoft IQ briefing demo path.',
    },
  });

  const graphMcpStatus = workIq.available
    ? `${workIq.serverCount || 0} server(s), ${workIq.toolCount || 0} tool(s) discovered`
    : 'not configured in this hosted payload';
  const missingPillars = workIq.cassidyParity?.missing?.length ? workIq.cassidyParity.missing.join(', ') : 'none reported';

  return [
    '**Morgan hosted readiness and required settings**',
    '',
    'Current hosted proof: Foundry Responses routing is active and Azure OpenAI is configured for this hosted version. Do not treat this as proof that Microsoft 365, Graph/MCP, Fabric, voice, observability, or durable storage are live unless the readiness lines below say configured or ready.',
    '',
    '**Configured in the hosted model path**',
    `- **Azure OpenAI text model**: ${envStatus(['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_DEPLOYMENT', 'AZURE_CLIENT_ID'])}`,
    `- **Hosted identity hint**: ${isConfigured(process.env.AZURE_CLIENT_ID) ? 'AZURE_CLIENT_ID present for user-assigned managed identity auth' : 'AZURE_CLIENT_ID missing'}`,
    `- **Foundry Responses host**: ready on /responses and /readiness inside the container`,
    '',
    '**Still required before full production parity**',
    `- **WorkIQ / Graph / Agent 365 MCP**: ${graphMcpStatus}; missing expected pillars: ${missingPillars}. Required env includes MCP_PLATFORM_ENDPOINT, MicrosoftAppId, MicrosoftAppTenantId, and the Agent 365 auth connection/permissions.`,
    `- **Fabric / Power BI**: ${envStatus(['FABRIC_WORKSPACE_ID'])} for workspace; also review FABRIC_LAKEHOUSE_ID, FABRIC_SEMANTIC_MODEL_ID, and POWERBI_SEMANTIC_MODEL_ID.`,
    `- **ACS voice / Teams federation**: ${envStatus(['ACS_CONNECTION_STRING', 'ACS_SOURCE_USER_ID'])}; also needs BASE_URL or PUBLIC_HOSTNAME, realtime model settings, CFO_TEAMS_USER_AAD_OID, and tenant federation policy.`,
    `- **Observability**: ${envStatus(['APPLICATIONINSIGHTS_CONNECTION_STRING'])}; also review APPLICATIONINSIGHTS_RESOURCE_ID, LOG_ANALYTICS_WORKSPACE_ID, PURVIEW_AUDIT_WORKSPACE_ID, and PURVIEW_AUDIT_ENABLED.`,
    `- **Durable storage and work records**: ${envStatus(['COSMOS_DB_ENDPOINT', 'COSMOS_DB_DATABASE', 'COSMOS_DB_CONTAINER'])}; for App Service demos preserve MORGAN_MISSION_STATE_FILE on mounted storage.`,
    `- **Autonomous scheduler safety**: ${envStatus(['SCHEDULED_SECRET'])}; review AUTONOMOUS_WORKDAY_* settings before enabling unattended cycles.`,
    `- **Sub-agent mesh**: review AI_KANBAN_AGENT_ENDPOINT, CASSIDY_AGENT_ENDPOINT, AVATAR_AGENT_ENDPOINT, bearer tokens, and shared secrets before claiming worker-agent collaboration.`,
    '',
    '**Readiness tool signals**',
    readinessLine(readiness, 'mcp-tooling', 'Agent 365 MCP tooling'),
    readinessLine(readiness, 'foundry-iq', 'Foundry IQ'),
    readinessLine(readiness, 'fabric-iq', 'Fabric IQ'),
    readinessLine(readiness, 'avatar-presence', 'Avatar and Voice Live'),
    readinessLine(readiness, 'teams-federation-calling', 'Teams federation calling'),
    readinessLine(readiness, 'observability', 'Application Insights and Log Analytics'),
    readinessLine(readiness, 'durable-memory', 'Durable memory and work records'),
    readinessLine(readiness, 'scheduler-safety', 'Autonomous scheduling and safety gates'),
    '',
    'Next action: configure one connector group at a time, create a new immutable hosted-agent version with reviewed env values, then rerun the P0 smoke dataset through the direct Foundry Responses endpoint.',
  ].join('\n');
}

const HOSTED_EVIDENCE_BOUNDARY = [
  'Hosted-agent evidence boundary:',
  '- If the user asks what is required, what is configured, what is fully live, or what still blocks production parity, answer from getEnterpriseReadiness and getWorkIQStatus; do not call synthesizeMicrosoftIQBriefing for that intent.',
  '- Never claim Mail, Calendar, Teams, SharePoint, Graph/MCP, Fabric, Power BI, ACS voice, Application Insights, Purview, durable storage, or sub-agent calls succeeded unless a tool result or readiness status says configured/ready for that specific surface.',
  '- The Microsoft IQ, WorkIQ, Foundry IQ, and Fabric IQ demo adapters are deterministic showcase data until tenant connectors and env values are present. Label demo data clearly.',
  '- For hosted Foundry smoke tests, separate three facts: container reachable, Azure OpenAI reachable, and enterprise connectors configured. Do not collapse them into one claim.',
].join('\n');

async function runMorganCompletion(inputText: string, requestMetadata?: Record<string, unknown>): Promise<string> {
  const client = createOpenAiClient();
  if (!client) {
    return 'Morgan is running as a hosted-agent container, but AZURE_OPENAI_ENDPOINT is not configured. Mission Control, health, and audit endpoints are available for setup verification.';
  }
  const correlationId = String(requestMetadata?.correlationId || `foundry-${Date.now()}`);
  recordAgentEvent({
    kind: 'agent.message',
    label: `Foundry request: ${(inputText || '').slice(0, 90)}`,
    correlationId,
    data: {
      channel: 'foundry',
      inputLength: inputText.length,
      promptPreview: inputText.slice(0, 700),
      reasoningSummary: 'Morgan received a Foundry hosted-agent request and is preparing the tool-enabled CFO response loop.',
    },
  });

  const hostedConfigurationReply = await tryHandleHostedConfigurationQuestion(inputText, correlationId);
  if (hostedConfigurationReply) return hostedConfigurationReply;

  const showcaseReply = await tryHandleShowcaseShortcut(inputText, undefined, { allowVoiceActions: false });
  if (showcaseReply) {
    recordAgentEvent({
      kind: 'agent.reply',
      label: `Foundry showcase shortcut reply with ${showcaseReply.length} character(s)`,
      status: 'ok',
      correlationId,
      data: {
        responseLength: showcaseReply.length,
        responsePreview: showcaseReply.slice(0, 700),
        reasoningSummary: 'Morgan used a deterministic showcase shortcut to call the required tool for a Dragon Den demo prompt.',
      },
    });
    return showcaseReply;
  }

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        MORGAN_SYSTEM_PROMPT +
        '\n\nYou are being invoked through Microsoft Foundry Hosted Agent Responses protocol. Keep responses concise, record meaningful autonomous work, and include completed actions where relevant.\n' +
        HOSTED_EVIDENCE_BOUNDARY,
    },
    { role: 'user', content: inputText || 'Give a short Morgan status update.' },
  ];

  const staticTools = getAllTools();
  let liveMcpTools: ChatCompletionTool[] = [];
  try {
    liveMcpTools = await getLiveMcpToolDefinitions();
  } catch (err) {
    recordAgentEvent({ kind: 'mcp.discover', label: 'Foundry live MCP discovery failed', status: 'error', correlationId, data: { error: err instanceof Error ? err.message : String(err) } });
  }
  const liveMcpToolNames = new Set(liveMcpTools.map(toolName));
  const staticToolNames = new Set(staticTools.map(toolName));
  const mergedTools = [
    ...staticTools,
    ...liveMcpTools.filter((tool) => !staticToolNames.has(toolName(tool))),
  ].slice(0, 128);
  recordAgentEvent({ kind: 'mcp.discover', label: `Foundry turn loaded ${liveMcpTools.length} live MCP tool(s)`, status: liveMcpTools.length ? 'ok' : 'partial', correlationId, data: { liveMcpTools: liveMcpTools.length, staticTools: staticTools.length, totalTools: mergedTools.length } });

  const maxIterations = 8;
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const started = Date.now();
    const response = await client.chat.completions.create({
      model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5',
      messages,
      tools: mergedTools,
      tool_choice: 'auto',
      max_completion_tokens: 2500,
    });

    const choice = response.choices[0];
    messages.push(choice.message as ChatCompletionMessageParam);
    const toolCalls = choice.message.tool_calls || [];
    const toolCallNames = toolCalls.map((toolCall) => toolCall.type === 'function' ? toolCall.function.name : toolCall.type);
    recordAgentEvent({
      kind: 'llm.turn',
      label: `Foundry reasoning turn ${iteration + 1}: ${toolCalls.length} tool call(s)`,
      status: 'ok',
      durationMs: Date.now() - started,
      correlationId,
      data: {
        finishReason: choice.finish_reason,
        toolCalls: toolCallNames,
        reasoningSummary: toolCallNames.length
          ? `Morgan selected ${toolCallNames.length} Foundry turn tool call(s): ${toolCallNames.join(', ')}.`
          : `Morgan completed the Foundry reasoning turn with finish reason ${choice.finish_reason || 'unknown'}.`,
      },
    });

    if (!toolCalls.length) {
      const output = choice.message.content?.trim() || 'Morgan completed the hosted-agent turn but did not produce text output.';
      recordAgentEvent({
        kind: 'agent.reply',
        label: `Foundry reply with ${output.length} character(s)`,
        status: 'ok',
        correlationId,
        data: {
          responseLength: output.length,
          responsePreview: output.slice(0, 700),
          reasoningSummary: 'Morgan produced a Foundry response using the available hosted-agent context and tool evidence.',
        },
      });
      return output;
    }

    const toolResults = await Promise.all(toolCalls.map(async (toolCall) => {
      if (toolCall.type !== 'function') {
        return { role: 'tool' as const, tool_call_id: toolCall.id, content: '{}' };
      }
      const params = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
      const toolStarted = Date.now();
      const source = liveMcpToolNames.has(toolCall.function.name) ? 'Agent 365 MCP' : 'Morgan static tool';
      recordAgentEvent({ kind: 'tool.call', label: `${source}: ${toolCall.function.name}`, status: 'started', correlationId, data: { source, tool: toolCall.function.name, parameterKeys: Object.keys(params) } });
      const content = await executeTool(toolCall.function.name, params);
      recordAgentEvent({ kind: 'tool.result', label: `${toolCall.function.name} ${content.includes('"error"') ? 'failed' : 'completed'}`, status: content.includes('"error"') ? 'error' : 'ok', durationMs: Date.now() - toolStarted, correlationId, data: { source, tool: toolCall.function.name, resultBytes: Buffer.byteLength(content, 'utf8') } });
      return { role: 'tool' as const, tool_call_id: toolCall.id, content };
    }));
    messages.push(...toolResults);
  }

  return 'Morgan reached the hosted-agent tool iteration limit. Review observability events for the detailed trace.';
}

export function registerFoundryResponsesRoutes(server: express.Express): void {
  const readinessHandler = (_req: express.Request, res: Response) => {
    res.status(200).json({
      status: 'ready',
      protocol: 'responses',
      agent: process.env.AGENT_NAME || 'Morgan',
      foundryProjectEndpoint: process.env.FOUNDRY_PROJECT_ENDPOINT || null,
      timestamp: new Date().toISOString(),
    });
  };

  server.get('/responses/health', readinessHandler);
  server.get('/readiness', readinessHandler);

  server.post('/responses', async (req: express.Request, res: Response) => {
    const body = req.body as FoundryResponsesRequest;
    const inputText = extractInputText(body.input);
    const correlationId = String(req.headers['x-ms-client-request-id'] || req.headers['x-correlation-id'] || `foundry-${Date.now()}`);

    recordAuditEvent({
      kind: 'foundry.response.request',
      label: 'Foundry hosted agent request received',
      correlationId,
      data: { inputLength: inputText.length, metadata: body.metadata || {} },
    });

    try {
      const text = await runMorganCompletion(inputText, { ...(body.metadata || {}), correlationId });
      recordAuditEvent({
        kind: 'foundry.response.completed',
        label: 'Foundry hosted agent request completed',
        correlationId,
        data: { outputLength: text.length },
      });
      res.status(200).json(outputResponse(text, { ...(body.metadata || {}), correlationId }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      recordAuditEvent({
        kind: 'foundry.response.failed',
        label: 'Foundry hosted agent request failed',
        correlationId,
        severity: 'error',
        data: { error: message },
      });
      res.status(500).json({ error: message, correlationId });
    }
  });
}
