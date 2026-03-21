// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// IMPORTANT: Load environment variables FIRST before any other imports
import { configDotenv } from 'dotenv';
configDotenv();

import {
  AuthConfiguration,
  authorizeJWT,
  CloudAdapter,
  loadAuthConfigFromEnv,
  Request
} from '@microsoft/agents-hosting';
import express, { Response } from 'express';
import http from 'http';
import path from 'path';
import { agentApplication, credential, runAutonomousBriefing } from './agent';
import { setAdapter } from './scheduler/proactiveMonitor';
import { attachVoiceWebSocket } from './voice/voiceProxy';
import { isVoiceEnabled } from './voice/voiceGate';

// Only NODE_ENV=development disables authentication
const isDevelopment = process.env.NODE_ENV === 'development';
const authConfig: AuthConfiguration = isDevelopment ? {} : loadAuthConfigFromEnv();

console.log(`Environment: NODE_ENV=${process.env.NODE_ENV}, isDevelopment=${isDevelopment}`);

const server = express();

server.use(express.json());

// Health endpoint (no auth required) — also exposes voice gate status
server.get('/api/health', (_req, res: Response) => {
  res.status(200).json({ status: 'healthy', agent: 'Morgan', voiceEnabled: isVoiceEnabled(), timestamp: new Date().toISOString() });
});

// Serve voice.html at /voice (no auth required — public demo page)
server.get('/voice', (_req, res: Response) => {
  res.sendFile(path.join(__dirname, 'voice', 'voice.html'));
});

// Scheduled briefing endpoint — protected by SCHEDULED_SECRET, not JWT
server.post('/api/scheduled', async (req: express.Request, res: Response) => {
  const secret = req.headers['x-scheduled-secret'] || req.body?.secret;
  if (!secret || secret !== process.env.SCHEDULED_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    console.log('Scheduled briefing triggered via /api/scheduled');
    await runAutonomousBriefing();
    res.status(200).json({ status: 'briefing_complete', timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('Autonomous briefing error:', err);
    res.status(500).json({ error: 'Briefing failed', timestamp: new Date().toISOString() });
  }
});

// Apply JWT auth middleware for all routes below this point — skip public routes
server.use((req, res, next) => {
  const publicPaths = ['/api/health', '/api/voice/status', '/voice', '/api/scheduled'];
  if (publicPaths.some(p => req.path === p)) {
    return next();
  }
  return authorizeJWT(authConfig)(req, res, next);
});

// Main messages endpoint — uses CloudAdapter (correct pattern per Agent 365 SDK)
server.post('/api/messages', (req: Request, res: Response) => {
  const adapter = agentApplication.adapter as CloudAdapter;
  adapter.process(req, res, async (context) => {
    await agentApplication.run(context);
  });
});

// Agent-to-Agent (A2A) messages endpoint — same processing, separate logging
server.post('/api/agent-messages', (req: Request, res: Response) => {
  console.log('A2A message received from:', req.headers['x-agent-id'] || 'unknown-agent');
  const adapter = agentApplication.adapter as CloudAdapter;
  adapter.process(req, res, async (context) => {
    await agentApplication.run(context);
  });
});

const port = Number(process.env.PORT) || 3978;
const host = process.env.HOST ?? (isDevelopment ? 'localhost' : '0.0.0.0');

// Create raw HTTP server to intercept voice gate before Express/JWT middleware
const httpServer = http.createServer((req, res) => {
  // Voice gate status — bypasses all Express middleware including Agents SDK JWT
  if (req.method === 'GET' && (req.url === '/api/voice/status' || req.url?.startsWith('/api/voice/status?'))) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ enabled: isVoiceEnabled() }));
    return;
  }
  // Everything else goes through Express
  server(req, res);
});

httpServer.listen(port, host, () => {
  console.log(`\nMorgan (Digital Finance Analyst) listening on ${host}:${port}`);
  console.log(`Health check: http://${host}:${port}/api/health`);
  console.log(`Voice UI: http://${host}:${port}/voice`);

  // Wire the adapter into the proactive monitor so it can send messages outside of turns
  setAdapter(agentApplication.adapter as CloudAdapter);
  console.log('Proactive P&L monitor ready — users can say "start monitoring" to activate');

  // Attach Voice Live WebSocket proxy to the HTTP server
  attachVoiceWebSocket(httpServer);

  // Pre-warm managed identity token to avoid first-message IMDS cold-start delay (~60s)
  if (!isDevelopment) {
    credential.getToken('https://cognitiveservices.azure.com/.default')
      .then(() => console.log('Managed identity token pre-warmed successfully'))
      .catch((err: unknown) => console.warn('Token pre-warm failed (will retry on first message):', err));
  }
});
httpServer.on('error', (err: unknown) => {
  console.error(err);
  process.exit(1);
});
