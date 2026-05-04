import { DefaultAzureCredential } from '@azure/identity';
import type express from 'express';

const credential = new DefaultAzureCredential();

type Middleware = express.RequestHandler;

export function registerAvatarRoutes(server: express.Express, authMiddleware?: Middleware): void {
  const middleware = authMiddleware ? [authMiddleware] : [];

  server.get('/api/avatar/config', ...middleware, (_req, res) => {
    res.status(200).json({
      character: process.env.AVATAR_CHARACTER || 'meg',
      style: process.env.AVATAR_STYLE || 'business',
      voice: process.env.VOICE_NAME || process.env.VOICELIVE_VOICE || 'en-US-Ava:DragonHDLatestNeural',
      backgroundImageUrl: process.env.AVATAR_BACKGROUND_URL || undefined,
      backgroundColor: process.env.AVATAR_BACKGROUND_COLOR || '#FFFFFF',
      agentName: process.env.AGENT_NAME || 'Morgan',
      role: process.env.AGENT_ROLE || 'Digital CFO',
      displayName: process.env.AVATAR_DISPLAY_NAME || 'Aria as Morgan',
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
