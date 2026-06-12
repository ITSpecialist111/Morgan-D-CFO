import { DefaultAzureCredential } from '@azure/identity';
import type express from 'express';
import { getAgenticKanbanLink } from '../mission/agenticKanban';

const credential = new DefaultAzureCredential();
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
];

function normalizedVoiceStyle(value: string | undefined): string {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  return VOICE_STYLES.includes(normalized) ? normalized : 'neutral';
}

type Middleware = express.RequestHandler;

export function registerAvatarRoutes(server: express.Express, authMiddleware?: Middleware): void {
  const middleware = authMiddleware ? [authMiddleware] : [];

  server.get('/api/avatar/config', ...middleware, (_req, res) => {
    res.status(200).json({
      character: process.env.AVATAR_CHARACTER || 'meg',
      style: process.env.AVATAR_STYLE || 'business',
      voice: process.env.VOICE_NAME || process.env.VOICELIVE_VOICE || DEFAULT_VOICE_NAME,
      voiceStyle: normalizedVoiceStyle(process.env.VOICE_STYLE || process.env.VOICELIVE_VOICE_STYLE),
      voiceStyles: VOICE_STYLES,
      backgroundImageUrl: process.env.AVATAR_BACKGROUND_URL || undefined,
      backgroundColor: process.env.AVATAR_BACKGROUND_COLOR || '#FFFFFF',
      agentName: process.env.AGENT_NAME || 'Morgan',
      role: process.env.AGENT_ROLE || 'Digital CFO',
      displayName: process.env.AVATAR_DISPLAY_NAME || 'Morgan',
      agenticKanban: getAgenticKanbanLink(),
      productionProof: {
        speechAvatarConfigUrl: '/api/avatar/config',
        speechAvatarIceUrl: '/api/avatar/ice',
        voiceWebSocketUrl: '/api/voice',
        avatarReadinessUrl: '/api/avatar/readiness',
        agenticKanbanUrl: '/agentic-kanban',
      },
    });
  });

  server.get('/api/avatar/readiness', ...middleware, (_req, res) => {
    const configured = (value: string | undefined): boolean => Boolean(value && !/<[^>]+>/.test(value) && !/your-|example|\.\.\.|optional-/i.test(value));
    const speechRegion = configured(process.env.SPEECH_REGION || process.env.AZURE_SPEECH_REGION);
    const speechAuth = configured(process.env.SPEECH_RESOURCE_KEY || process.env.AZURE_SPEECH_KEY)
      || configured(process.env.SPEECH_RESOURCE_ID || process.env.AZURE_SPEECH_RESOURCE_ID)
      || configured(process.env.AZURE_SPEECH_ENDPOINT || process.env.SPEECH_ENDPOINT || process.env.AZURE_AI_SERVICES_ENDPOINT || process.env.VOICELIVE_ENDPOINT);
    const voiceLive = configured(process.env.VOICELIVE_ENDPOINT) || configured(process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT);
    const acsTeams = configured(process.env.ACS_CONNECTION_STRING) && configured(process.env.ACS_SOURCE_USER_ID);
    res.status(200).json({
      ok: true,
      agentName: process.env.AGENT_NAME || 'Morgan',
      role: process.env.AGENT_ROLE || 'Digital CFO',
      speechAvatar: {
        configured: speechRegion && speechAuth,
        regionConfigured: speechRegion,
        authConfigured: speechAuth,
        relayTokenEndpoint: '/api/avatar/ice',
      },
      voiceLive: {
        configured: voiceLive,
        websocketEndpoint: '/api/voice',
      },
      teamsCalling: {
        configured: acsTeams,
        bridge: 'Azure Communication Services to Microsoft Teams federation',
      },
      proofPoints: [
        'Browser avatar uses Microsoft Speech Avatar relay tokens from /api/avatar/ice.',
        'Realtime voice connects through the production /api/voice WebSocket path.',
        'Teams escalation uses the ACS-to-Teams bridge when tenant settings are configured.',
      ],
      mockPolicy: 'Avatar and voice are production paths; visual standby mode is used only until Speech/Voice/ACS tenant settings are supplied.',
      timestamp: new Date().toISOString(),
    });
  });

  server.get('/api/avatar/ice', ...middleware, async (_req, res) => {
    const region = process.env.SPEECH_REGION || process.env.AZURE_SPEECH_REGION;
    if (!region) {
      res.status(503).json({ error: 'SPEECH_REGION or AZURE_SPEECH_REGION is required for avatar ICE relay tokens.' });
      return;
    }

    try {
      const headers: Record<string, string> = {};
      const speechKey = process.env.SPEECH_RESOURCE_KEY || process.env.AZURE_SPEECH_KEY;
      if (speechKey) {
        headers['Ocp-Apim-Subscription-Key'] = speechKey;
      } else {
        const entraToken = await credential.getToken('https://cognitiveservices.azure.com/.default');
        const speechResourceId = process.env.SPEECH_RESOURCE_ID || process.env.AZURE_SPEECH_RESOURCE_ID;
        const speechEndpoint = (
          process.env.AZURE_SPEECH_ENDPOINT ||
          process.env.SPEECH_ENDPOINT ||
          process.env.AZURE_AI_SERVICES_ENDPOINT ||
          process.env.VOICELIVE_ENDPOINT ||
          ''
        ).replace(/\/$/, '');

        if (speechResourceId) {
          headers.Authorization = `Bearer aad#${speechResourceId}#${entraToken.token}`;
        } else if (speechEndpoint) {
          const stsResponse = await fetch(`${speechEndpoint}/sts/v1.0/issueToken`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${entraToken.token}` },
          });
          headers.Authorization = stsResponse.ok ? `Bearer ${await stsResponse.text()}` : `Bearer ${entraToken.token}`;
        } else {
          headers.Authorization = `Bearer ${entraToken.token}`;
        }
      }

      const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`, { headers });
      if (!response.ok) {
        res.status(response.status).json({ error: 'Failed to fetch avatar relay token', details: await response.text() });
        return;
      }
      res.status(200).json(await response.json());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
