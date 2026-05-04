// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Load environment variables first (required before other imports)
import { configDotenv } from 'dotenv';
configDotenv();

import { TurnState, AgentApplication, TurnContext } from '@microsoft/agents-hosting';
import { ActivityTypes, Activity } from '@microsoft/agents-activity';
import { AzureOpenAI } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { MORGAN_SYSTEM_PROMPT } from './persona';
import { getAllTools, executeTool, executeAutonomousBriefing, executeEndOfDayReport } from './tools/index';
import { getLiveMcpToolDefinitions } from './tools/mcpToolSetup';
import {
  captureConversationReference,
  detectMonitorCommand,
  startMonitoring,
  stopMonitoring,
  getMonitoringStatus,
} from './scheduler/proactiveMonitor';
import {
  detectVoiceCommand,
  enableVoice,
  disableVoice,
  isVoiceEnabled,
} from './voice/voiceGate';
import { recordAuditEvent } from './observability/agentAudit';
import { recordAgentEvent } from './observability/agentEvents';
import { createAgentStorage } from './storage/agentStorage';

// State interfaces
interface ConversationData {
  history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }>;
  lastBriefingDate?: string;
}
interface AppTurnState extends TurnState {
  conversation: ConversationData;
}

// Keyless auth via managed identity (Azure) or local az login (dev)
export const credential = new DefaultAzureCredential();
const azureADTokenProvider = getBearerTokenProvider(
  credential,
  'https://cognitiveservices.azure.com/.default'
);

if (!process.env.AZURE_OPENAI_ENDPOINT) {
  console.warn('WARNING: AZURE_OPENAI_ENDPOINT is not set. OpenAI calls will fail.');
}

const openai = new AzureOpenAI({
  azureADTokenProvider,
  endpoint: process.env.AZURE_OPENAI_ENDPOINT || 'https://placeholder.openai.azure.com',
  apiVersion: '2025-04-01-preview',
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5',
});

function parseAgenticScopes(): string[] {
  const raw =
    process.env.connections__service_connection__settings__scopes ||
    process.env.agentic_scopes ||
    'https://graph.microsoft.com/.default';
  return raw.split(',').map((scope) => scope.trim()).filter(Boolean);
}

export const agentApplication = new AgentApplication<AppTurnState>({
  storage: createAgentStorage(),
  authorization: {
    AgenticAuthConnection: {
      type: 'agentic',
      scopes: parseAgenticScopes(),
      altBlueprintConnectionName: process.env.agentic_altBlueprintConnectionName || 'service_connection',
    },
  },
});

function toolName(tool: ChatCompletionTool): string {
  return tool.type === 'function' ? tool.function.name : '';
}

const MICROSOFT_365_WRAPPER_TOOLS = new Set([
  'getMcpTools',
  'getMorganIdentity',
  'getWorkIQStatus',
  'findUser',
  'lookupPerson',
  'sendTeamsMessage',
  'sendEmail',
  'createWordDocument',
  'createPlannerTask',
  'updatePlannerTask',
  'scheduleCalendarEvent',
  'listUpcomingMeetings',
  'collectMeetingContext',
  'readSharePointData',
  'readSharePointList',
]);

function classifyTool(name: string, liveMcpToolNames: Set<string>): string {
  if (liveMcpToolNames.has(name)) return 'Agent 365 MCP';
  if (MICROSOFT_365_WRAPPER_TOOLS.has(name)) return 'Graph / Microsoft 365 wrapper';
  return 'Morgan native';
}

agentApplication.onActivity(ActivityTypes.Message, async (context: TurnContext, state: AppTurnState) => {
  const userMessage = context.activity.text?.trim() || '';
  const userName = context.activity.from?.name || 'there';
  const correlationId = context.activity.id || context.activity.conversation?.id || `teams-${Date.now()}`;

  // Always capture the conversation reference for proactive messaging
  captureConversationReference(context);
  recordAuditEvent({
    kind: 'agent365.teams.message.received',
    label: 'Teams message received through Agent 365 SDK channel',
    correlationId,
    actor: userName,
    data: {
      channelId: context.activity.channelId,
      conversationId: context.activity.conversation?.id,
      textLength: userMessage.length,
    },
  });
  recordAgentEvent({
    kind: 'agent.message',
    label: `${userName}: ${userMessage.slice(0, 90)}`,
    correlationId,
    data: {
      channelId: context.activity.channelId,
      conversationId: context.activity.conversation?.id,
      textLength: userMessage.length,
      promptPreview: userMessage.slice(0, 700),
      reasoningSummary: 'Morgan received a user prompt and is selecting whether to answer directly, discover tools, or enter the finance tool loop.',
    },
  });

  if (!userMessage) {
    try {
      await context.sendActivity(`Hi ${userName}! I'm Morgan, your Digital Finance Analyst. How can I help you today?`);
    } catch { /* ignore */ }
    return;
  }

  // Check for voice on/off commands
  const voiceCmd = detectVoiceCommand(userMessage);
  console.log(`[Agent] Message: "${userMessage.substring(0, 80)}" | voiceCmd=${voiceCmd}`);
  if (voiceCmd) {
    console.log(`[Agent] Executing voice command: ${voiceCmd}`);
    const voiceUrl = `https://${process.env.WEBSITE_HOSTNAME || 'localhost:3978'}/voice`;
    let msg: string;
    if (voiceCmd === 'enable') {
      enableVoice();
      msg = `✅ **Voice interface enabled.**\n\nMorgan is now available at:\n${voiceUrl}\n\nSay **"disable voice"** when you're done to take her offline.`;
    } else if (voiceCmd === 'disable') {
      disableVoice();
      msg = `⏹️ **Voice interface disabled.**\n\nThe voice page now shows Morgan as offline. Visitors will see a professional offline screen.\n\nSay **"enable voice"** to bring her back.`;
    } else {
      msg = isVoiceEnabled()
        ? `🎙️ **Voice is currently enabled.**\nURL: ${voiceUrl}`
        : `🔇 **Voice is currently disabled.** Say **"enable voice"** to activate.`;
    }
    try { await context.sendActivity(msg); } catch { /* ignore */ }
    return;
  }

  // Check for monitoring on/off commands before entering the LLM loop
  const monitorCmd = detectMonitorCommand(userMessage);
  console.log(`[Agent] Message from ${userName}: "${userMessage.substring(0, 80)}" | monitorCmd=${monitorCmd}`);
  if (monitorCmd) {
    const convId = context.activity.conversation?.id ?? '';
    console.log(`[Agent] Executing monitor command: ${monitorCmd} for conversation: ${convId}`);
    let result: { success: boolean; message: string };
    if (monitorCmd === 'start') {
      result = startMonitoring(convId);
    } else if (monitorCmd === 'stop') {
      result = stopMonitoring(convId);
    } else {
      const status = getMonitoringStatus(convId);
      result = {
        success: true,
        message: status.enabled
          ? `📊 **Monitoring is active.** I've sent ${status.messagesSent} update(s) since ${status.startedAt?.toLocaleTimeString('en-AU') ?? 'start'}.`
          : `Monitoring is currently **off**. Say **"start monitoring"** to activate.`,
      };
    }
    try { await context.sendActivity(result.message); } catch { /* ignore */ }
    return;
  }

  if (!state.conversation?.history) {
    state.conversation = { history: [] };
  }
  state.conversation.history.push({ role: 'user', content: userMessage });
  const recentHistory = state.conversation.history.slice(-20);

  // Send a typing indicator immediately, then keep it alive every 4s so Teams
  // continues to show "Morgan is typing…" during long GPT-5 reasoning turns
  // (Teams clears typing after ~10–15s without a refresh). Mirrors Cassidy.
  try { await context.sendActivity(new Activity(ActivityTypes.Typing)); } catch { /* ignore */ }
  const typingInterval = setInterval(async () => {
    try { await context.sendActivity(new Activity(ActivityTypes.Typing)); } catch { /* ignore */ }
  }, 4000);

  try {
    // Build messages array for the agentic loop
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: MORGAN_SYSTEM_PROMPT },
      ...recentHistory.map(m => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, tool_call_id: m.tool_call_id!, content: m.content };
        }
        return { role: m.role as 'user' | 'assistant', content: m.content };
      }),
    ];

    const staticTools = getAllTools();
    let liveMcpTools: ChatCompletionTool[] = [];
    try {
      liveMcpTools = await getLiveMcpToolDefinitions(context);
    } catch (err) {
      recordAgentEvent({
        kind: 'mcp.discover',
        label: 'Live Agent 365 MCP tool discovery failed',
        status: 'error',
        correlationId,
        data: { error: err instanceof Error ? err.message : String(err) },
      });
    }
    const liveMcpToolNames = new Set(liveMcpTools.map(toolName));
    const mergedTools = [
      ...liveMcpTools,
      ...staticTools.filter((tool) => !liveMcpToolNames.has(toolName(tool))),
    ].slice(0, 128);

    recordAgentEvent({
      kind: 'mcp.discover',
      label: `Morgan turn loaded ${liveMcpTools.length} live MCP tool(s)`,
      status: liveMcpTools.length > 0 ? 'ok' : 'partial',
      correlationId,
      data: { liveMcpTools: liveMcpTools.length, staticTools: staticTools.length, totalTools: mergedTools.length },
    });

    // Agentic loop — GPT-4o reasons + calls tools until it produces a final response
    let reply = 'Sorry, I could not generate a response.';
    const maxIterations = 10;
    for (let i = 0; i < maxIterations; i++) {
      const iterationStarted = Date.now();
      const response = await openai.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5',
        messages,
        tools: mergedTools,
        tool_choice: 'auto',
        max_completion_tokens: 4000,
      });

      const choice = response.choices[0];
      messages.push(choice.message as ChatCompletionMessageParam);
      const toolCalls = choice.message.tool_calls || [];
      recordAgentEvent({
        kind: 'llm.turn',
        label: `Morgan reasoning turn ${i + 1}: ${toolCalls.length} tool call(s)`,
        status: 'ok',
        durationMs: Date.now() - iterationStarted,
        correlationId,
        data: {
          finishReason: choice.finish_reason,
          toolCalls: toolCalls.map((toolCall) => toolCall.type === 'function' ? toolCall.function.name : toolCall.type),
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
          reasoningSummary: toolCalls.length
            ? `Morgan decided this turn needs ${toolCalls.length} tool call(s): ${toolCalls.map((toolCall) => toolCall.type === 'function' ? toolCall.function.name : toolCall.type).join(', ')}.`
            : `Morgan decided it had enough context to respond with finish reason ${choice.finish_reason || 'unknown'}.`,
        },
      });

      if (choice.finish_reason === 'stop' || !toolCalls.length) {
        const content = choice.message.content?.trim();
        if (content) {
          reply = content;
          break;
        }
        // GPT-5 reasoning models can return stop with empty content after tool use.
        // Ask once more for a summary, then bail on the next iteration.
        if (i < maxIterations - 2) {
          messages.push({ role: 'user' as const, content: 'Please summarise what you found or did in a concise response to the user.' });
          continue;
        }
        break;
      }

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        toolCalls.map(async (toolCall) => {
          if (toolCall.type !== 'function') {
            return { role: 'tool' as const, tool_call_id: toolCall.id, content: '{}' };
          }
          const calledToolName = toolCall.function.name;
          const params = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
          const toolStarted = Date.now();
          const source = classifyTool(calledToolName, liveMcpToolNames);
          recordAgentEvent({
            kind: 'tool.call',
            label: `${source}: ${calledToolName}`,
            status: 'started',
            correlationId,
            data: {
              source,
              tool: calledToolName,
              parameterKeys: Object.keys(params || {}),
              liveMcp: liveMcpToolNames.has(calledToolName),
            },
          });
          const result = await executeTool(calledToolName, params, context);
          const isError = result.includes('"error"');
          recordAgentEvent({
            kind: 'tool.result',
            label: `${calledToolName} ${isError ? 'failed' : 'completed'}`,
            status: isError ? 'error' : 'ok',
            durationMs: Date.now() - toolStarted,
            correlationId,
            data: {
              source,
              tool: calledToolName,
              liveMcp: liveMcpToolNames.has(calledToolName),
              resultBytes: Buffer.byteLength(result, 'utf8'),
            },
          });
          return {
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: result,
          };
        })
      );
      messages.push(...toolResults);
    }

    state.conversation.history.push({ role: 'assistant', content: reply });
    recordAuditEvent({
      kind: 'agent365.teams.response.sent',
      label: 'Teams response sent through Agent 365 SDK channel',
      correlationId,
      actor: 'Morgan',
      data: { responseLength: reply.length },
    });
    recordAgentEvent({
      kind: 'agent.reply',
      label: `Morgan replied with ${reply.length} character(s)`,
      status: 'ok',
      correlationId,
      data: {
        responseLength: reply.length,
        responsePreview: reply.slice(0, 700),
        reasoningSummary: 'Morgan completed the turn and produced a user-facing response from the available context, tool results, and conversation history.',
      },
    });
    try {
      await context.sendActivity(reply);
    } catch (sendErr: unknown) {
      console.error('sendActivity error:', sendErr);
    }
  } catch (err: unknown) {
    console.error('OpenAI/tool error:', err);
    try {
      await context.sendActivity('Sorry, I encountered an error while processing your request. Please try again.');
    } catch (sendErr: unknown) {
      console.error('sendActivity error in catch block:', sendErr);
    }
  } finally {
    clearInterval(typingInterval);
  }
});

agentApplication.onActivity(ActivityTypes.InstallationUpdate, async (context: TurnContext, state: AppTurnState) => {
  if (context.activity.action === 'add') {
    try {
      await context.sendActivity(
        `👋 Hi! I'm **Morgan**, your Digital Finance Analyst.\n\n` +
        `I can help you with:\n` +
        `- 📊 Budget analysis & variance reporting\n` +
        `- 🔍 Anomaly detection across financial data\n` +
        `- 📋 Financial briefings & executive summaries\n` +
        `- 📁 Document creation & distribution\n` +
        `- 📬 Teams & email communication\n` +
        `- 🧭 **Mission Control** — view my job description, autonomous instructions, daily task log, and end-of-day breakdown\n` +
        `- 📞 **Teams voice escalation** — when configured, I can ring you via Microsoft Teams for urgent finance issues\n` +
        `- 📈 **Real-time P&L monitoring** — say **"start monitoring"** and I'll send you live updates every 25 minutes\n\n` +
        `Every Monday morning I'll automatically post the Finance Briefing to this channel.\n\n` +
        `How can I help you today?`
      );
    } catch (err: unknown) {
      console.error('InstallationUpdate sendActivity error:', err);
    }
  }
});

export async function runAutonomousBriefing(): Promise<void> {
  await executeAutonomousBriefing(openai);
}

export async function runEndOfDayReport(): Promise<void> {
  await executeEndOfDayReport();
}
