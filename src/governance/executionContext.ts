import crypto from 'crypto';

export type ExecutionOrigin =
  | 'teams'
  | 'web'
  | 'voice'
  | 'scheduler'
  | 'shortcut'
  | 'foundry-hosted'
  | 'system';

export type ExecutionRuntime = 'app-service' | 'foundry-hosted' | 'local';

export interface ExecutionActor {
  oid?: string;
  tenantId?: string;
  email?: string;
  name?: string;
  kind: 'human' | 'agent' | 'system' | 'unknown';
}

export interface ExecutionContext {
  correlationId: string;
  origin: ExecutionOrigin;
  runtime: ExecutionRuntime;
  actor: ExecutionActor;
  approvalId?: string;
  approvalActionDigest?: string;
}

const MAX_CORRELATION_ID_LENGTH = 128;

export function safeCorrelationId(value: unknown, prefix = 'morgan'): string {
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, MAX_CORRELATION_ID_LENGTH);
    if (normalized) return normalized;
  }
  return `${prefix}-${crypto.randomUUID()}`;
}

export function runtimeFromEnvironment(): ExecutionRuntime {
  if (process.env.MORGAN_FOUNDRY_RESPONSES_ONLY === 'true') return 'foundry-hosted';
  if (process.env.NODE_ENV === 'development') return 'local';
  return 'app-service';
}

export function createExecutionContext(input: Partial<ExecutionContext> & Pick<ExecutionContext, 'origin'>): ExecutionContext {
  return {
    correlationId: safeCorrelationId(input.correlationId),
    origin: input.origin,
    runtime: input.runtime || runtimeFromEnvironment(),
    actor: input.actor || { kind: 'unknown' },
    approvalId: input.approvalId,
    approvalActionDigest: input.approvalActionDigest,
  };
}

export function systemExecutionContext(
  origin: ExecutionOrigin,
  correlationId?: string,
  runtime = runtimeFromEnvironment(),
): ExecutionContext {
  return createExecutionContext({
    correlationId,
    origin,
    runtime,
    actor: { kind: 'system', name: 'Morgan runtime' },
  });
}
