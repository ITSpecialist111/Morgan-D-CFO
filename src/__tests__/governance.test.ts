import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { createExecutionContext } from '../governance/executionContext';
import { evaluateToolPolicy, isToolModelVisible } from '../governance/toolPolicy';
import { redactText, sanitizeTelemetryData } from '../governance/redaction';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'morgan-governance-'));
process.env.NODE_ENV = 'test';
process.env.MORGAN_HITL_APPROVAL_FILE = path.join(tempRoot, 'approvals.json');
process.env.MORGAN_SEED_DEMO_APPROVALS = 'false';
process.env.MORGAN_HITL_SIGNING_SECRET = 'test-signing-secret-with-sufficient-entropy';
process.env.MORGAN_HITL_APPROVER_OIDS = 'approver-1';
process.env.MORGAN_HITL_APPROVER_TENANT_ID = 'tenant-1';
process.env.MORGAN_HITL_REQUIRE_EXPLICIT_APPROVERS = 'true';

const executionContext = createExecutionContext({
  origin: 'teams',
  runtime: 'local',
  correlationId: 'governance-test-correlation',
  actor: { kind: 'human', oid: 'requester-1', tenantId: 'tenant-1', name: 'Test requester' },
});

const hitlModule = import('../mission/hitlApprovals');
const toolsModule = import('../tools');
const responsesModule = import('../foundry/responsesAdapter');
const acsModule = import('../voice/acsBridge');

async function withTestServer(
  configure: (app: express.Express) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  configure(app);
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('Morgan governance hardening', async (suite) => {
  await suite.test('policy allows reads, gates writes, and denies unknown tools', () => {
    assert.equal(evaluateToolPolicy('getLatestPnL', {}, executionContext).decision, 'allow');
    assert.equal(evaluateToolPolicy('sendEmail', { to: 'cfo@example.com', subject: 'Report', body: 'content' }, executionContext).decision, 'approval-required');
    assert.equal(evaluateToolPolicy('initiateTeamsFederatedCall', { reason: 'Model request', teams_user_aad_oid: 'teams-user-1' }, executionContext).decision, 'approval-required');
    assert.equal(evaluateToolPolicy('inventedAdminTool', {}, executionContext).decision, 'deny');
    assert.equal(isToolModelVisible('recordHitlApprovalDecision'), false);
    assert.equal(isToolModelVisible('mcp_Attacker_readSecrets', true), false);
  });

  await suite.test('telemetry redacts credentials and email identities', () => {
    const redacted = redactText('Authorization: Bearer abc.def.ghi contact alice@example.com');
    assert.doesNotMatch(redacted, /abc\.def\.ghi/);
    assert.doesNotMatch(redacted, /alice@example\.com/);
    const data = sanitizeTelemetryData({ clientSecret: 'top-secret', promptPreview: 'email bob@example.com' });
    assert.equal(data?.clientSecret, '[REDACTED]');
    assert.match(String(data?.promptPreview), /\[email\]@example\.com/);
  });

  await suite.test('approvals enforce identity, expiry, version, digest, and replay protection', async () => {
    const hitl = await hitlModule;
    const action = { tool: 'sendEmail', params: { to: 'board@example.com', subject: 'Board pack', body: 'sensitive board content' } };

    const unauthorizedRequest = hitl.requestHitlApproval({ level: 'L2', action, title: 'Unauthorized test' });
    assert.equal(unauthorizedRequest.ok, true);
    const unauthorized = hitl.recordHitlApprovalDecision({
      requestId: unauthorizedRequest.request!.id,
      decision: 'approve',
      identity: { oid: 'not-allowed', tenantId: 'tenant-1', name: 'Unauthorized user' },
      expectedVersion: unauthorizedRequest.request!.version,
      expectedActionDigest: unauthorizedRequest.request!.actionDigest,
    });
    assert.equal(unauthorized.code, 'unauthorized');

    const unsigned = hitl.recordHitlApprovalDecision({
      requestId: unauthorizedRequest.request!.id,
      decision: 'approve',
      identity: { oid: 'approver-1', tenantId: 'tenant-1', name: 'CFO' },
      expectedVersion: unauthorizedRequest.request!.version,
      expectedActionDigest: unauthorizedRequest.request!.actionDigest,
    });
    assert.equal(unsigned.code, 'invalid-signature');

    const expiredRequest = hitl.requestHitlApproval({
      level: 'L2',
      action: { tool: 'sendTeamsMessage', params: { channel_id: 'finance', message: 'expired' } },
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const expired = hitl.recordHitlApprovalDecision({
      requestId: expiredRequest.request!.id,
      decision: 'approve',
      identity: { oid: 'approver-1', tenantId: 'tenant-1', name: 'CFO' },
      expectedVersion: expiredRequest.request!.version,
      expectedActionDigest: expiredRequest.request!.actionDigest,
    });
    assert.equal(expired.code, 'expired');

    const approved = hitl.recordHitlApprovalDecision({
      requestId: unauthorizedRequest.request!.id,
      decision: 'approve',
      identity: { oid: 'approver-1', tenantId: 'tenant-1', name: 'CFO' },
      expectedVersion: unauthorizedRequest.request!.version,
      expectedActionDigest: unauthorizedRequest.request!.actionDigest,
      decisionToken: (hitl.listHitlApprovalRequests({ status: 'all', includeDecisionTokens: true }).requests.find((item) => item.id === unauthorizedRequest.request!.id) as any)?.decisionTokens?.approve,
    });
    assert.equal(approved.ok, true);
    const reserved = hitl.reserveApprovedAction(approved.request!.id, approved.request!.actionDigest);
    assert.equal(reserved.ok, true);
    assert.equal(hitl.completeApprovedAction(approved.request!.id, true, 'Test execution completed.').ok, true);
    assert.equal(hitl.reserveApprovedAction(approved.request!.id, approved.request!.actionDigest).ok, false);
    assert.equal(hitl.getApprovalRequestById(approved.request!.id)?.status, 'executed');
  });

  await suite.test('forged Adaptive Card decisions are rejected', async () => {
    const hitl = await hitlModule;
    const request = hitl.requestHitlApproval({
      level: 'L3',
      action: { tool: 'releaseVendorPayment', params: { amountUsd: 50000, caseId: 'TEST-1' } },
    }).request!;
    const submission = hitl.handleHitlApprovalCardSubmit({
      morganAction: 'hitlApprovalDecision',
      requestId: request.id,
      version: request.version,
      actionDigest: request.actionDigest,
      decision: 'approve',
      decisionToken: 'forged.token',
    }, { oid: 'approver-1', tenantId: 'tenant-1', name: 'CFO' });
    assert.equal(submission?.handled, true);
    assert.equal(submission?.result?.code, 'invalid-signature');
  });

  await suite.test('approve with edits binds authorization to the edited action only', async () => {
    const hitl = await hitlModule;
    const original = { tool: 'sendTeamsMessage', params: { channel_id: 'finance', message: 'original message' } };
    const request = hitl.requestHitlApproval({ level: 'L2', action: original }).request!;
    const decision = hitl.recordHitlApprovalDecision({
      requestId: request.id,
      decision: 'approve_with_edits',
      identity: { oid: 'approver-1', tenantId: 'tenant-1', name: 'CFO' },
      editedBody: 'approved revised message',
      expectedVersion: request.version,
      expectedActionDigest: request.actionDigest,
      decisionToken: (hitl.listHitlApprovalRequests({ status: 'all', includeDecisionTokens: true }).requests.find((item) => item.id === request.id) as any)?.decisionTokens?.approve_with_edits,
    });
    assert.equal(decision.ok, true);
    assert.notEqual(decision.request?.actionDigest, request.actionDigest);
    assert.equal(hitl.getApprovalForAction(original.tool, original.params), undefined);
    assert.equal(hitl.getApprovalForAction('sendTeamsMessage', { channel_id: 'finance', message: 'approved revised message' })?.id, request.id);
  });

  await suite.test('dispatcher returns typed outcomes and creates approvals without side effects', async () => {
    const { executeTool, getAllTools } = await toolsModule;
    assert.equal(getAllTools().some((tool) => tool.type === 'function' && tool.function.name === 'recordHitlApprovalDecision'), false);
    assert.equal(getAllTools().some((tool) => tool.type === 'function' && tool.function.name === 'sendHitlApprovalCardToModAdministrator'), false);

    const denied = JSON.parse(await executeTool('inventedAdminTool', {}, undefined, executionContext));
    assert.equal(denied.status, 'denied');
    assert.equal(denied.executed, false);

    const gated = JSON.parse(await executeTool('sendEmail', {
      to: 'new-recipient@example.com',
      subject: 'Never sent in test',
      body: 'This must only create an approval.',
    }, undefined, executionContext));
    assert.equal(gated.status, 'approval_required');
    assert.equal(gated.executed, false);
    assert.ok(gated.approvalId);

    const invalid = JSON.parse(await executeTool('sendEmail', {
      to: 'new-recipient@example.com',
      subject: 'Invalid request',
      body: 'content',
      unexpectedPrivilege: 'admin',
    }, undefined, executionContext));
    assert.equal(invalid.status, 'denied');
    assert.equal(invalid.executed, false);

    const unsupportedCompletion = JSON.parse(await executeTool('recordMissionTaskCompletion', {
      task_id: 'executive-briefing',
      summary: 'Claim the executive briefing was completed without evidence.',
      status: 'completed',
    }, undefined, executionContext));
    assert.equal(unsupportedCompletion.status, 'denied');

    const read = JSON.parse(await executeTool('getLatestPnL', { period: '2026-07' }, undefined, executionContext));
    assert.equal(read.status, 'executed');
    assert.equal(read.executed, true);
    assert.equal(read.result.provenance.mode, 'deterministic-demo');

    const modelApprovals = JSON.parse(await executeTool('listHitlApprovalRequests', { status: 'all' }, undefined, executionContext));
    assert.equal(modelApprovals.status, 'executed');
    assert.equal(modelApprovals.result.requests.some((request: any) => request.decisionTokens), false);
    const tokenEscalation = JSON.parse(await executeTool('listHitlApprovalRequests', { status: 'all', includeDecisionTokens: true }, undefined, executionContext));
    assert.equal(tokenEscalation.status, 'denied');
  });

  await suite.test('approval ledger is durable and healthy', async () => {
    const hitl = await hitlModule;
    const status = hitl.listHitlApprovalRequests({ status: 'all' }).storage;
    assert.equal(status.healthy, true);
    assert.equal(status.singleInstanceOnly, true);
    assert.equal(fs.existsSync(process.env.MORGAN_HITL_APPROVAL_FILE!), true);
  });

  await suite.test('App Service protects Responses while dedicated Foundry hosting remains compatible', async () => {
    const { registerFoundryResponsesRoutes } = await responsesModule;
    await withTestServer((app) => {
      registerFoundryResponsesRoutes(app, { authorize: (_req, res) => { res.status(401).json({ error: 'Unauthorized' }); } });
    }, async (baseUrl) => {
      const protectedResponse = await fetch(`${baseUrl}/responses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'hello' }) });
      assert.equal(protectedResponse.status, 401);
      const protectedReadiness = await fetch(`${baseUrl}/readiness`);
      assert.equal(protectedReadiness.status, 401);
    });

    const priorEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_ENDPOINT;
    await withTestServer((app) => registerFoundryResponsesRoutes(app), async (baseUrl) => {
      const foundryResponse = await fetch(`${baseUrl}/responses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: 'hello' }) });
      assert.equal(foundryResponse.status, 200);
      const payload = await foundryResponse.json() as { status?: string; output_text?: string };
      assert.equal(payload.status, 'completed');
      assert.match(payload.output_text || '', /AZURE_OPENAI_ENDPOINT is not configured/);
    });
    if (priorEndpoint) process.env.AZURE_OPENAI_ENDPOINT = priorEndpoint;
  });

  await suite.test('unlisted inbound callers are denied before ACS answer execution', async () => {
    const { handleIncomingCallEvent } = await acsModule;
    delete process.env.MORGAN_ALLOWED_INBOUND_CALLER_IDS;
    delete process.env.MORGAN_ALLOW_UNLISTED_INBOUND_CALLS;
    const result = await handleIncomingCallEvent({
      eventType: 'Microsoft.Communication.IncomingCall',
      data: { incomingCallContext: 'opaque-test-context', from: { rawId: 'unlisted-caller', displayName: 'Unknown caller' } },
    });
    assert.deepEqual(result, { ignored: true, reason: 'Inbound caller is not allowlisted.' });
  });
});

test.after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});
