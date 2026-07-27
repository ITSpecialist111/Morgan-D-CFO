/**
 * ToolPolicy — server-side tool governance gateway.
 *
 * Classifies every tool call by risk, decides allow / approval-required / deny,
 * and produces a SHA-256 action digest for replay prevention.
 *
 * Generalised from Morgan's src/governance/toolPolicy.ts.
 * Added extensibility: consumers supply their own allowlists rather than
 * hard-coding Morgan's CFO-specific tool names.
 */

import crypto from 'crypto';
import type { ToolRiskClass, ToolPolicyDecision, ToolPolicy, ToolPolicyEvaluation } from '../types';

export type { ToolRiskClass, ToolPolicyDecision, ToolPolicy, ToolPolicyEvaluation };

const READ_ONLY_PATTERNS = /(?:^|_)(get|list|read|search|find|lookup|query|describe|status|health|fetch|retrieve|inspect|analy[sz]e|detect|calculate|summari[sz]e|show|view)(?:_|$)/i;
const WRITE_PATTERNS = /(?:send|post|create|update|delete|remove|schedule|invite|call|write|publish|upload|share|grant|approve|commit|release|pay|transfer|initiate|cancel)/i;

export interface ToolPolicyConfig {
  /** Tool names always allowed without approval (read-only reads, safe queries). */
  readOnlyTools?: Set<string>;
  /** Tool names that write internal state only (no external side effects). */
  internalWriteTools?: Set<string>;
  /** Tool names that cause external side effects — require L2 approval. */
  externalL2Tools?: Set<string>;
  /** Tool names that are model-invisible (human-only governance operations). */
  neverModelTools?: Set<string>;
  /** Allowlist for dynamically discovered MCP/external tools. */
  mcpAllowlist?: Set<string>;
}

// Stable canonical JSON for digest computation
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableValue(v)]),
    );
  }
  return value;
}

export function canonicalAction(tool: string, params: Record<string, unknown>): string {
  return JSON.stringify(stableValue({ tool, params }));
}

export function actionDigest(tool: string, params: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(canonicalAction(tool, params)).digest('hex');
}

function summaryValue(params: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120);
  }
  return undefined;
}

export function summarizeAction(tool: string, params: Record<string, unknown>): string {
  const target = summaryValue(params, ['to', 'recipient', 'channel_id', 'assigned_to', 'attendees']);
  const subject = summaryValue(params, ['subject', 'title', 'reason', 'message']);
  return [tool, subject, target ? `target ${target}` : undefined].filter(Boolean).join(' — ').slice(0, 300);
}

export class ToolPolicyGateway {
  private readonly config: Required<ToolPolicyConfig>;

  constructor(config: ToolPolicyConfig = {}) {
    this.config = {
      readOnlyTools: config.readOnlyTools ?? new Set(),
      internalWriteTools: config.internalWriteTools ?? new Set(),
      externalL2Tools: config.externalL2Tools ?? new Set(),
      neverModelTools: config.neverModelTools ?? new Set(),
      mcpAllowlist: config.mcpAllowlist ?? new Set(),
    };
  }

  classify(tool: string, discoveredMcp = false): ToolPolicy {
    if (this.config.neverModelTools.has(tool)) {
      return { risk: 'privileged-decision', modelVisible: false, description: 'Human-only governance operation.' };
    }
    if (this.config.readOnlyTools.has(tool) || READ_ONLY_PATTERNS.test(tool)) {
      return { risk: 'read-only', modelVisible: true, description: 'Read-only analysis or state retrieval.' };
    }
    if (this.config.internalWriteTools.has(tool)) {
      return { risk: 'internal-write', modelVisible: true, description: 'Internal state or artifact update.' };
    }
    if (this.config.externalL2Tools.has(tool)) {
      return { risk: 'external-communication', approvalLevel: 'L2', modelVisible: true, description: 'External communication or mutable action.' };
    }
    if (discoveredMcp) {
      if (!this.config.mcpAllowlist.has(tool)) {
        return { risk: 'unknown', modelVisible: false, description: 'Discovered MCP tool is not in the allowlist.' };
      }
      if (WRITE_PATTERNS.test(tool)) {
        return { risk: 'external-communication', approvalLevel: 'L2', modelVisible: true, description: 'Allowlisted MCP write action.' };
      }
      return { risk: 'read-only', modelVisible: true, description: 'Allowlisted MCP read action.' };
    }
    return { risk: 'unknown', modelVisible: false, description: 'Unclassified tool denied by default.' };
  }

  evaluate(
    tool: string,
    params: Record<string, unknown>,
    options: { discoveredMcp?: boolean; approvalId?: string; approvalActionDigest?: string } = {},
  ): ToolPolicyEvaluation {
    const policy = this.classify(tool, options.discoveredMcp);
    const digest = actionDigest(tool, params);
    const base = {
      tool,
      policy,
      actionDigest: digest,
      actionSummary: summarizeAction(tool, params),
    };

    if (policy.risk === 'unknown' || policy.risk === 'privileged-decision') {
      return { ...base, decision: 'deny', reason: policy.description };
    }
    if (policy.risk === 'read-only' || policy.risk === 'internal-write') {
      return { ...base, decision: 'allow', reason: policy.description };
    }
    if (options.approvalId && options.approvalActionDigest === digest) {
      return { ...base, decision: 'allow', reason: `Matching ${policy.approvalLevel ?? 'L2'} approval context supplied.` };
    }
    return {
      ...base,
      decision: 'approval-required',
      reason: `${policy.approvalLevel ?? 'L2'} human approval is required before ${tool} can execute.`,
    };
  }
}
