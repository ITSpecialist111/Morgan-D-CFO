/**
 * SubAgentBus — registry, call, retry, and auth abstraction for specialist agents.
 *
 * Provides isolated sub-agent invocation so the primary agent can delegate
 * specialist work without sharing its context window.
 *
 * Implements the CorpGen "sub-agent isolation" primitive.
 * Generalised from Morgan's src/orchestrator/subAgents.ts.
 *
 * Copilot SDK alignment: analogous to the Copilot SDK's ability to spin up
 * parallel agent sessions. Here we use HTTP handoff rather than in-process
 * calls, which is more compatible with enterprise network topologies.
 */

import type { SubAgentDefinition, SubAgentCallResult } from '../types';

export type { SubAgentDefinition, SubAgentCallResult };

export interface SubAgentEntry {
  id: string;
  name: string;
  kind: 'specialist' | 'bridge';
  role: string;
  capabilities: string[];
  endpoint?: string;
  defaultPath?: string;
  /** Environment variable name that holds the endpoint URL. */
  endpointEnv?: string;
}

export interface SubAgentBusOptions {
  agents: SubAgentEntry[];
  /** Shared bearer token for sub-agent calls (overridden by per-agent env). */
  bearerToken?: string;
  /** Shared secret header for sub-agent calls. */
  sharedSecret?: string;
  /** Maximum retry attempts on transient errors. Defaults to 2. */
  maxAttempts?: number;
  /** Per-call timeout in milliseconds. Defaults to 30 000. */
  timeoutMs?: number;
  /** Caller agent name sent in the x-agent-id header. */
  callerName?: string;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class SubAgentBus {
  private readonly registry: SubAgentDefinition[];
  private readonly bearerToken?: string;
  private readonly sharedSecret?: string;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;
  private readonly callerName: string;

  constructor(options: SubAgentBusOptions) {
    this.bearerToken = options.bearerToken;
    this.sharedSecret = options.sharedSecret;
    this.maxAttempts = Math.max(1, Math.min(3, options.maxAttempts ?? 2));
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.callerName = options.callerName ?? 'corpgen-agent';

    this.registry = options.agents.map((agent) => {
      const endpoint = agent.endpoint ?? this.readEndpoint(agent.endpointEnv);
      return {
        id: agent.id,
        name: agent.name,
        kind: agent.kind,
        role: agent.role,
        capabilities: agent.capabilities,
        status: endpoint ? 'configured' : 'missing_endpoint',
        endpoint,
      };
    });
  }

  private readEndpoint(envName?: string): string | undefined {
    if (!envName) return undefined;
    const value = process.env[envName];
    if (!value) return undefined;
    if (value.includes('<') || value.includes('>')) return undefined;
    return value.replace(/\/$/, '');
  }

  private authHeaders(agentId: string): Record<string, string> {
    const normalized = agentId.toUpperCase().replace(/-/g, '_');
    const token = process.env[`${normalized}_AGENT_BEARER_TOKEN`] ?? this.bearerToken;
    const secret = process.env[`${normalized}_AGENT_SHARED_SECRET`] ?? this.sharedSecret;
    return {
      ...(token ? { Authorization: ['Bearer', token].join(' ') } : {}),
      ...(secret ? { 'x-agent-secret': secret } : {}),
    };
  }

  getRegistry(): SubAgentDefinition[] {
    return this.registry.slice();
  }

  async call(params: {
    agentId: string;
    message: string;
    path?: string;
    timeoutMs?: number;
    payload?: Record<string, unknown>;
  }): Promise<SubAgentCallResult> {
    const agent = this.registry.find((item) => item.id === params.agentId);
    if (!agent) {
      return { success: false, agentId: params.agentId, error: `Unknown sub-agent: ${params.agentId}` };
    }
    if (!agent.endpoint) {
      return {
        success: false,
        agentId: params.agentId,
        error: `${agent.name} endpoint is not configured.`,
      };
    }

    const path = params.path ?? '/api/agent-messages';
    if (path && (!path.startsWith('/') || path.includes('..') || /^\/\//.test(path))) {
      return { success: false, agentId: params.agentId, error: 'Sub-agent path override must be a safe relative URL path.' };
    }
    if (!params.message.trim() || params.message.length > 12_000) {
      return { success: false, agentId: params.agentId, error: 'Message must be 1-12 000 characters.' };
    }

    const callTimeout = params.timeoutMs ?? this.timeoutMs;
    let lastError = '';

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), callTimeout);
      try {
        const url = `${agent.endpoint}${path}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-agent-id': this.callerName,
            ...this.authHeaders(agent.id),
          },
          body: JSON.stringify({ message: params.message, sourceAgent: this.callerName, attempt, ...params.payload }),
          signal: controller.signal,
        });
        const text = await response.text();
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* keep raw text */ }

        if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === this.maxAttempts) {
          return {
            success: response.ok,
            agentId: agent.id,
            status: response.status,
            response: parsed,
            error: response.ok ? undefined : `HTTP ${response.status} after ${attempt} attempt(s).`,
          };
        }
        lastError = `HTTP ${response.status}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt === this.maxAttempts) {
          return { success: false, agentId: agent.id, error: `${lastError} after ${attempt} attempt(s).` };
        }
      } finally {
        clearTimeout(timer);
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }

    return { success: false, agentId: agent.id, error: lastError || 'Sub-agent call failed.' };
  }
}
