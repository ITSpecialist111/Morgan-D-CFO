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
import { agentApplication, credential, runAutonomousBriefing, runEndOfDayReport } from './agent';
import { setAdapter } from './scheduler/proactiveMonitor';
import { getAutonomousWorkdaySchedulerStatus, startAutonomousWorkdayScheduler } from './scheduler/autonomousWorkdayScheduler';
import { getAgentStorageStatus } from './storage/agentStorage';
import { attachVoiceWebSocket } from './voice/voiceProxy';
import { isVoiceEnabled } from './voice/voiceGate';
import { registerAvatarRoutes } from './voice/avatarRoutes';
import {
  attachAcsMediaWebSocket,
  getActiveCallSnapshot,
  getTeamsFederationCallingStatus,
  handleAcsEvent,
  handleIncomingCallEvent,
  initiateOutboundTeamsCall,
  isAcsConfigured,
} from './voice/acsBridge';
import { getEndOfDayReport, getMissionControlSnapshot, runAutonomousCfoWorkday } from './mission/missionControl';
import { getMissionMindmap } from './mission/mindmap';
import { getMorganCostDashboard } from './mission/costModel';
import { registerFoundryResponsesRoutes } from './foundry/responsesAdapter';
import {
  flushObservability,
  getObservabilityStatus,
  getRecentAuditEvents,
  initObservability,
  recordAuditEvent,
} from './observability/agentAudit';
import { getAgentEventStats, getRecentAgentEvents, type AgentEventKind } from './observability/agentEvents';
import { getRequestPrincipal, requireEasyAuth, type EasyAuthPrincipal } from './easyAuth';
import { registerMicrosoftWebAuthRoutes } from './microsoftWebAuth';
import { getSubAgentRegistry } from './orchestrator/subAgents';

// Only NODE_ENV=development disables authentication
const isDevelopment = process.env.NODE_ENV === 'development';
const authConfig: AuthConfiguration = isDevelopment ? {} : loadAuthConfigFromEnv();

console.log(`Environment: NODE_ENV=${process.env.NODE_ENV}, isDevelopment=${isDevelopment}`);

const server = express();

server.use(express.json());
void initObservability();

function verifyScheduledSecret(provided: unknown): boolean {
  return typeof provided === 'string' && Boolean(process.env.SCHEDULED_SECRET) && provided === process.env.SCHEDULED_SECRET;
}

function scheduledSecretFromRequest(req: express.Request): string | undefined {
  const direct = req.headers['x-scheduled-secret'];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct) && typeof direct[0] === 'string') return direct[0];

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) return match[1];
  }

  if (typeof req.body?.secret === 'string') return req.body.secret;
  if (typeof req.query?.secret === 'string') return req.query.secret;
  return undefined;
}

function runtimeReadiness(): Record<string, unknown> {
  const subAgents = getSubAgentRegistry();
  const agentStorage = getAgentStorageStatus();
  const hasConfiguredValue = (value: string | undefined): boolean => Boolean(value && !/<[^>]+>/.test(value) && !/your-|example|\.\.\.|optional-/i.test(value));
  return {
    azureOpenAI: hasConfiguredValue(process.env.AZURE_OPENAI_ENDPOINT) && hasConfiguredValue(process.env.AZURE_OPENAI_DEPLOYMENT),
    voiceLive: hasConfiguredValue(process.env.VOICELIVE_ENDPOINT) || hasConfiguredValue(process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT),
    speechAvatar: hasConfiguredValue(process.env.SPEECH_REGION) && (hasConfiguredValue(process.env.SPEECH_RESOURCE_ID) || hasConfiguredValue(process.env.SPEECH_RESOURCE_KEY)),
    scheduledSecret: Boolean(process.env.SCHEDULED_SECRET),
    mcpPlatform: hasConfiguredValue(process.env.MCP_PLATFORM_ENDPOINT),
    foundryProject: hasConfiguredValue(process.env.FOUNDRY_PROJECT_ENDPOINT),
    fabricOrPowerBI: hasConfiguredValue(process.env.FABRIC_WORKSPACE_ID) || hasConfiguredValue(process.env.FABRIC_SEMANTIC_MODEL_ID) || hasConfiguredValue(process.env.POWERBI_SEMANTIC_MODEL_ID),
    applicationInsights: hasConfiguredValue(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) || hasConfiguredValue(process.env.APPLICATIONINSIGHTS_RESOURCE_ID),
    durableMemory: agentStorage.configured,
    agentStorage,
    autonomousScheduler: getAutonomousWorkdaySchedulerStatus(),
    subAgents: subAgents.map((agent) => ({ id: agent.id, status: agent.status, endpointConfigured: Boolean(agent.endpoint) })),
  };
}

function safeLocalRedirectPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/mission-control';
  return value;
}

// Health endpoint (no auth required) — also exposes voice gate status
server.get('/', (_req, res: Response) => {
  res.redirect(302, '/mission-control');
});

server.get('/api/health', (_req, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    agent: 'Morgan',
    voiceEnabled: isVoiceEnabled(),
    avatarEnabled: true,
    configuration: runtimeReadiness(),
    acsCallingConfigured: isAcsConfigured(),
    teamsFederationCalling: getTeamsFederationCallingStatus(),
    missionControl: '/mission-control',
    timestamp: new Date().toISOString(),
  });
});

registerMicrosoftWebAuthRoutes(server);

server.all('/.auth/login/aad/callback', (req: express.Request, res: Response) => {
  res.redirect(302, safeLocalRedirectPath(req.query.post_login_redirect_uri || req.query.redir));
});

server.get('/.auth/me', (req: express.Request, res: Response) => {
  const principal = getRequestPrincipal(req);
  if (!principal?.oid) {
    res.status(401).json([]);
    return;
  }
  res.status(200).json([
    {
      provider_name: 'aad',
      user_id: principal.oid,
      user_claims: principal.claims,
    },
  ]);
});

server.get('/api/web-auth/me', requireEasyAuth, (req: express.Request, res: Response) => {
  const principal = (req as express.Request & { easyAuthPrincipal?: { oid?: string; email?: string; name?: string; tenantId?: string } }).easyAuthPrincipal;
  res.status(200).json({ ok: true, principal });
});

registerFoundryResponsesRoutes(server);

// Serve the avatar-led voice experience at /voice and /avatar.
server.get('/voice', (_req, res: Response) => {
  res.sendFile(path.join(__dirname, 'voice', 'voice.html'));
});
server.get('/avatar', (_req, res: Response) => {
  res.sendFile(path.join(__dirname, 'voice', 'voice.html'));
});

// Static avatar assets (background photos, etc.) bundled by scripts/copy-static.cjs.
// fallthrough: false so missing files return a clean 404 instead of dropping into the
// downstream JWT auth gate (which would otherwise turn /voice/assets/foo.jpg into 401).
server.use(
  '/voice/assets',
  express.static(path.join(__dirname, 'voice', 'assets'), {
    maxAge: '1h',
    fallthrough: false,
  }),
);

registerAvatarRoutes(server, requireEasyAuth);

server.get('/api/voice', requireEasyAuth, (_req, res: Response) => {
  res.status(426).json({
    error: 'Voice Live uses a WebSocket connection. Open /voice in the browser or connect with wss://<host>/api/voice.',
  });
});

server.get('/favicon.ico', (_req, res: Response) => {
  res.status(204).end();
});

server.use(['/api/mission-control', '/api/observability', '/api/audit/events'], (_req, res: Response, next: express.NextFunction) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Mission Control dashboard and JSON APIs.
server.get('/mission-control', (_req, res: Response) => {
  res.sendFile(path.join(__dirname, 'mission', 'mission-control.html'));
});
server.get('/mission-control/mockup', (_req, res: Response) => {
  res.sendFile(path.join(__dirname, 'mission', 'mission-control-mockup.html'));
});
server.get('/mission-control/costs', (_req, res: Response) => {
  res.sendFile(path.join(__dirname, 'mission', 'cost-dashboard.html'));
});
server.get('/api/mission-control', requireEasyAuth, (_req, res: Response) => {
  res.status(200).json(getMissionControlSnapshot());
});
server.get('/api/mission-control/costs', requireEasyAuth, async (_req, res: Response) => {
  res.status(200).json(await getMorganCostDashboard());
});
server.get('/api/mission-control/end-of-day', requireEasyAuth, (_req, res: Response) => {
  res.status(200).json(getEndOfDayReport());
});
server.get('/api/mission-control/mindmap', requireEasyAuth, (_req, res: Response) => {
  res.status(200).json(getMissionMindmap());
});
server.get('/api/mission-control/events', requireEasyAuth, (req: express.Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query?.limit) || 200, 1), 500);
  const sinceId = typeof req.query?.sinceId === 'string' ? req.query.sinceId : undefined;
  const kinds = typeof req.query?.kinds === 'string'
    ? req.query.kinds.split(',').map((kind) => kind.trim()).filter(Boolean) as AgentEventKind[]
    : undefined;
  res.status(200).json({
    events: getRecentAgentEvents({ limit, sinceId, kinds }),
    stats: getAgentEventStats(),
    timestamp: new Date().toISOString(),
  });
});
type EasyAuthRequest = express.Request & { easyAuthPrincipal?: EasyAuthPrincipal };

server.post('/api/mission-control/run-workday', (req: express.Request, res: Response) => {
  const secret = scheduledSecretFromRequest(req);
  const secretAuthorized = verifyScheduledSecret(secret);
  const trigger = typeof req.body?.trigger === 'string' ? req.body.trigger : '';
  const forceDigestDelivery = req.body?.deliverDigest === true
    || req.body?.forceDigestDelivery === true
    || /dragon|proof|digest|mission-control-dashboard/i.test(trigger);

  const runWorkdayForCaller = async (
    source: 'scheduled_job' | 'user_request',
    triggeredBy: { kind: 'scheduled_secret' | 'mission_control'; oid?: string; email?: string; name?: string },
  ): Promise<void> => {
    try {
      recordAuditEvent({
        kind: 'mission.workday.triggered',
        label: triggeredBy.kind === 'mission_control' ? 'CorpGen workday force-started from Mission Control' : 'CorpGen workday started by scheduled secret',
        actor: triggeredBy.name || triggeredBy.email || triggeredBy.kind,
        data: { source, triggeredBy, forceDigestDelivery },
      });
      const result = await runAutonomousCfoWorkday({ source, forceDigestDelivery });
      res.status(200).json({ ok: true, result, triggeredBy, timestamp: new Date().toISOString() });
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err), timestamp: new Date().toISOString() });
    }
  };

  if (secretAuthorized) {
    void runWorkdayForCaller('scheduled_job', { kind: 'scheduled_secret' });
    return;
  }

  requireEasyAuth(req as EasyAuthRequest, res, () => {
    const principal = (req as EasyAuthRequest).easyAuthPrincipal;
    void runWorkdayForCaller('user_request', {
      kind: 'mission_control',
      oid: principal?.oid,
      email: principal?.email,
      name: principal?.name,
    });
  });
});

server.get('/api/mission-control/teams-call/status', requireEasyAuth, (_req: express.Request, res: Response) => {
  res.status(200).json({
    ok: true,
    status: getTeamsFederationCallingStatus(),
    activeCalls: getActiveCallSnapshot(),
    defaults: {
      targetConfigured: Boolean(process.env.CFO_TEAMS_USER_AAD_OID),
      targetDisplayName: process.env.CFO_DISPLAY_NAME || process.env.CFO_EMAIL || 'CFO/operator',
      voice: process.env.ACS_REALTIME_VOICE || 'verse',
    },
    videoPresence: getTeamsFederationCallingStatus().videoPresence,
    timestamp: new Date().toISOString(),
  });
});

server.post('/api/mission-control/teams-call', requireEasyAuth, async (req: express.Request, res: Response) => {
  const principal = (req as express.Request & { easyAuthPrincipal?: { oid?: string; email?: string; name?: string } }).easyAuthPrincipal;
  const requestedBy = principal?.name || principal?.email || principal?.oid || 'Mission Control operator';
  const targetFromBody = typeof req.body?.teamsUserAadOid === 'string' ? req.body.teamsUserAadOid.trim() : '';
  const teamsUserAadOid = targetFromBody || process.env.CFO_TEAMS_USER_AAD_OID || '';
  const targetDisplayName = typeof req.body?.targetDisplayName === 'string' && req.body.targetDisplayName.trim()
    ? req.body.targetDisplayName.trim()
    : process.env.CFO_DISPLAY_NAME || process.env.CFO_EMAIL || 'CFO/operator';
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
    ? req.body.reason.trim()
    : 'Mission Control operator requested a Morgan Teams call.';
  const voice = typeof req.body?.voice === 'string' && req.body.voice.trim()
    ? req.body.voice.trim()
    : process.env.ACS_REALTIME_VOICE || 'verse';
  const instructions = typeof req.body?.instructions === 'string' && req.body.instructions.trim()
    ? req.body.instructions.trim()
    : `You are Morgan, the Digital CFO. This Teams call was triggered from Mission Control by ${requestedBy}. Reason: ${reason}. Greet ${targetDisplayName}, state the reason for the call, ask one focused finance question, and keep the exchange concise.`;

  if (!teamsUserAadOid) {
    res.status(400).json({
      ok: false,
      error: 'teamsUserAadOid is required unless CFO_TEAMS_USER_AAD_OID is configured.',
    });
    return;
  }

  const federationStatus = getTeamsFederationCallingStatus();
  if (!federationStatus.configured) {
    res.status(503).json({
      ok: false,
      error: 'Teams federation calling is not fully configured.',
      status: federationStatus,
    });
    return;
  }

  recordAuditEvent({
    kind: 'mission-control.teams-call.requested',
    label: 'Mission Control Teams call requested',
    actor: requestedBy,
    data: {
      targetDisplayName,
      targetProvidedByOperator: Boolean(targetFromBody),
      reason,
      voice,
    },
  });

  try {
    const call = await initiateOutboundTeamsCall({
      teamsUserAadOid,
      targetDisplayName,
      requestedBy,
      instructions,
      voice,
    });
    res.status(202).json({
      ok: true,
      mode: 'acs-teams-call',
      targetDisplayName,
      requestedBy,
      reason,
      ...call,
      activeCalls: getActiveCallSnapshot(),
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message, status: getTeamsFederationCallingStatus() });
  }
});

// Cassidy-style ACS Teams calling endpoints.
server.post('/api/voice/invite', async (req: express.Request, res: Response) => {
  const secret = scheduledSecretFromRequest(req);
  if (!verifyScheduledSecret(secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const teamsUserAadOid = req.body?.teamsUserAadOid || req.body?.targetUserId;
  if (typeof teamsUserAadOid !== 'string' || !teamsUserAadOid.trim()) {
    res.status(400).json({ error: 'teamsUserAadOid is required.' });
    return;
  }
  try {
    const call = await initiateOutboundTeamsCall({
      teamsUserAadOid,
      targetDisplayName: typeof req.body?.targetDisplayName === 'string' ? req.body.targetDisplayName : undefined,
      requestedBy: typeof req.body?.requestedBy === 'string' ? req.body.requestedBy : undefined,
      instructions: typeof req.body?.instructions === 'string' ? req.body.instructions : undefined,
      voice: typeof req.body?.voice === 'string' ? req.body.voice : undefined,
    });
    res.status(202).json({ ok: true, ...call });
  } catch (err: unknown) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

server.post('/api/calls/acs-events', (req: express.Request, res: Response) => {
  handleAcsEvent(req.body);
  res.status(200).json({ ok: true });
});

server.post('/api/calls/incoming', async (req: express.Request, res: Response) => {
  const result = await handleIncomingCallEvent(req.body);
  if ('validationResponse' in result) {
    res.status(200).json({ validationResponse: result.validationResponse });
    return;
  }
  res.status(202).json(result);
});

server.get('/api/calls/status', (req: express.Request, res: Response) => {
  const secret = scheduledSecretFromRequest(req);
  if (!verifyScheduledSecret(secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.status(200).json({ configured: isAcsConfigured(), activeCalls: getActiveCallSnapshot() });
});

server.get('/api/calls/federation/status', (req: express.Request, res: Response) => {
  const secret = scheduledSecretFromRequest(req);
  if (!verifyScheduledSecret(secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.status(200).json(getTeamsFederationCallingStatus());
});

server.get('/api/observability', (req: express.Request, res: Response) => {
  const secret = scheduledSecretFromRequest(req);
  if (!verifyScheduledSecret(secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.status(200).json(getObservabilityStatus());
});

server.get('/api/audit/events', (req: express.Request, res: Response) => {
  const secret = scheduledSecretFromRequest(req);
  if (!verifyScheduledSecret(secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const limit = Math.min(Number(req.query?.limit) || 100, 500);
  res.status(200).json({ events: getRecentAuditEvents(limit), status: getObservabilityStatus() });
});

// Scheduled briefing endpoint — protected by SCHEDULED_SECRET, not JWT
server.post('/api/scheduled', async (req: express.Request, res: Response) => {
  const secret = scheduledSecretFromRequest(req);
  if (!verifyScheduledSecret(secret)) {
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

server.post('/api/scheduled/end-of-day', async (req: express.Request, res: Response) => {
  const secret = scheduledSecretFromRequest(req);
  if (!verifyScheduledSecret(secret)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    console.log('End-of-day CFO report triggered via /api/scheduled/end-of-day');
    await runEndOfDayReport();
    res.status(200).json({ status: 'end_of_day_complete', timestamp: new Date().toISOString() });
  } catch (err: unknown) {
    console.error('End-of-day report error:', err);
    res.status(500).json({ error: 'End-of-day report failed', timestamp: new Date().toISOString() });
  }
});

// Apply JWT auth middleware for all routes below this point — skip public routes
server.use((req, res, next) => {
  const publicPaths = [
    '/api/health',
    '/api/voice/status',
    '/api/avatar/config',
    '/api/avatar/ice',
    '/api/mission-control',
    '/api/mission-control/costs',
    '/api/mission-control/end-of-day',
    '/api/mission-control/mindmap',
    '/api/mission-control/events',
    '/api/mission-control/teams-call/status',
    '/api/mission-control/teams-call',
    '/api/calls/acs-events',
    '/api/calls/incoming',
    '/voice',
    '/avatar',
    '/mission-control',
    '/mission-control/mockup',
    '/mission-control/costs',
    '/api/scheduled',
    '/api/scheduled/end-of-day',
    '/api/mission-control/run-workday',
    '/api/voice/invite',
    '/api/calls/status',
    '/api/calls/federation/status',
    '/api/observability',
    '/api/audit/events',
    '/responses',
    '/responses/health',
  ];
  if (req.path.startsWith('/.auth/') || publicPaths.some(p => req.path === p)) {
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
  console.log(`Avatar UI: http://${host}:${port}/voice`);
  console.log(`Mission Control: http://${host}:${port}/mission-control`);
  console.log(`Foundry Responses endpoint: http://${host}:${port}/responses`);

  // Wire the adapter into the proactive monitor so it can send messages outside of turns
  setAdapter(agentApplication.adapter as CloudAdapter);
  console.log('Proactive P&L monitor ready — users can say "start monitoring" to activate');

  // Attach Voice Live WebSocket proxy to the HTTP server
  attachVoiceWebSocket(httpServer);

  // Attach Cassidy-style ACS Teams calling bridge when configured
  attachAcsMediaWebSocket(httpServer);

  // Start Morgan's 09:00-17:00 autonomous CFO workday loop when configured.
  startAutonomousWorkdayScheduler();

  recordAuditEvent({
    kind: 'server.started',
    label: 'Morgan server started',
    data: { host, port, missionControl: '/mission-control', responses: '/responses' },
  });

  // Pre-warm managed identity token to avoid first-message IMDS cold-start delay (~60s)
  if (!isDevelopment) {
    credential.getToken('https://cognitiveservices.azure.com/.default')
      .then(() => console.log('Managed identity token pre-warmed successfully'))
      .catch((err: unknown) => console.warn('Token pre-warm failed (will retry on first message):', err));
  }
});
httpServer.on('error', (err: unknown) => {
  console.error(err);
  recordAuditEvent({
    kind: 'server.error',
    label: 'Morgan server error',
    severity: 'error',
    data: { error: err instanceof Error ? err.message : String(err) },
  });
  flushObservability();
  process.exit(1);
});

process.on('SIGTERM', () => flushObservability());
process.on('SIGINT', () => flushObservability());
