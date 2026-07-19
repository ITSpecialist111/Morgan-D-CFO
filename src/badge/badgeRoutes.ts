import type express from 'express';
import { z } from 'zod';
import { getAutonomousKanbanBoard } from '../mission/missionControl';
import { recordAgentEvent } from '../observability/agentEvents';
import { isVoiceEnabled } from '../voice/voiceGate';
import { requireBadgeAuth } from './badgeAuth';

const BADGE_PROTOCOL_VERSION = 1;
const badgeRateWindows = new Map<string, { startedAt: number; count: number }>();

const badgeTelemetrySchema = z.object({
  deviceId: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/),
  firmwareVersion: z.string().trim().min(1).max(32),
  state: z.enum(['BOOT', 'STANDBY', 'LISTENING', 'THINKING', 'SPEAKING', 'FAULT']),
  batteryVolts: z.number().finite().min(0).max(6).nullable().optional(),
  batteryPresence: z.enum(['present', 'absent', 'unverified']).optional(),
  rssiDbm: z.number().int().min(-127).max(0).optional(),
  freeHeapBytes: z.number().int().nonnegative().optional(),
  psramBytes: z.number().int().nonnegative().optional(),
  peripherals: z.object({
    display: z.enum(['ready', 'configured-no-readback', 'failed']),
    microphone: z.enum(['ready', 'unverified', 'failed']),
    amplifier: z.enum(['ready', 'unverified', 'failed']),
  }).strict().optional(),
}).strict();

function badgeRateLimit(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const deviceId = String(req.header('X-Morgan-Badge-Id') || req.ip || 'unknown').slice(0, 64);
  const now = Date.now();
  const current = badgeRateWindows.get(deviceId);
  const window = !current || now - current.startedAt >= 60_000
    ? { startedAt: now, count: 0 }
    : current;
  window.count += 1;
  badgeRateWindows.set(deviceId, window);
  if (window.count > 120) {
    res.setHeader('Retry-After', '60');
    res.status(429).json({ error: 'Badge request rate exceeded.' });
    return;
  }
  next();
}

export function getBadgeStatusPayload(): Record<string, unknown> {
  const board = getAutonomousKanbanBoard();
  return {
    protocolVersion: BADGE_PROTOCOL_VERSION,
    identity: {
      name: 'Morgan',
      role: 'Digital CFO',
      operatingChassis: 'CorpGen v2.6',
    },
    presentation: {
      defaultState: 'STANDBY',
      statusText: board.nextBestAction,
      avatarMode: 'device-cached-portrait',
    },
    work: {
      nextBestAction: board.nextBestAction,
      metrics: board.metrics,
      evidenceGrade: 'authenticated-live-snapshot',
    },
    voice: {
      configured: isVoiceEnabled(),
      websocketPath: '/api/badge/voice',
      inputFormat: 'pcm_s16le_mono',
      inputSampleRateHz: 24000,
      outputFormat: 'pcm_s16le_mono',
      outputSampleRateHz: 24000,
      toolsEnabled: false,
    },
    nextPollSeconds: 15,
    serverTime: new Date().toISOString(),
  };
}

export function registerBadgeRoutes(server: express.Express): void {
  server.use('/api/badge', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  server.get('/api/badge/status', requireBadgeAuth, badgeRateLimit, (_req, res) => {
    res.status(200).json(getBadgeStatusPayload());
  });

  server.post('/api/badge/telemetry', requireBadgeAuth, badgeRateLimit, (req, res) => {
    const parsed = badgeTelemetrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid badge telemetry.',
        fields: parsed.error.issues.map((issue) => issue.path.join('.')).filter(Boolean),
      });
      return;
    }

    const telemetry = parsed.data;
    recordAgentEvent({
      kind: 'badge.telemetry',
      label: `Morgan badge ${telemetry.state.toLowerCase()}`,
      status: telemetry.state === 'FAULT' ? 'error' : 'ok',
      correlationId: `badge-${telemetry.deviceId}`,
      data: telemetry,
    });

    res.status(202).json({
      accepted: true,
      protocolVersion: BADGE_PROTOCOL_VERSION,
      nextPollSeconds: 15,
      serverTime: new Date().toISOString(),
    });
  });

  server.get('/api/badge/voice', requireBadgeAuth, (_req, res) => {
    res.status(426).json({
      error: 'Badge voice requires a WebSocket upgrade.',
      websocketPath: '/api/badge/voice',
    });
  });
}
