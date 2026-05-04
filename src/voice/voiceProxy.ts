// Voice Live WebSocket proxy — bridges browser audio to Azure Voice Live service.
// Browser connects via WebSocket to /api/voice, this proxy forwards to Voice Live
// and relays events back. Morgan's persona and tools are configured server-side.

import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import { DefaultAzureCredential } from '@azure/identity';
import { MORGAN_SYSTEM_PROMPT } from '../persona';
import { VOICE_TOOLS, executeVoiceTool } from './voiceTools';
import { isVoiceEnabled } from './voiceGate';
import { browserAuthRequired, getPrincipalFromHeaders, loginUrlFor } from '../easyAuth';
import { recordAgentEvent } from '../observability/agentEvents';

const VOICELIVE_ENDPOINT = process.env.VOICELIVE_ENDPOINT || '';
const VOICELIVE_MODEL = process.env.VOICELIVE_MODEL || 'gpt-5';
let activeVoiceClient: WebSocket | null = null;

// Azure Voice Live WebSocket URL format
function buildVoiceLiveUrl(): string {
  // Endpoint: https://ai-morgan-voicelive.cognitiveservices.azure.com/
  // Voice Live path: /voice-live/realtime (NOT /openai/realtime)
  const url = new URL(VOICELIVE_ENDPOINT);
  const wsUrl = `wss://${url.host}/voice-live/realtime?api-version=2025-10-01&model=${VOICELIVE_MODEL}`;
  return wsUrl;
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

function sendBrowserEvent(clientWs: WebSocket, event: Record<string, unknown>): void {
  if (clientWs.readyState === WebSocket.OPEN) {
    clientWs.send(JSON.stringify(event));
  }
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

  wss.on('connection', async (clientWs) => {
    console.log('[voice] Browser client connected');
    const sessionCorrelationId = `voice-${Date.now()}`;

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

      serviceWs.on('open', () => {
        console.log('[voice] Connected to Voice Live service');
        recordAgentEvent({
          kind: 'voice.session',
          label: 'Morgan connected to Voice Live',
          status: 'ok',
          correlationId: sessionCorrelationId,
          data: {
            source: 'Azure Voice Live avatar',
            voice: process.env.VOICE_NAME || process.env.VOICELIVE_VOICE || 'en-US-Ava:DragonHDLatestNeural',
            reasoningSummary: 'Voice Live session configured with Morgan persona, avatar settings, speech transcription, VAD, and callable tools.',
          },
        });

        // Configure session with Morgan's persona, tools, and HD voice
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: MORGAN_SYSTEM_PROMPT + '\n\nYou are speaking via voice. Keep responses concise and conversational — no markdown, no tables, no emoji. Speak numbers clearly. When citing financial figures, round to the nearest thousand or million for clarity.',
            voice: {
              name: process.env.VOICE_NAME || process.env.VOICELIVE_VOICE || 'en-US-Ava:DragonHDLatestNeural',
              type: 'azure-standard',
              temperature: 0.8,
            },
            avatar: {
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
            },
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
        clientWs.close(1011, 'Failed to connect to Voice Live');
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
