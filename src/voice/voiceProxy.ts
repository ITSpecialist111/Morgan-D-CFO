// Voice Live WebSocket proxy — bridges browser audio to Azure Voice Live service.
// Browser connects via WebSocket to /api/voice, this proxy forwards to Voice Live
// and relays events back. Morgan's persona and tools are configured server-side.

import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';
import { DefaultAzureCredential } from '@azure/identity';
import { MORGAN_SYSTEM_PROMPT } from '../persona';
import { VOICE_TOOLS, executeVoiceTool } from './voiceTools';
import { isVoiceEnabled } from './voiceGate';

const VOICELIVE_ENDPOINT = process.env.VOICELIVE_ENDPOINT || '';
const VOICELIVE_MODEL = process.env.VOICELIVE_MODEL || 'gpt-5';

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

export function attachVoiceWebSocket(server: Server): void {
  if (!VOICELIVE_ENDPOINT) {
    console.log('[voice] VOICELIVE_ENDPOINT not set — voice proxy disabled');
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    if (pathname === '/api/voice') {
      // Check voice gate before accepting connection
      if (!isVoiceEnabled()) {
        console.log('[voice] Connection rejected — voice gate is disabled');
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // Not our route — let other handlers deal with it (or destroy)
      socket.destroy();
    }
  });

  wss.on('connection', async (clientWs) => {
    console.log('[voice] Browser client connected');

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

        // Configure session with Morgan's persona, tools, and HD voice
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: MORGAN_SYSTEM_PROMPT + '\n\nYou are speaking via voice. Keep responses concise and conversational — no markdown, no tables, no emoji. Speak numbers clearly. When citing financial figures, round to the nearest thousand or million for clarity.',
            voice: {
              name: 'en-US-Ava:DragonHDLatestNeural',
              type: 'azure-standard',
              temperature: 0.8,
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

        // Handle function calls server-side — don't forward raw tool events to browser
        if (event.type === 'response.function_call_arguments.done') {
          const callId = event.call_id as string;
          const fnName = event.name as string;
          const fnArgs = event.arguments as string;
          console.log(`[voice] Function call: ${fnName}(${fnArgs})`);

          try {
            const result = await executeVoiceTool(fnName, JSON.parse(fnArgs));

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
        console.log(`[voice] Voice Live disconnected: ${code} ${reason}`);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1000, 'Voice Live session ended');
        }
      });

      serviceWs.on('error', (err) => {
        console.error('[voice] Voice Live WebSocket error:', err.message);
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.close(1011, 'Voice Live error');
        }
      });

      // Relay audio from browser to Voice Live
      clientWs.on('message', (data) => {
        if (!serviceWs || serviceWs.readyState !== WebSocket.OPEN) return;

        // Browser sends either JSON events or raw audio
        if (typeof data === 'string') {
          // JSON event from browser (e.g. response.cancel for barge-in)
          serviceWs.send(data);
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
