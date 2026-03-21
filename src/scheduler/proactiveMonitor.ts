// ---------------------------------------------------------------------------
// Proactive Monitor — sends dynamic P&L updates to Teams every 25 minutes
// Users can turn monitoring on/off by messaging Morgan
// ---------------------------------------------------------------------------

import { TurnContext, CloudAdapter } from '@microsoft/agents-hosting';
import { ConversationReference } from '@microsoft/agents-activity';
import { generatePnlUpdate, resetPnlState } from './pnlMessages';

const INTERVAL_MS = 25 * 60 * 1000; // 25 minutes

// Per-conversation monitoring state
interface MonitorSession {
  conversationRef: ConversationReference;
  intervalId: ReturnType<typeof setInterval> | null;
  enabled: boolean;
  messagesSent: number;
  startedAt: Date | null;
}

// Store sessions keyed by conversation ID
const sessions = new Map<string, MonitorSession>();

// Reference to the adapter — set once from index.ts
let _adapter: CloudAdapter | null = null;
let _botAppId: string = '';

export function setAdapter(adapter: CloudAdapter): void {
  _adapter = adapter;
  _botAppId = process.env.MicrosoftAppId ?? '';
}

// ---------------------------------------------------------------------------
// Conversation reference capture — call on every incoming message
// ---------------------------------------------------------------------------

export function captureConversationReference(context: TurnContext): void {
  const activity = context.activity;
  if (!activity?.conversation?.id) return;

  const ref = activity.getConversationReference();
  const convId = activity.conversation.id;

  if (!sessions.has(convId)) {
    sessions.set(convId, {
      conversationRef: ref,
      intervalId: null,
      enabled: false,
      messagesSent: 0,
      startedAt: null,
    });
  } else {
    // Update the reference (tokens/serviceUrl may change)
    sessions.get(convId)!.conversationRef = ref;
  }
}

// ---------------------------------------------------------------------------
// Start / stop monitoring
// ---------------------------------------------------------------------------

export function startMonitoring(conversationId: string): { success: boolean; message: string } {
  const session = sessions.get(conversationId);
  if (!session) {
    return { success: false, message: 'No conversation reference found. Send me a message first so I know where to reach you.' };
  }
  if (session.enabled && session.intervalId) {
    return { success: false, message: `Monitoring is already running. I've sent ${session.messagesSent} update(s) since ${session.startedAt?.toLocaleTimeString('en-AU') ?? 'start'}.` };
  }

  session.enabled = true;
  session.messagesSent = 0;
  session.startedAt = new Date();
  resetPnlState();

  // Send the first update immediately, then every 25 minutes
  sendProactiveUpdate(session);

  session.intervalId = setInterval(() => {
    if (session.enabled) {
      sendProactiveUpdate(session);
    }
  }, INTERVAL_MS);

  console.log(`[Monitor] Started proactive monitoring for conversation ${conversationId} — first update sent, interval=${INTERVAL_MS}ms`);
  return {
    success: true,
    message: `✅ **P&L Monitoring activated.**\n\nI'll send you real-time financial updates every 25 minutes right here in Teams. You'll get P&L movements, variance alerts, margin analysis, and anomaly detection — just like having a colleague watching the numbers for you.\n\nTo stop, just tell me: **"stop monitoring"**`,
  };
}

export function stopMonitoring(conversationId: string): { success: boolean; message: string } {
  const session = sessions.get(conversationId);
  if (!session || !session.enabled) {
    return { success: false, message: 'Monitoring is not currently active.' };
  }

  if (session.intervalId) {
    clearInterval(session.intervalId);
    session.intervalId = null;
  }
  session.enabled = false;

  const summary = `⏹️ **P&L Monitoring paused.**\n\nI sent ${session.messagesSent} update(s) since ${session.startedAt?.toLocaleTimeString('en-AU') ?? 'start'}.\n\nTo resume anytime, just say: **"start monitoring"**`;
  console.log(`[Monitor] Stopped proactive monitoring for conversation ${conversationId}`);
  return { success: true, message: summary };
}

export function getMonitoringStatus(conversationId: string): { enabled: boolean; messagesSent: number; startedAt: Date | null } {
  const session = sessions.get(conversationId);
  if (!session) return { enabled: false, messagesSent: 0, startedAt: null };
  return { enabled: session.enabled, messagesSent: session.messagesSent, startedAt: session.startedAt };
}

// ---------------------------------------------------------------------------
// Proactive send
// ---------------------------------------------------------------------------

async function sendProactiveUpdate(session: MonitorSession): Promise<void> {
  if (!_adapter) {
    console.error('[Monitor] Adapter not set — cannot send proactive message');
    return;
  }

  console.log(`[Monitor] Preparing proactive update #${session.messagesSent + 1}...`);
  const message = generatePnlUpdate();

  try {
    await _adapter.continueConversation(
      _botAppId,
      session.conversationRef,
      async (turnContext: TurnContext) => {
        await turnContext.sendActivity(message);
      },
    );
    session.messagesSent++;
    console.log(`[Monitor] Proactive update #${session.messagesSent} sent`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Monitor] Failed to send proactive update: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Command detection — returns a command if the message matches, else null
// ---------------------------------------------------------------------------

export type MonitorCommand = 'start' | 'stop' | 'status' | null;

export function detectMonitorCommand(text: string): MonitorCommand {
  const lower = text.toLowerCase().trim();

  // Start patterns
  if (/\b(start|begin|enable|activate|turn on|resume)\b.*\b(monitor|updates?|alerts?|tracking|pnl|p&l)\b/.test(lower)) return 'start';
  if (/\b(monitor|updates?|alerts?|tracking|pnl|p&l)\b.*\b(on|start|begin|enable|activate|resume)\b/.test(lower)) return 'start';
  if (lower === 'start monitoring' || lower === 'start updates') return 'start';

  // Stop patterns
  if (/\b(stop|pause|disable|deactivate|turn off|halt|end)\b.*\b(monitor|updates?|alerts?|tracking|pnl|p&l)\b/.test(lower)) return 'stop';
  if (/\b(monitor|updates?|alerts?|tracking|pnl|p&l)\b.*\b(off|stop|pause|disable|deactivate|halt|end)\b/.test(lower)) return 'stop';
  if (lower === 'stop monitoring' || lower === 'stop updates') return 'stop';

  // Status
  if (/\b(monitor|updates?)\b.*\b(status|info)\b/.test(lower)) return 'status';
  if (lower === 'monitoring status') return 'status';

  return null;
}
