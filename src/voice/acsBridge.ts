import {
  CallAutomationClient,
  type CallInvite,
  type CreateCallOptions,
  type MediaStreamingOptions,
} from '@azure/communication-call-automation';
import type { CommunicationUserIdentifier } from '@azure/communication-common';
import { CommunicationIdentityClient } from '@azure/communication-identity';
import { DefaultAzureCredential } from '@azure/identity';
import type { Server as HttpServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { MORGAN_SYSTEM_PROMPT } from '../persona';
import { recordAuditEvent } from '../observability/agentAudit';
import { recordAgentEvent } from '../observability/agentEvents';

const ACS_CONNECTION_STRING = process.env.ACS_CONNECTION_STRING || '';
const PUBLIC_HOSTNAME = process.env.PUBLIC_HOSTNAME || process.env.WEBSITE_HOSTNAME || '';
const REALTIME_API_VERSION = process.env.AZURE_OPENAI_REALTIME_API_VERSION || '2025-04-01-preview';
const VOICE_DEPLOYMENT = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT || process.env.VOICELIVE_MODEL || 'gpt-4o';
const FEDERATION_RESOURCE_ID = process.env.ACS_TEAMS_FEDERATION_RESOURCE_ID || '';

const credential = new DefaultAzureCredential();
let acsClient: CallAutomationClient | null = null;
let sourceUserId = process.env.ACS_SOURCE_USER_ID || '';

interface ActiveCallState {
  callConnectionId: string;
  targetTeamsOid: string;
  targetDisplayName?: string;
  requestedBy?: string;
  instructions: string;
  voice: string;
  startedAt: number;
  direction: 'outbound' | 'inbound';
}

export interface TeamsFederationCallingStatus {
  configured: boolean;
  acsConnectionConfigured: boolean;
  sourceIdentityConfigured: boolean;
  publicHostConfigured: boolean;
  realtimeConfigured: boolean;
  federationResourceIdConfigured: boolean;
  federationAdminCommand: string;
  activeCalls: number;
  videoPresence: {
    status: 'audio-live-video-roadmap';
    currentMode: string;
    nextStep: string;
  };
}

const activeCalls = new Map<string, ActiveCallState>();

async function ensureSourceIdentity(): Promise<CommunicationUserIdentifier> {
  if (sourceUserId) return { communicationUserId: sourceUserId };
  const identityClient = new CommunicationIdentityClient(ACS_CONNECTION_STRING);
  const user = await identityClient.createUser();
  sourceUserId = user.communicationUserId;
  console.log('[ACS] Source identity provisioned. Set ACS_SOURCE_USER_ID to persist it across restarts.');
  return { communicationUserId: sourceUserId };
}

async function getAcsClient(): Promise<CallAutomationClient> {
  if (acsClient) return acsClient;
  if (!ACS_CONNECTION_STRING) throw new Error('ACS_CONNECTION_STRING is not configured.');
  const sourceIdentity = await ensureSourceIdentity();
  acsClient = new CallAutomationClient(ACS_CONNECTION_STRING, { sourceIdentity });
  return acsClient;
}

function callbackHost(): string {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (PUBLIC_HOSTNAME) return PUBLIC_HOSTNAME.replace(/^https?:\/\//, '').replace(/\/$/, '');
  throw new Error('Set BASE_URL, PUBLIC_HOSTNAME, or WEBSITE_HOSTNAME before using ACS Teams calling.');
}

export function isAcsConfigured(): boolean {
  return Boolean(ACS_CONNECTION_STRING);
}

function mediaStreamingOptions(transportUri: string): MediaStreamingOptions {
  return {
    transportUrl: transportUri,
    transportType: 'websocket',
    contentType: 'audio',
    audioChannelType: 'mixed',
    startMediaStreaming: true,
    enableBidirectional: true,
    audioFormat: 'Pcm24KMono',
  };
}

function openAiCognitiveEndpoint(): string {
  return (process.env.AZURE_OPENAI_ENDPOINT || process.env.VOICELIVE_ENDPOINT || process.env.AZURE_AI_SERVICES_ENDPOINT || '').replace(/\/$/, '');
}

function openAiRealtimeEndpoint(): string {
  return (process.env.AZURE_OPENAI_REALTIME_ENDPOINT || openAiCognitiveEndpoint()).replace(/\/$/, '');
}

function buildRealtimeSocketUrl(): { url: string; provider: 'voice-live' | 'azure-openai-realtime' } {
  // For the ACS Teams call bridge we always use the Azure OpenAI realtime
  // websocket path — that's the protocol Cassidy proved works end-to-end with
  // ACS bidirectional Pcm24KMono media streaming. The Voice Live endpoint
  // (used elsewhere for the in-browser avatar) speaks a different session
  // schema (azure-standard voice / azure_semantic_vad) that does not pair
  // with ACS media-streaming envelopes, which is why callers heard nothing.
  const realtimeEndpoint = openAiRealtimeEndpoint();
  if (!realtimeEndpoint) throw new Error('AZURE_OPENAI_REALTIME_ENDPOINT, AZURE_OPENAI_ENDPOINT, or VOICELIVE_ENDPOINT is required for ACS realtime calling.');
  const url = new URL(realtimeEndpoint);
  return {
    provider: 'azure-openai-realtime',
    url: `wss://${url.host}/openai/realtime?deployment=${encodeURIComponent(VOICE_DEPLOYMENT)}&api-version=${encodeURIComponent(REALTIME_API_VERSION)}`,
  };
}

function latestActiveCall(): ActiveCallState | undefined {
  return Array.from(activeCalls.values()).sort((left, right) => right.startedAt - left.startedAt)[0];
}

function sendAcsOutboundAudio(ws: WebSocket, base64Audio: string): void {
  // Mirror Cassidy's working envelope: a JSON string with kind='AudioData'
  // and the base64 PCM in audioData.data. The ACS bidirectional media
  // streaming socket expects this literal envelope; the SDK's
  // createOutboundAudioData helper produced a different shape that ACS was
  // dropping silently, which is why Morgan was inaudible on Teams calls.
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ kind: 'AudioData', audioData: { data: base64Audio } }));
  }
}

function sendAcsStopAudio(ws: WebSocket): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ kind: 'StopAudio', stopAudio: {} }));
  }
}

export function getTeamsFederationCallingStatus(): TeamsFederationCallingStatus {
  const publicHostConfigured = Boolean(process.env.BASE_URL || PUBLIC_HOSTNAME);
  const realtimeConfigured = Boolean(openAiRealtimeEndpoint() && VOICE_DEPLOYMENT);
  const configured = Boolean(ACS_CONNECTION_STRING && publicHostConfigured && realtimeConfigured);
  return {
    configured,
    acsConnectionConfigured: Boolean(ACS_CONNECTION_STRING),
    sourceIdentityConfigured: Boolean(sourceUserId),
    publicHostConfigured,
    realtimeConfigured,
    federationResourceIdConfigured: Boolean(FEDERATION_RESOURCE_ID),
    federationAdminCommand: `Set-CsTeamsAcsFederationConfiguration -EnableAcsUsers $true -AllowedAcsResources @{Add='${FEDERATION_RESOURCE_ID || '<ACS resource id>'}'}`,
    activeCalls: activeCalls.size,
    videoPresence: {
      status: 'audio-live-video-roadmap',
      currentMode: 'ACS Call Automation bridges bidirectional audio into Teams calls today.',
      nextStep: 'Add a Teams-compatible video sender for Aria-as-Morgan, either through an ACS Calling SDK video client that joins the call/meeting or a Teams media bot path if video media injection is required.',
    },
  };
}

export async function initiateOutboundTeamsCall(opts: {
  teamsUserAadOid: string;
  targetDisplayName?: string;
  requestedBy?: string;
  instructions?: string;
  voice?: string;
}): Promise<{ callConnectionId: string; serverCallId?: string }> {
  const client = await getAcsClient();
  const host = callbackHost();
  const callbackUri = `https://${host}/api/calls/acs-events`;
  const transportUri = `wss://${host}/api/calls/acs-media`;

  const invite: CallInvite = {
    targetParticipant: { microsoftTeamsUserId: opts.teamsUserAadOid },
    sourceDisplayName: opts.requestedBy ? `Morgan (for ${opts.requestedBy})` : 'Morgan - Digital CFO',
  };

  const openAiEndpoint = openAiCognitiveEndpoint();
  const createOptions: CreateCallOptions = {
    callIntelligenceOptions: openAiEndpoint ? { cognitiveServicesEndpoint: openAiEndpoint } : undefined,
    mediaStreamingOptions: mediaStreamingOptions(transportUri),
  };

  const result = await client.createCall(invite, callbackUri, createOptions).catch((err) => {
    const error = err as { message?: string; statusCode?: number; code?: string; request?: { requestId?: string }; response?: { bodyAsText?: string }; details?: unknown };
    const detail = {
      target: opts.teamsUserAadOid,
      statusCode: error.statusCode,
      code: error.code,
      requestId: error.request?.requestId,
      message: error.message,
      body: error.response?.bodyAsText || error.details,
      federationCommand: getTeamsFederationCallingStatus().federationAdminCommand,
    };
    console.error('[ACS] Outbound Teams call failed', detail);
    recordAuditEvent({
      kind: 'teams.call.failed',
      label: 'Outbound Teams federation call failed',
      severity: 'error',
      data: detail,
    });
    throw err;
  });
  const callConnectionId = result.callConnectionProperties?.callConnectionId || '';
  const serverCallId = result.callConnectionProperties?.serverCallId;

  activeCalls.set(callConnectionId, {
    callConnectionId,
    targetTeamsOid: opts.teamsUserAadOid,
    targetDisplayName: opts.targetDisplayName,
    requestedBy: opts.requestedBy,
    instructions:
      opts.instructions ||
      'You are Morgan, the Digital CFO. You placed this Teams call because a finance item needs attention. Greet the user, state the reason for the call, and keep the conversation concise.',
    voice: opts.voice || process.env.ACS_REALTIME_VOICE || 'verse',
    startedAt: Date.now(),
    direction: 'outbound',
  });

  recordAuditEvent({
    kind: 'teams.call.started',
    label: 'Outbound Teams federation call placed',
    correlationId: callConnectionId || undefined,
    data: { callConnectionId, target: opts.teamsUserAadOid, targetDisplayName: opts.targetDisplayName, serverCallId },
  });
  console.log(`[ACS] Outbound Teams call placed: ${callConnectionId}`);
  return { callConnectionId, serverCallId };
}

export async function answerInboundCall(opts: {
  incomingCallContext: string;
  callerId?: string;
  callerDisplayName?: string;
  instructions?: string;
  voice?: string;
}): Promise<{ callConnectionId: string }> {
  const client = await getAcsClient();
  const host = callbackHost();
  const callbackUri = `https://${host}/api/calls/acs-events`;
  const transportUri = `wss://${host}/api/calls/acs-media`;
  const openAiEndpoint = openAiCognitiveEndpoint();
  const result = await client.answerCall(opts.incomingCallContext, callbackUri, {
    callIntelligenceOptions: openAiEndpoint ? { cognitiveServicesEndpoint: openAiEndpoint } : undefined,
    mediaStreamingOptions: mediaStreamingOptions(transportUri),
  });
  const callConnectionId = result.callConnectionProperties?.callConnectionId || '';
  activeCalls.set(callConnectionId, {
    callConnectionId,
    targetTeamsOid: opts.callerId || 'inbound-caller',
    targetDisplayName: opts.callerDisplayName,
    requestedBy: opts.callerDisplayName,
    instructions:
      opts.instructions ||
      `You are Morgan, the Digital CFO. ${opts.callerDisplayName ? `${opts.callerDisplayName} just called you.` : 'A Teams user just called you.'} Greet them, listen first, then respond with concise CFO-office context.`,
    voice: opts.voice || process.env.ACS_REALTIME_VOICE || 'verse',
    startedAt: Date.now(),
    direction: 'inbound',
  });
  recordAuditEvent({
    kind: 'teams.call.answered',
    label: 'Inbound Teams federation call answered',
    correlationId: callConnectionId || undefined,
    data: { callConnectionId, callerId: opts.callerId, callerDisplayName: opts.callerDisplayName },
  });
  return { callConnectionId };
}

export function handleAcsEvent(body: unknown): void {
  const events = Array.isArray(body) ? body : [body];
  for (const raw of events) {
    const event = raw as { type?: string; data?: { callConnectionId?: string; resultInformation?: unknown } };
    const type = event.type || '(unknown)';
    const callConnectionId = event.data?.callConnectionId;
    console.log('[ACS] Event', { type, callConnectionId, resultInformation: event.data?.resultInformation });
    if (type.endsWith('CallConnected') && callConnectionId) {
      recordAuditEvent({
        kind: 'teams.call.connected',
        label: 'Teams federation call connected',
        correlationId: callConnectionId,
        data: { callConnectionId, eventType: type },
      });
    } else if (type.endsWith('CallDisconnected') && callConnectionId) {
      const state = activeCalls.get(callConnectionId);
      const durationSec = state ? Math.round((Date.now() - state.startedAt) / 1000) : 0;
      activeCalls.delete(callConnectionId);
      recordAuditEvent({
        kind: 'teams.call.disconnected',
        label: 'Teams federation call disconnected',
        correlationId: callConnectionId,
        data: { callConnectionId, eventType: type, durationSec, resultInformation: event.data?.resultInformation },
      });
    } else if (type.endsWith('CreateCallFailed') || type.endsWith('AddParticipantFailed')) {
      recordAuditEvent({
        kind: 'teams.call.failed',
        label: 'Teams federation call lifecycle failure',
        severity: 'error',
        correlationId: callConnectionId || undefined,
        data: { callConnectionId, eventType: type, resultInformation: event.data?.resultInformation },
      });
    }
  }
}

export async function handleIncomingCallEvent(body: unknown): Promise<
  | { validationResponse: string }
  | { answered: true; callConnectionId: string }
  | { ignored: true; reason: string }
> {
  const events = Array.isArray(body) ? body : [body];
  for (const raw of events) {
    const event = raw as {
      eventType?: string;
      data?: {
        validationCode?: string;
        incomingCallContext?: string;
        from?: { rawId?: string; displayName?: string };
        callerDisplayName?: string;
      };
    };
    const eventType = event.eventType || '';
    if (eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent' && event.data?.validationCode) {
      return { validationResponse: event.data.validationCode };
    }
    if (eventType === 'Microsoft.Communication.IncomingCall' && event.data?.incomingCallContext) {
      const callerDisplayName = event.data.callerDisplayName || event.data.from?.displayName;
      const callerId = event.data.from?.rawId;
      const result = await answerInboundCall({
        incomingCallContext: event.data.incomingCallContext,
        callerId,
        callerDisplayName,
      });
      return { answered: true, callConnectionId: result.callConnectionId };
    }
  }
  return { ignored: true, reason: 'No supported incoming call event found.' };
}

export function getActiveCallSnapshot(): Array<{
  callConnectionId: string;
  targetTeamsOid: string;
  targetDisplayName?: string;
  requestedBy?: string;
  voice: string;
  startedAt: number;
  ageSec: number;
  direction: 'outbound' | 'inbound';
}> {
  const now = Date.now();
  return Array.from(activeCalls.values()).map((call) => ({
    callConnectionId: call.callConnectionId,
    targetTeamsOid: call.targetTeamsOid,
    targetDisplayName: call.targetDisplayName,
    requestedBy: call.requestedBy,
    voice: call.voice,
    startedAt: call.startedAt,
    ageSec: Math.round((now - call.startedAt) / 1000),
    direction: call.direction,
  }));
}

export function attachAcsMediaWebSocket(httpServer: HttpServer): void {
  if (!ACS_CONNECTION_STRING) {
    console.log('[ACS] ACS_CONNECTION_STRING not set - Teams call bridge disabled.');
    return;
  }

  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url || !req.url.startsWith('/api/calls/acs-media')) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleAcsMediaSocket(ws).catch((err) => {
        console.error('[ACS] Media socket crashed:', err);
        try { ws.close(); } catch { /* ignore */ }
      });
    });
  });

  console.log('[ACS] Media WebSocket ready at /api/calls/acs-media');
}

async function handleAcsMediaSocket(acsWs: WebSocket): Promise<void> {
  let callConnectionId: string | undefined;
  let mediaSubscriptionId: string | undefined;
  let realtimeWs: WebSocket | null = null;
  let realtimeOpen = false;
  let sessionConfigured = false;
  const pendingAudio: string[] = [];
  let receivedAudioFrames = 0;
  let sentAudioFrames = 0;
  let configureFallbackTimer: NodeJS.Timeout | null = null;

  const resolveCallState = (): ActiveCallState | undefined => {
    if (callConnectionId && activeCalls.has(callConnectionId)) return activeCalls.get(callConnectionId);
    return latestActiveCall();
  };

  const flushPendingAudio = (): void => {
    if (!sessionConfigured || !realtimeWs || realtimeWs.readyState !== WebSocket.OPEN) return;
    while (pendingAudio.length) {
      realtimeWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: pendingAudio.shift() }));
    }
  };

  const configureRealtimeSession = (): void => {
    if (!realtimeWs || !realtimeOpen || sessionConfigured) return;
    const state = resolveCallState();
    const requestedVoice = state?.voice || process.env.ACS_REALTIME_VOICE;
    const instructions = `${MORGAN_SYSTEM_PROMPT}\n\n${state?.instructions || 'You are on a Microsoft Teams voice call. Speak clearly, be concise, and focus on finance risks, completed work, or the requested CFO action.'}`;
    // ACS Teams bridge always uses the Azure OpenAI realtime session schema
    // (pcm16 in/out + server_vad) — same as Cassidy. The Voice Live azure-
    // standard schema is used in the browser/avatar path only.
    const realtimeVoice = requestedVoice || 'verse';
    const session = {
      modalities: ['audio', 'text'],
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      voice: realtimeVoice,
      instructions,
      turn_detection: { type: 'server_vad' },
    };

    realtimeWs.send(JSON.stringify({ type: 'session.update', session }));
    sessionConfigured = true;
    flushPendingAudio();
    realtimeWs.send(JSON.stringify({ type: 'response.create', response: { modalities: ['audio', 'text'] } }));
    recordAuditEvent({
      kind: 'teams.call.media.started',
      label: 'Teams call media bridge connected to Morgan realtime voice',
      correlationId: callConnectionId || mediaSubscriptionId,
      data: { callConnectionId, mediaSubscriptionId, voice: realtimeVoice, provider: 'azure-openai-realtime' },
    });
    recordAgentEvent({
      kind: 'teams.call',
      label: 'Teams call media bridge connected to Morgan realtime voice',
      status: 'ok',
      correlationId: callConnectionId || mediaSubscriptionId,
      data: {
        callConnectionId,
        mediaSubscriptionId,
        source: 'ACS Teams federation',
        voice: realtimeVoice,
        provider: 'azure-openai-realtime',
        reasoningSummary: 'Morgan is connected to the Teams call media stream and can now listen, reason over the spoken request, and send audio back.',
      },
    });
  };

  try {
    const token = await credential.getToken('https://cognitiveservices.azure.com/.default');
    const realtime = buildRealtimeSocketUrl();
    realtimeWs = new WebSocket(realtime.url, { headers: { Authorization: `Bearer ${token.token}` } });

    realtimeWs.on('open', () => {
      console.log(`[ACS] Connected to ${realtime.provider} realtime audio service`);
      realtimeOpen = true;
      configureFallbackTimer = setTimeout(configureRealtimeSession, 700);
    });

    realtimeWs.on('unexpected-response', (_request, response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk.toString();
        if (body.length > 1600) body = body.slice(0, 1600);
      });
      response.on('end', () => {
        const detail = {
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          deployment: VOICE_DEPLOYMENT,
          endpointHost: new URL(realtime.url).host,
          body: body.slice(0, 1200),
        };
        console.error('[ACS] Realtime WebSocket unexpected response', detail);
        recordAuditEvent({
          kind: 'teams.call.media.failed',
          label: 'Morgan realtime voice WebSocket was rejected during Teams call media bridge',
          severity: 'error',
          correlationId: callConnectionId || mediaSubscriptionId,
          data: detail,
        });
        try { acsWs.close(); } catch { /* ignore */ }
      });
    });

    realtimeWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type?: string; delta?: string; error?: unknown };
        if (msg.type === 'response.audio.delta' && msg.delta) {
          sentAudioFrames++;
          sendAcsOutboundAudio(acsWs, msg.delta);
        } else if (msg.type === 'input_audio_buffer.speech_started') {
          sendAcsStopAudio(acsWs);
        } else if (msg.type === 'error') {
          console.error('[ACS] Realtime error:', msg.error);
          recordAuditEvent({
            kind: 'teams.call.media.failed',
            label: 'Morgan realtime voice returned an error during Teams call media bridge',
            severity: 'error',
            correlationId: callConnectionId || mediaSubscriptionId,
            data: { error: msg.error },
          });
        }
      } catch { /* ignore parse errors */ }
    });

    realtimeWs.on('close', (code, reason) => {
      console.log(`[ACS] Realtime WebSocket closed: ${code} ${reason}`);
      try { acsWs.close(); } catch { /* ignore */ }
    });
    realtimeWs.on('error', (err) => console.error('[ACS] Realtime WebSocket error:', err.message));
  } catch (err) {
    console.error('[ACS] Failed to open realtime connection:', err);
    try { acsWs.close(); } catch { /* ignore */ }
    return;
  }

  acsWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as { kind?: string; audioData?: { data?: string; silent?: boolean; isSilent?: boolean }; audioMetadata?: { subscriptionId?: string; mediaSubscriptionId?: string; callConnectionId?: string; sampleRate?: number; encoding?: string; channels?: number } };
      if (msg.kind === 'AudioData' && msg.audioData?.data) {
        receivedAudioFrames++;
        if (sessionConfigured && realtimeWs?.readyState === WebSocket.OPEN) {
          realtimeWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: msg.audioData.data }));
        } else {
          pendingAudio.push(msg.audioData.data);
        }
      } else if (msg.kind === 'AudioMetadata' && msg.audioMetadata) {
        mediaSubscriptionId = msg.audioMetadata.subscriptionId || msg.audioMetadata.mediaSubscriptionId || mediaSubscriptionId;
        callConnectionId = msg.audioMetadata.callConnectionId || callConnectionId;
        console.log('[ACS] Media metadata received', { mediaSubscriptionId, callConnectionId, sampleRate: msg.audioMetadata.sampleRate, encoding: msg.audioMetadata.encoding, channels: msg.audioMetadata.channels });
        configureRealtimeSession();
      }
    } catch { /* ignore non-json frames */ }
  });

  acsWs.on('close', () => {
    if (configureFallbackTimer) clearTimeout(configureFallbackTimer);
    recordAuditEvent({
      kind: 'teams.call.media.closed',
      label: 'Teams call media bridge closed',
      correlationId: callConnectionId || mediaSubscriptionId,
      data: { callConnectionId, mediaSubscriptionId, receivedAudioFrames, sentAudioFrames, pendingAudioFrames: pendingAudio.length },
    });
    recordAgentEvent({
      kind: 'teams.call',
      label: 'Teams call media bridge closed',
      status: sentAudioFrames && receivedAudioFrames ? 'ok' : 'partial',
      correlationId: callConnectionId || mediaSubscriptionId,
      data: {
        callConnectionId,
        mediaSubscriptionId,
        receivedAudioFrames,
        sentAudioFrames,
        pendingAudioFrames: pendingAudio.length,
        source: 'ACS Teams federation',
        reasoningSummary: `Teams media bridge closed after receiving ${receivedAudioFrames} caller audio frame(s) and sending ${sentAudioFrames} Morgan audio frame(s).`,
      },
    });
    try { realtimeWs?.close(); } catch { /* ignore */ }
  });
  acsWs.on('error', (err) => console.warn('[ACS] Media WebSocket error:', err.message));
}
