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
import { tryHandleShowcaseShortcut } from './showcaseShortcuts';

// State interfaces
interface PendingDelivery {
  kind: 'assistant-response' | 'end-of-day-report';
  subject: string;
  body: string;
  createdAt: string;
  awaitingRecipient?: boolean;
}

interface ConversationData {
  history: Array<{ role: 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }>;
  lastBriefingDate?: string;
  knownEmail?: string;
  lastDeliverable?: PendingDelivery;
  pendingDelivery?: PendingDelivery;
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

const TEAMS_LIVE_MCP_DISCOVERY_TIMEOUT_MS = Number(process.env.TEAMS_LIVE_MCP_DISCOVERY_TIMEOUT_MS || 3_500);
const TEAMS_OPENAI_TIMEOUT_MS = Number(process.env.TEAMS_OPENAI_TIMEOUT_MS || 25_000);
const TEAMS_TOOL_TIMEOUT_MS = Number(process.env.TEAMS_TOOL_TIMEOUT_MS || 12_000);
const TEAMS_MAX_ITERATIONS = Math.max(1, Number(process.env.TEAMS_MAX_ITERATIONS || 4));
const TEAMS_MAX_COMPLETION_TOKENS = Math.max(512, Number(process.env.TEAMS_MAX_COMPLETION_TOKENS || 1600));

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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
  if (MICROSOFT_365_WRAPPER_TOOLS.has(name)) return 'WorkIQ / Graph wrapper';
  return 'Morgan native';
}

function normalizeIntent(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9@._\-\s]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractEmailAddress(input: string): string | undefined {
  const match = input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0].replace(/[).,;:]+$/, '');
}

function isEmailDeliveryRequest(input: string): boolean {
  const normalized = normalizeIntent(input).replace(/e\s*-\s*mail/g, 'email');
  const asksForMail = /\b(email|mail|send)\b/.test(normalized);
  const refersToPriorWork = /\b(that|this|it|report|summary|breakdown|to me|me)\b/.test(normalized);
  return asksForMail && refersToPriorWork;
}

function isEndOfDayRequest(input: string): boolean {
  return /\b(end of day|end-of-day|day end|day-end)\b/i.test(input);
}

function shouldRememberDeliverable(input: string, reply: string): boolean {
  if (reply.length < 80) return false;
  const normalized = normalizeIntent(input);
  return /\b(report|summary|briefing|breakdown|p l|pnl|profit and loss|microsoft iq|readiness|workday)\b/.test(normalized) || isEndOfDayRequest(input);
}

function createPendingDelivery(input: string, reply: string): PendingDelivery | undefined {
  if (!shouldRememberDeliverable(input, reply)) return undefined;
  const date = new Date().toISOString().slice(0, 10);
  return {
    kind: isEndOfDayRequest(input) ? 'end-of-day-report' : 'assistant-response',
    subject: isEndOfDayRequest(input) ? `Morgan End-of-Day CFO Report - ${date}` : `Morgan CFO Summary - ${date}`,
    body: reply,
    createdAt: new Date().toISOString(),
  };
}

function rememberDeliverable(state: AppTurnState, userMessage: string, reply: string): void {
  const deliverable = createPendingDelivery(userMessage, reply);
  if (deliverable) state.conversation.lastDeliverable = deliverable;
}

function parseToolJson<T>(raw: string): T | undefined {
  try { return JSON.parse(raw) as T; } catch { return undefined; }
}

async function sendPendingDelivery(
  context: TurnContext,
  state: AppTurnState,
  target: string,
  correlationId: string,
): Promise<string> {
  const delivery = state.conversation.pendingDelivery || state.conversation.lastDeliverable;
  if (!delivery) return 'I do not have a report or summary queued to email yet. Ask me for the report first, then say "email that to me."';

  state.conversation.pendingDelivery = { ...delivery, awaitingRecipient: true };
  recordAgentEvent({
    kind: 'tool.call',
    label: 'WorkIQ / Graph wrapper: sendEmail',
    status: 'started',
    correlationId,
    data: { source: 'WorkIQ / Graph wrapper', tool: 'sendEmail', pendingDeliveryKind: delivery.kind, targetType: extractEmailAddress(target) ? 'email' : 'display-name' },
  });
  const started = Date.now();
  const raw = await executeTool('sendEmail', {
    to: target,
    subject: delivery.subject,
    body: delivery.body,
    importance: delivery.kind === 'end-of-day-report' ? 'high' : 'normal',
  }, context);
  const result = parseToolJson<{ success?: boolean; messageId?: string; source?: string; error?: string }>(raw) || { success: false, error: raw };
  recordAgentEvent({
    kind: 'tool.result',
    label: `sendEmail ${result.success ? 'completed' : 'failed'}`,
    status: result.success ? 'ok' : 'error',
    durationMs: Date.now() - started,
    correlationId,
    data: { source: result.source || 'WorkIQ / Graph wrapper', tool: 'sendEmail', resultBytes: Buffer.byteLength(raw, 'utf8') },
  });

  if (result.success) {
    const email = extractEmailAddress(target);
    if (email) state.conversation.knownEmail = email;
    state.conversation.pendingDelivery = undefined;
    recordAuditEvent({
      kind: 'agent365.teams.response.sent',
      label: 'Morgan emailed pending deliverable through WorkIQ Mail path',
      correlationId,
      actor: 'Morgan',
      data: { deliveryKind: delivery.kind, mailSource: result.source, messageId: result.messageId },
    });
    return `Done. I emailed the ${delivery.kind === 'end-of-day-report' ? 'end-of-day report' : 'summary'} to ${target} using Morgan's WorkIQ Mail path${result.source ? ` (${result.source})` : ''}.`;
  }

  state.conversation.pendingDelivery = { ...delivery, awaitingRecipient: true };
  const targetWasEmail = Boolean(extractEmailAddress(target));
  if (targetWasEmail) {
    return `I tried to email the report to ${target}, but the Mail tool returned: ${result.error || 'unknown error'}. I still have the report queued.`;
  }
  return `I have the report queued, but I could not resolve your email address through WorkIQ/Graph yet. Send me the exact email address and I will send it straight away.`;
}

async function tryHandlePendingDelivery(
  userMessage: string,
  userName: string,
  context: TurnContext,
  state: AppTurnState,
  correlationId: string,
): Promise<string | null> {
  const email = extractEmailAddress(userMessage);
  if (email) state.conversation.knownEmail = email;

  const hasQueuedDelivery = Boolean(state.conversation.pendingDelivery || state.conversation.lastDeliverable);
  const isWaitingForAddress = Boolean(state.conversation.pendingDelivery?.awaitingRecipient);
  if (email && isWaitingForAddress) return sendPendingDelivery(context, state, email, correlationId);
  if (!isEmailDeliveryRequest(userMessage) || !hasQueuedDelivery) return null;

  const target = email || state.conversation.knownEmail || userName;
  return sendPendingDelivery(context, state, target, correlationId);
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
    state.conversation = { ...(state.conversation || {}), history: [] };
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
    const pendingDeliveryReply = await tryHandlePendingDelivery(userMessage, userName, context, state, correlationId);
    if (pendingDeliveryReply) {
      state.conversation.history.push({ role: 'assistant', content: pendingDeliveryReply });
      try { await context.sendActivity(pendingDeliveryReply); } catch (sendErr: unknown) { console.error('sendActivity error:', sendErr); }
      return;
    }

    const showcaseReply = await tryHandleShowcaseShortcut(userMessage, context, { allowVoiceActions: true });
    if (showcaseReply) {
      state.conversation.history.push({ role: 'assistant', content: showcaseReply });
      rememberDeliverable(state, userMessage, showcaseReply);
      recordAuditEvent({
        kind: 'agent365.teams.response.sent',
        label: 'Teams showcase shortcut response sent through Agent 365 SDK channel',
        correlationId,
        actor: 'Morgan',
        data: { responseLength: showcaseReply.length },
      });
      recordAgentEvent({
        kind: 'agent.reply',
        label: `Morgan replied with ${showcaseReply.length} character(s) via showcase shortcut`,
        status: 'ok',
        correlationId,
        data: {
          responseLength: showcaseReply.length,
          responsePreview: showcaseReply.slice(0, 700),
          reasoningSummary: 'Morgan used a deterministic showcase shortcut to call the required tool for a Dragon Den demo prompt.',
        },
      });
      try { await context.sendActivity(showcaseReply); } catch (sendErr: unknown) { console.error('sendActivity error:', sendErr); }
      return;
    }

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
      liveMcpTools = await withTimeout(
        getLiveMcpToolDefinitions(context),
        TEAMS_LIVE_MCP_DISCOVERY_TIMEOUT_MS,
        'Live Agent 365 MCP discovery',
      );
    } catch (err) {
      recordAgentEvent({
        kind: 'mcp.discover',
        label: 'Live Agent 365 MCP tool discovery failed',
        status: 'error',
        correlationId,
        data: { error: errorText(err) },
      });
    }
    const liveMcpToolNames = new Set(liveMcpTools.map(toolName));
    const staticToolNames = new Set(staticTools.map(toolName));
    const mergedTools = [
      ...staticTools,
      ...liveMcpTools.filter((tool) => !staticToolNames.has(toolName(tool))),
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
    const maxIterations = TEAMS_MAX_ITERATIONS;
    for (let i = 0; i < maxIterations; i++) {
      const iterationStarted = Date.now();
      const response = await withTimeout(
        openai.chat.completions.create({
          model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5',
          messages,
          tools: mergedTools,
          tool_choice: 'auto',
          max_completion_tokens: TEAMS_MAX_COMPLETION_TOKENS,
        }),
        TEAMS_OPENAI_TIMEOUT_MS,
        'Azure OpenAI Teams completion',
      );

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
          let result: string;
          let isError = false;
          try {
            result = await withTimeout(
              executeTool(calledToolName, params, context),
              TEAMS_TOOL_TIMEOUT_MS,
              `Morgan tool ${calledToolName}`,
            );
            isError = result.includes('"error"');
          } catch (err) {
            isError = true;
            result = JSON.stringify({ success: false, error: errorText(err), source });
          }
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
    rememberDeliverable(state, userMessage, reply);
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
