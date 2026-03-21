// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Load environment variables first (required before other imports)
import { configDotenv } from 'dotenv';
configDotenv();

import { TurnState, AgentApplication, TurnContext, MemoryStorage } from '@microsoft/agents-hosting';
import { ActivityTypes } from '@microsoft/agents-activity';
import { AzureOpenAI } from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { MORGAN_SYSTEM_PROMPT } from './persona';
import { getAllTools, executeTool, executeAutonomousBriefing } from './tools/index';
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

export const agentApplication = new AgentApplication<AppTurnState>({
  storage: new MemoryStorage(),
});

agentApplication.onActivity(ActivityTypes.Message, async (context: TurnContext, state: AppTurnState) => {
  const userMessage = context.activity.text?.trim() || '';
  const userName = context.activity.from?.name || 'there';

  // Always capture the conversation reference for proactive messaging
  captureConversationReference(context);

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

    // Agentic loop — GPT-4o reasons + calls tools until it produces a final response
    let reply = 'Sorry, I could not generate a response.';
    const maxIterations = 10;
    for (let i = 0; i < maxIterations; i++) {
      const response = await openai.chat.completions.create({
        model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-5',
        messages,
        tools: getAllTools(),
        tool_choice: 'auto',
        max_completion_tokens: 4000,
      });

      const choice = response.choices[0];
      messages.push(choice.message as ChatCompletionMessageParam);

      if (choice.finish_reason === 'stop' || !choice.message.tool_calls?.length) {
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
        choice.message.tool_calls.map(async (toolCall) => {
          if (toolCall.type !== 'function') {
            return { role: 'tool' as const, tool_call_id: toolCall.id, content: '{}' };
          }
          const params = JSON.parse(toolCall.function.arguments || '{}');
          const result = await executeTool(toolCall.function.name, params, context);
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
