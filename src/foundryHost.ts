import { configDotenv } from 'dotenv';
configDotenv();

import express, { Response } from 'express';
import http from 'http';
import { registerFoundryResponsesRoutes } from './foundry/responsesAdapter';
import { flushObservability, initObservability, recordAuditEvent } from './observability/agentAudit';

const server = express();

server.use(express.json({ limit: '1mb' }));
void initObservability();

server.get('/', (_req, res: Response) => {
  res.status(200).json({ status: 'healthy', agent: 'Morgan', protocol: 'responses', endpoint: '/responses' });
});

server.get('/api/health', (_req, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    agent: 'Morgan',
    protocol: 'responses/1.0.0',
    azureOpenAIConfigured: Boolean(process.env.AZURE_OPENAI_ENDPOINT),
    foundryProjectEndpoint: process.env.FOUNDRY_PROJECT_ENDPOINT || null,
    timestamp: new Date().toISOString(),
  });
});

registerFoundryResponsesRoutes(server);

const port = Number(process.env.PORT) || 8088;
const host = process.env.HOST ?? '0.0.0.0';
const httpServer = http.createServer(server);

httpServer.listen(port, host, () => {
  console.log(`Morgan Foundry Responses host listening on ${host}:${port}`);
  console.log(`Foundry Responses endpoint: http://${host}:${port}/responses`);
  console.log(`Readiness endpoint: http://${host}:${port}/readiness`);
  recordAuditEvent({
    kind: 'server.started',
    label: 'Morgan Foundry Responses host started',
    data: { host, port, responses: '/responses', readiness: '/readiness' },
  });
});

httpServer.on('error', (err: unknown) => {
  console.error(err);
  recordAuditEvent({
    kind: 'server.error',
    label: 'Morgan Foundry Responses host error',
    severity: 'error',
    data: { error: err instanceof Error ? err.message : String(err) },
  });
  flushObservability();
  process.exit(1);
});

process.on('SIGTERM', () => flushObservability());
process.on('SIGINT', () => flushObservability());