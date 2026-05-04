import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import express, { Response } from 'express';
import { AzureOpenAI } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat';
import { MORGAN_SYSTEM_PROMPT } from '../persona';
import { executeTool, getAllTools } from '../tools';
import { getLiveMcpToolDefinitions } from '../tools/mcpToolSetup';
import { recordAuditEvent } from '../observability/agentAudit';
import { recordAgentEvent } from '../observability/agentEvents';

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

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        MORGAN_SYSTEM_PROMPT +
        '\n\nYou are being invoked through Microsoft Foundry Hosted Agent Responses protocol. Keep responses concise, record meaningful autonomous work, and include completed actions where relevant.',
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
  const mergedTools = [
    ...liveMcpTools,
    ...staticTools.filter((tool) => !liveMcpToolNames.has(toolName(tool))),
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
  server.get('/responses/health', (_req, res: Response) => {
    res.status(200).json({
      status: 'ready',
      protocol: 'responses',
      agent: process.env.AGENT_NAME || 'Morgan',
      foundryProjectEndpoint: process.env.FOUNDRY_PROJECT_ENDPOINT || null,
      timestamp: new Date().toISOString(),
    });
  });

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
