// ---------------------------------------------------------------------------
// Proactive Monitor — sends dynamic P&L updates to Teams every 25 minutes
// Users can turn monitoring on/off by messaging Morgan
// ---------------------------------------------------------------------------

import { TurnContext, CloudAdapter } from '@microsoft/agents-hosting';
import { Activity, ConversationReference } from '@microsoft/agents-activity';
import { generatePnlUpdate, resetPnlState } from './pnlMessages';
import fs from 'fs';
import path from 'path';

const INTERVAL_MS = 25 * 60 * 1000; // 25 minutes

// Per-conversation monitoring state
interface MonitorSession {
  conversationRef: ConversationReference;
  intervalId: ReturnType<typeof setInterval> | null;
  enabled: boolean;
  messagesSent: number;
  startedAt: Date | null;
  lastSeenAt: number;
}

// Store sessions keyed by conversation ID
const sessions = new Map<string, MonitorSession>();

// Persist conversation references to disk so proactive Teams delivery (e.g. the
// L2 HITL Adaptive Card) survives App Service restarts. Only the reference and
// last-seen timestamp are persisted; live intervals/state are runtime-only.
const CONVERSATION_REF_PATH = path.resolve(process.cwd(), process.env.MORGAN_CONVERSATION_REF_FILE || '.data/morgan-conversation-refs.json');

interface PersistedConversationRef {
  conversationId: string;
  conversationRef: ConversationReference;
  lastSeenAt: number;
}

function loadPersistedSessions(): void {
  try {
    if (!fs.existsSync(CONVERSATION_REF_PATH)) return;
    const parsed = JSON.parse(fs.readFileSync(CONVERSATION_REF_PATH, 'utf8'));
    if (!Array.isArray(parsed)) return;
    for (const entry of parsed as PersistedConversationRef[]) {
      if (!entry?.conversationId || !entry?.conversationRef) continue;
      sessions.set(entry.conversationId, {
        conversationRef: entry.conversationRef,
        intervalId: null,
        enabled: false,
        messagesSent: 0,
        startedAt: null,
        lastSeenAt: typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : Date.now(),
      });
    }
  } catch {
    // Ignore corrupt/unreadable persistence; capture will rebuild it.
  }
}

function persistSessions(): void {
  try {
    const snapshot: PersistedConversationRef[] = Array.from(sessions.entries())
      .map(([conversationId, session]) => ({ conversationId, conversationRef: session.conversationRef, lastSeenAt: session.lastSeenAt }))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, 50);
    fs.mkdirSync(path.dirname(CONVERSATION_REF_PATH), { recursive: true });
    fs.writeFileSync(CONVERSATION_REF_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
  } catch {
    // Persistence is best-effort; in-memory sessions remain authoritative.
  }
}

loadPersistedSessions();

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
      lastSeenAt: Date.now(),
    });
  } else {
    // Update the reference (tokens/serviceUrl may change)
    const session = sessions.get(convId)!;
    session.conversationRef = ref;
    session.lastSeenAt = Date.now();
  }
  persistSessions();
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
// Proactive delivery to the most recently active Teams conversation
// Persona-neutral: lets other modules (e.g. HITL approval cards) reach the
// latest captured conversation without owning their own conversation state.
// ---------------------------------------------------------------------------

export async function sendProactiveMessageToLatestConversation(message: string, label = 'proactive-message'): Promise<{ success: boolean; messageId?: string; target?: string; source: string; error?: string }> {
  const activity = new Activity('message');
  activity.text = message;
  return sendProactiveActivityToLatestConversation(activity, label);
}

export async function sendProactiveActivityToLatestConversation(activity: Activity, label = 'proactive-activity'): Promise<{ success: boolean; messageId?: string; target?: string; source: string; error?: string }> {
  if (!_adapter) {
    return { success: false, source: 'bot-proactive', error: 'Teams adapter is not initialized yet.' };
  }

  const latest = Array.from(sessions.entries()).sort((a, b) => b[1].lastSeenAt - a[1].lastSeenAt)[0];
  if (!latest) {
    return { success: false, source: 'bot-proactive', error: 'No Teams conversation reference has been captured yet. Message Morgan in Teams once to enable proactive updates.' };
  }

  const [conversationId, session] = latest;
  try {
    await _adapter.continueConversation(
      _botAppId,
      session.conversationRef,
      async (turnContext: TurnContext) => {
        await turnContext.sendActivity(activity);
      },
    );
    session.messagesSent++;
    return { success: true, messageId: `${label}-${Date.now()}`, target: conversationId, source: 'bot-proactive-latest-conversation' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Monitor] Failed to send ${label}: ${msg}`);
    return { success: false, target: conversationId, source: 'bot-proactive-latest-conversation', error: msg };
  }
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
