// Voice Live WebSocket proxy — bridges browser audio to Azure Voice Live service.
// Browser connects via WebSocket to /api/voice, this proxy forwards to Voice Live
// and relays events back. Morgan's persona and tools are configured server-side.

import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { DefaultAzureCredential } from '@azure/identity';
import { MORGAN_SYSTEM_PROMPT } from '../persona';
import { VOICE_TOOLS, executeVoiceTool } from './voiceTools';
import { isVoiceEnabled } from './voiceGate';
import { browserAuthRequired, getPrincipalFromHeaders, loginUrlFor } from '../easyAuth';
import { recordAgentEvent } from '../observability/agentEvents';

const VOICELIVE_ENDPOINT = process.env.VOICELIVE_ENDPOINT || '';
const VOICELIVE_MODEL = process.env.VOICELIVE_MODEL || 'gpt-5';
const DEFAULT_VOICE_NAME = 'en-US-Ava:DragonHDLatestNeural';
const VOICE_STYLES = [
  'anger',
  'confusion',
  'determination',
  'disgust',
  'embarrassment',
  'excitement',
  'fear',
  'generalconversation',
  'happiness',
  'hope',
  'jealousy',
  'joy',
  'narration',
  'neutral',
  'regret',
  'relief',
  'sadness',
  'shouting',
  'softvoice',
  'surprise',
  'whispering',
] as const;
let activeVoiceClient: WebSocket | null = null;

// Azure Voice Live WebSocket URL format
function buildVoiceLiveUrl(): string {
  // Endpoint: https://ai-morgan-voicelive.cognitiveservices.azure.com/
  // Voice Live path: /voice-live/realtime (NOT /openai/realtime)
  const url = new URL(VOICELIVE_ENDPOINT);
  const wsUrl = `wss://${url.host}/voice-live/realtime?api-version=2025-10-01&model=${VOICELIVE_MODEL}`;
  return wsUrl;
}

function configuredVoiceName(): string {
  return process.env.VOICE_NAME || process.env.VOICELIVE_VOICE || DEFAULT_VOICE_NAME;
}

function normalizedVoiceStyle(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  return (VOICE_STYLES as readonly string[]).includes(normalized) ? normalized : undefined;
}

function requestedVoiceStyle(request: IncomingMessage): string | undefined {
  try {
    const requestUrl = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    return normalizedVoiceStyle(requestUrl.searchParams.get('voiceStyle') || undefined);
  } catch {
    return undefined;
  }
}

function configuredVoiceStyle(request: IncomingMessage): string | undefined {
  const explicitStyle = requestedVoiceStyle(request) || normalizedVoiceStyle(process.env.VOICE_STYLE || process.env.VOICELIVE_VOICE_STYLE);
  if (explicitStyle) return explicitStyle;
  return configuredVoiceName().includes(':MAI-Voice-1') ? 'neutral' : undefined;
}

async function getAccessToken(): Promise<string> {
  const credential = new DefaultAzureCredential();
  const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
  return tokenResponse.token;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function previewForBrowser(value: unknown, maxLength = 260): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  return String(serialized ?? '').replace(/\s+/g, ' ').slice(0, maxLength);
}

function voiceErrorText(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecoverableVoiceCapacityError(value: unknown): boolean {
  return /resource exhausted|avatar_service_resource_exhausted|quota|capacity|throttl|rate limit|too many requests|temporarily unavailable|429/i.test(voiceErrorText(value));
}

function avatarCapacityFallbackMessage(): string {
  return 'Avatar capacity is temporarily exhausted. Morgan is switching to visual demo mode; Mission Control, text prompts, Teams calling, and finance proof workflows remain available.';
}

function sendBrowserEvent(clientWs: WebSocket, event: Record<string, unknown>): void {
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify(event));
  }
}

function voiceLiveHandshakeMessage(statusCode: number | undefined, body?: string): string {
  if (statusCode === 429 || isRecoverableVoiceCapacityError(body)) {
    return avatarCapacityFallbackMessage();
  }
  if (statusCode === 401) {
    return 'Voice Live rejected the App Service managed identity. Grant Azure AI User and Cognitive Services User on the Voice Live resource, then retry after Azure RBAC propagation.';
  }
  return `Voice Live rejected the WebSocket handshake${statusCode ? ` with HTTP ${statusCode}` : ''}.`;
}

export function attachVoiceWebSocket(server: Server): void {
  if (!VOICELIVE_ENDPOINT) {
    console.log('[voice] VOICELIVE_ENDPOINT not set — voice proxy disabled');
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    if (pathname !== '/api/voice') {
      // Not our route — leave the socket alone so other listeners (e.g. the
      // ACS media bridge on /api/calls/acs-media) can handle the upgrade.
      return;
    }
    // Check voice gate before accepting connection
    if (!isVoiceEnabled()) {
      console.log('[voice] Connection rejected — voice gate is disabled');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    if (browserAuthRequired() && !getPrincipalFromHeaders(request.headers)?.oid) {
      console.log('[voice] Connection rejected — browser user is not signed in');
      socket.write(`HTTP/1.1 401 Unauthorized\r\nLocation: ${loginUrlFor('/voice')}\r\n\r\n`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', async (clientWs, request) => {
    console.log('[voice] Browser client connected');
    const sessionCorrelationId = `voice-${Date.now()}`;
    const requestUrl = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    const sessionVoiceName = configuredVoiceName();
    const sessionVoiceStyle = configuredVoiceStyle(request);
    // Skip Azure Voice Live's own avatar config when the browser opts out
    // (avatar=false) or when the D-ID page drives the avatar (source=did /
    // noAvatar=1). In those cases we only need text/audio transcripts from
    // Voice Live; the page renders the avatar itself.
    const skipAvatar =
      requestUrl.searchParams.get('avatar') === 'false' ||
      requestUrl.searchParams.get('source') === 'did' ||
      requestUrl.searchParams.get('noAvatar') === '1';

    if (
      activeVoiceClient &&
      (activeVoiceClient.readyState === WebSocket.CONNECTING || activeVoiceClient.readyState === WebSocket.OPEN)
    ) {
      console.log('[voice] Closing previous browser client before starting a new avatar session');
      sendBrowserEvent(activeVoiceClient, {
        type: 'error',
        error: {
          message: 'A newer Morgan avatar session was started. This tab was disconnected to keep avatar capacity available.',
        },
      });
      activeVoiceClient.close(1000, 'New Morgan avatar session started');
    }
    activeVoiceClient = clientWs;

    recordAgentEvent({
      kind: 'voice.session',
      label: 'Morgan avatar voice session opened',
      status: 'started',
      correlationId: sessionCorrelationId,
      data: {
        source: 'Azure Voice Live avatar',
        reasoningSummary: 'Morgan is listening through the avatar voice channel and preparing a realtime spoken response loop.',
      },
    });

    let serviceWs: WebSocket | null = null;
    // Track pending function calls for tool execution
    const pendingCalls = new Map<string, string>();

    try {
      const token = await getAccessToken();
      const wsUrl = buildVoiceLiveUrl();

      serviceWs = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      serviceWs.on('unexpected-response', (_request, response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk.toString();
          if (body.length > 1600) body = body.slice(0, 1600);
        });
        response.on('end', () => {
          const detail = {
            statusCode: response.statusCode,
            statusMessage: response.statusMessage,
            endpointHost: new URL(wsUrl).host,
            model: VOICELIVE_MODEL,
            body: previewForBrowser(body, 700),
          };
          console.error('[voice] Voice Live WebSocket unexpected response', detail);
          const message = voiceLiveHandshakeMessage(response.statusCode, body);
          const recoverable = isRecoverableVoiceCapacityError(message) || isRecoverableVoiceCapacityError(detail);
          sendBrowserEvent(clientWs, {
            type: 'error',
            error: {
              message,
              recoverable,
              detail,
            },
          });
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.close(recoverable ? 1013 : 1011, recoverable ? 'avatar_service_resource_exhausted' : 'Voice Live rejected connection');
          }
        });
      });

      serviceWs.on('open', () => {
        console.log('[voice] Connected to Voice Live service');
        recordAgentEvent({
          kind: 'voice.session',
          label: 'Morgan connected to Voice Live',
          status: 'ok',
          correlationId: sessionCorrelationId,
          data: {
            source: 'Azure Voice Live avatar',
            voice: sessionVoiceName,
            voiceStyle: sessionVoiceStyle || 'default',
            reasoningSummary: 'Voice Live session configured with Morgan persona, avatar settings, speech transcription, VAD, and callable tools.',
          },
        });

        const voiceConfig: Record<string, unknown> = {
          name: sessionVoiceName,
          type: 'azure-standard',
          temperature: 0.8,
        };
        if (sessionVoiceStyle) voiceConfig.style = sessionVoiceStyle;

        // Configure session with Morgan's persona, tools, and HD voice
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: MORGAN_SYSTEM_PROMPT + '\n\nYou are speaking via voice. Keep responses concise and conversational — no markdown, no tables, no emoji. Speak numbers clearly. When citing financial figures, round to the nearest thousand or million for clarity.',
            voice: voiceConfig,
            ...(skipAvatar ? {} : { avatar: {
              character: process.env.AVATAR_CHARACTER || 'meg',
              style: process.env.AVATAR_STYLE || 'business',
              customized: false,
              video: {
                bitrate: Number(process.env.AVATAR_VIDEO_BITRATE || 1_200_000),
                codec: process.env.AVATAR_VIDEO_CODEC || 'h264',
                background: process.env.AVATAR_BACKGROUND_URL
                  ? { image_url: process.env.AVATAR_BACKGROUND_URL }
                  : { color: process.env.AVATAR_BACKGROUND_COLOR || '#FFFFFF' },
              },
            } }),
            input_audio_sampling_rate: 24000,
            input_audio_transcription: {
              model: 'azure-speech',
              language: 'en',
            },
            turn_detection: {
              type: 'azure_semantic_vad',
              silence_duration_ms: 500,
              interrupt_response: true,
              auto_truncate: true,
            },
            input_audio_noise_reduction: { type: 'azure_deep_noise_suppression' },
            input_audio_echo_cancellation: { type: 'server_echo_cancellation' },
            tools: VOICE_TOOLS,
            tool_choice: 'auto',
          },
        };
        serviceWs!.send(JSON.stringify(sessionUpdate));
      });

      // Relay events from Voice Live to browser
      serviceWs.on('message', async (data) => {
        const msg = data.toString();
        let event: { type?: string; [key: string]: unknown };
        try {
          event = JSON.parse(msg);
        } catch {
          return;
        }

        if (event.type === 'error') {
          const errorPayload = (event.error || event) as unknown;
          const message = isRecoverableVoiceCapacityError(errorPayload)
            ? avatarCapacityFallbackMessage()
            : (typeof (event.error as { message?: unknown } | undefined)?.message === 'string'
                ? String((event.error as { message: string }).message)
                : 'Voice Live returned an error.');
          sendBrowserEvent(clientWs, {
            type: 'error',
            error: {
              message,
              recoverable: isRecoverableVoiceCapacityError(errorPayload),
              detail: errorPayload,
            },
          });
          if (isRecoverableVoiceCapacityError(errorPayload)) {
            console.warn('[voice] Voice Live capacity fallback activated:', previewForBrowser(errorPayload, 700));
            if (serviceWs && serviceWs.readyState === WebSocket.OPEN) serviceWs.close(1000, 'visual demo fallback');
            if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1013, 'avatar_service_resource_exhausted');
            return;
          }
        }

        if (event.type === 'conversation.item.input_audio_transcription.completed') {
          const transcript = String(event.transcript || '').trim();
          if (transcript) {
            recordAgentEvent({
              kind: 'agent.message',
              label: `Voice prompt: ${transcript.slice(0, 90)}`,
              correlationId: sessionCorrelationId,
              data: {
                channelId: 'voice-live-avatar',
                promptPreview: transcript.slice(0, 700),
                reasoningSummary: 'Morgan heard a spoken prompt through the avatar channel and is deciding whether to answer directly or call a voice tool.',
              },
            });
          }
        } else if (event.type === 'response.audio_transcript.done' || event.type === 'response.output_text.done') {
          const transcript = String(event.transcript || event.text || '').trim();
          if (transcript) {
            recordAgentEvent({
              kind: 'agent.reply',
              label: `Voice response: ${transcript.slice(0, 90)}`,
              status: 'ok',
              correlationId: sessionCorrelationId,
              data: {
                responsePreview: transcript.slice(0, 700),
                reasoningSummary: 'Morgan completed a spoken response for the avatar channel.',
              },
            });
          }
        } else if (event.type === 'input_audio_buffer.speech_started') {
          recordAgentEvent({
            kind: 'voice.session',
            label: 'Morgan detected live speech on the avatar channel',
            status: 'started',
            correlationId: sessionCorrelationId,
            data: {
              source: 'Azure Voice Live avatar',
              reasoningSummary: 'Voice activity detection started; Morgan is receiving realtime caller audio.',
            },
          });
        }

        // Handle function calls server-side — don't forward raw tool events to browser
        if (event.type === 'response.function_call_arguments.done') {
          const callId = event.call_id as string;
          const fnName = event.name as string;
          const fnArgs = event.arguments as string;
          const parsedArgs = parseJsonObject(fnArgs);
          console.log(`[voice] Function call: ${fnName}(${fnArgs})`);

          sendBrowserEvent(clientWs, {
            type: 'morgan.tool.started',
            callId,
            name: fnName,
            argumentsPreview: previewForBrowser(parsedArgs),
          });
          recordAgentEvent({
            kind: 'tool.call',
            label: `Avatar tool: ${fnName}`,
            status: 'started',
            correlationId: callId,
            data: {
              source: 'Azure Voice Live avatar',
              tool: fnName,
              parameterKeys: Object.keys(parsedArgs),
              reasoningSummary: `Morgan selected voice tool ${fnName} to answer the current spoken request.`,
            },
          });

          try {
            const started = Date.now();
            const result = await executeVoiceTool(fnName, parsedArgs);
            sendBrowserEvent(clientWs, {
              type: 'morgan.tool.completed',
              callId,
              name: fnName,
              resultPreview: previewForBrowser(result),
            });
            recordAgentEvent({
              kind: 'tool.result',
              label: `Avatar tool completed: ${fnName}`,
              status: 'ok',
              durationMs: Date.now() - started,
              correlationId: callId,
              data: {
                source: 'Azure Voice Live avatar',
                tool: fnName,
                resultBytes: Buffer.byteLength(JSON.stringify(result), 'utf8'),
                responsePreview: previewForBrowser(result),
                reasoningSummary: `Morgan received the ${fnName} result and is folding it into the spoken response.`,
              },
            });

            // Send function output back to Voice Live
            const output = {
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(result),
              },
            };
            if (serviceWs && serviceWs.readyState === WebSocket.OPEN) {
              serviceWs.send(JSON.stringify(output));
              // Trigger response generation after tool result
              serviceWs.send(JSON.stringify({ type: 'response.create' }));
            }
          } catch (err) {
            console.error(`[voice] Tool error (${fnName}):`, err);
            sendBrowserEvent(clientWs, {
              type: 'morgan.tool.failed',
              callId,
              name: fnName,
              error: previewForBrowser(String(err), 180),
            });
            recordAgentEvent({
              kind: 'tool.result',
              label: `Avatar tool failed: ${fnName}`,
              status: 'error',
              correlationId: callId,
              data: { source: 'Azure Voice Live avatar', tool: fnName, error: String(err) },
            });
            if (serviceWs && serviceWs.readyState === WebSocket.OPEN) {
              serviceWs.send(JSON.stringify({
                type: 'conversation.item.create',
                item: {
                  type: 'function_call_output',
                  call_id: callId,
                  output: JSON.stringify({ error: String(err) }),
                },
              }));
              serviceWs.send(JSON.stringify({ type: 'response.create' }));
            }
          }
          return; // Don't forward function call events to browser
        }

        // Forward all other events to browser
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(msg);
        }
      });

      serviceWs.on('close', (code, reason) => {
        const reasonText = reason.toString();
        console.log(`[voice] Voice Live disconnected: ${code} ${reasonText}`);
        if (clientWs.readyState === WebSocket.OPEN) {
          if (code !== 1000 || reasonText) {
            sendBrowserEvent(clientWs, {
              type: 'error',
              error: {
                message: reasonText || `Voice Live session ended with code ${code}`,
              },
            });
          }
          clientWs.close(1000, 'Voice Live session ended');
        }
      });

      serviceWs.on('error', (err) => {
        console.error('[voice] Voice Live WebSocket error:', err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          sendBrowserEvent(clientWs, {
            type: 'error',
            error: { message: err.message || 'Voice Live error' },
          });
          clientWs.close(1011, 'Voice Live error');
        }
      });

      // Relay audio from browser to Voice Live
      clientWs.on('message', (data, isBinary) => {
        if (!serviceWs || serviceWs.readyState !== WebSocket.OPEN) return;

        // Browser sends either JSON events or raw audio
        if (!isBinary) {
          // JSON event from browser (e.g. response.cancel for barge-in)
          serviceWs.send(data.toString());
        } else {
          // Binary PCM16 audio — wrap in input_audio_buffer.append event
          const base64Audio = Buffer.from(data as ArrayBuffer).toString('base64');
          serviceWs.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64Audio,
          }));
        }
      });

    } catch (err) {
      console.error('[voice] Failed to connect to Voice Live:', err);
      if (clientWs.readyState === WebSocket.OPEN) {
        const recoverable = isRecoverableVoiceCapacityError(err);
        sendBrowserEvent(clientWs, {
          type: 'error',
          error: {
            message: recoverable ? avatarCapacityFallbackMessage() : `Failed to connect to Voice Live: ${err instanceof Error ? err.message : String(err)}`,
            recoverable,
          },
        });
        clientWs.close(recoverable ? 1013 : 1011, recoverable ? 'avatar_service_resource_exhausted' : 'Failed to connect to Voice Live');
      }
    }

    clientWs.on('close', () => {
      console.log('[voice] Browser client disconnected');
      if (activeVoiceClient === clientWs) {
        activeVoiceClient = null;
      }
      recordAgentEvent({
        kind: 'voice.session',
        label: 'Morgan avatar voice session closed',
        status: 'ok',
        correlationId: sessionCorrelationId,
        data: { source: 'Azure Voice Live avatar' },
      });
      if (serviceWs && serviceWs.readyState === WebSocket.OPEN) {
        serviceWs.close();
      }
    });

    clientWs.on('error', (err) => {
      console.error('[voice] Browser WebSocket error:', err.message);
      if (serviceWs && serviceWs.readyState === WebSocket.OPEN) {
        serviceWs.close();
      }
    });
  });

  console.log('[voice] Voice Live WebSocket proxy ready at /api/voice');
}
