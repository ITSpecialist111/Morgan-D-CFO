/**
 * @corpgen/agent-sdk — Shared domain-agnostic types.
 *
 * Design note: These interfaces are deliberately shaped to be compatible with
 * the GitHub Copilot SDK (@github/copilot-sdk) ergonomics:
 *   - ToolDefinition mirrors the Copilot SDK's ToolDefinition shape (name / description / parameters / handler).
 *   - AgentEvent kinds overlap with Copilot SDK event names (assistant.message, session.idle, tool.call, etc.)
 *     so that consumers familiar with the Copilot SDK can orient quickly.
 *   - The WorkLoop.run() lifecycle follows the same promise-based pattern as CopilotClient.createSession().
 *
 * CorpGen paper reference: arXiv:2602.14229 (Microsoft Research, Feb 2026).
 */

// ---------------------------------------------------------------------------
// Tool definition — compatible with @github/copilot-sdk ToolDefinition
// ---------------------------------------------------------------------------

export interface ParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  items?: ParameterSchema;
  properties?: Record<string, ParameterSchema>;
  required?: string[];
}

/**
 * A named, typed callable function an agent can invoke during its work loop.
 * Shape is intentionally compatible with @github/copilot-sdk ToolDefinition.
 */
export interface ToolDefinition<TParams = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  parameters: Record<string, ParameterSchema>;
  /** Risk class used by the ToolPolicy gateway. Defaults to 'read-only'. */
  riskClass?: ToolRiskClass;
  handler: (params: TParams, context: WorkCycleContext) => Promise<TResult>;
}

// ---------------------------------------------------------------------------
// Tool policy — server-side action governance (extracted from Morgan)
// ---------------------------------------------------------------------------

export type ToolRiskClass =
  | 'read-only'
  | 'internal-write'
  | 'external-communication'
  | 'financial-commitment'
  | 'privileged-decision'
  | 'unknown';

export type ToolPolicyDecision = 'allow' | 'approval-required' | 'deny';

export interface ToolPolicy {
  risk: ToolRiskClass;
  approvalLevel?: ApprovalLevel;
  modelVisible: boolean;
  description: string;
}

export interface ToolPolicyEvaluation {
  tool: string;
  policy: ToolPolicy;
  decision: ToolPolicyDecision;
  reason: string;
  actionDigest: string;
  actionSummary: string;
}

// ---------------------------------------------------------------------------
// Agent identity — CorpGen "persistent worker identity" primitive
// ---------------------------------------------------------------------------

/**
 * The agent's job contract: who it is, what it must do, when to escalate.
 * Equivalent to Morgan's MissionInstructionSet but domain-agnostic.
 */
export interface AgentContract {
  /** Display name for the agent (e.g. "Morgan Digital CFO"). */
  name: string;
  /** One-sentence purpose statement. */
  purpose: string;
  /** Who or what this agent reports to. */
  reportsTo: string;
  /** Core responsibilities the agent must fulfil autonomously. */
  mandate: string[];
  /** Principles guiding autonomous decision-making. */
  autonomyPrinciples: string[];
  /** Rules that trigger escalation to a human. */
  escalationRules: string[];
  /** Observable success criteria. */
  successMeasures: string[];
  /**
   * Operating schedule in "HH:MM-HH:MM" format (24-hour, local server time).
   * The WorkLoop respects this window; runs outside it are rejected unless
   * forceRun is set.
   */
  operatingWindow?: string;
}

// ---------------------------------------------------------------------------
// Work cards — CorpGen "Kanban" / task management primitive
// ---------------------------------------------------------------------------

export type WorkCardLane = 'queue' | 'active' | 'waiting' | 'review' | 'done';
export type WorkCardCadence = 'continuous' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'on_demand';
export type WorkCardStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'selected' | 'review' | 'ready';

/** A single unit of work tracked on the agent's Kanban board. */
export interface WorkCard {
  id: string;
  title: string;
  lane: WorkCardLane;
  status: WorkCardStatus;
  priority?: 1 | 2 | 3 | 4 | 5;
  cadence?: WorkCardCadence;
  /** Short human-readable summary of current state. */
  summary: string;
  /** What autonomously triggered this card (e.g. "daily variance check"). */
  trigger?: string;
  /** Why this card was selected this cycle. */
  reason?: string;
  /** Tool names the agent may call to advance this card. */
  tools: string[];
  /** Sub-agent IDs the agent may delegate to. */
  subAgents: string[];
  /** Observable evidence produced when the card was last advanced. */
  evidence: string[];
  /** Who owns this card (agent name or human). */
  owner: string;
  updatedAt?: string;
  /** If set, this card requires human approval before it can move to 'done'. */
  hitlLevel?: ApprovalLevel;
}

export interface KanbanColumn {
  id: WorkCardLane;
  title: string;
  intent: string;
  wipLimit?: number;
  cards: WorkCard[];
}

export interface KanbanBoard {
  generatedAt: string;
  nextBestAction: string;
  metrics: {
    queued: number;
    active: number;
    waiting: number;
    review: number;
    done: number;
    total: number;
  };
  columns: KanbanColumn[];
}

// ---------------------------------------------------------------------------
// Planning — CorpGen "multi-horizon planning" primitive
// ---------------------------------------------------------------------------

/**
 * A three-horizon plan with a dependency DAG.
 * Mirrors Morgan's CfoOperatingPlan but domain-agnostic.
 */
export interface WorkPlan {
  generatedAt: string;
  horizon: {
    /** Long-range objectives (months). */
    strategic: string[];
    /** Near-term milestones (weeks). */
    tactical: string[];
    /** Runnable actions for the current cycle (hours). */
    operational: string[];
  };
  /** The 1-5 cards the agent should attempt next, in priority order. */
  nextRunnableCards: Array<{
    id: string;
    title: string;
    priority: WorkCard['priority'];
    reason: string;
    tools: string[];
    subAgents: string[];
  }>;
  /** Directed edges of the work dependency graph. */
  dependencyGraph: Array<{ from: string; to: string; reason: string }>;
  /** Cards blocked on human action or external dependency. */
  escalationQueue: string[];
  /** Artifacts that must be produced before specific cards can complete. */
  proofRequired: string[];
}

// ---------------------------------------------------------------------------
// Memory — CorpGen "tiered memory" primitive
// ---------------------------------------------------------------------------

/**
 * Tiered memory summary produced at the end of each work cycle.
 * Mirrors Morgan's AdaptiveMemorySummary.
 */
export interface MemorySummary {
  generatedAt: string;
  /** Current-cycle active context (what the agent is working on right now). */
  workingContext: string[];
  /** Structured records of completed and blocked work. */
  structuredMemory: string[];
  /** Semantic cues for retrieving relevant prior knowledge. */
  semanticRecall: string[];
  /** Cross-cycle experiential trajectories for improving future selection. */
  experientialTrajectories: string[];
  /** Critical facts (numbers, deadlines, approvals) preserved verbatim. */
  preservedCriticalContent: string[];
  /** Human-readable description of the summarisation policy applied. */
  compressionPolicy: string;
  recordsConsidered: number;
  eventsConsidered: number;
}

/**
 * A validated reusable workflow pattern learned from prior cycles.
 * Mirrors Morgan's ExperientialLearningItem.
 */
export interface LearningPattern {
  id: string;
  title: string;
  /** Condition that activates this pattern. */
  trigger: string;
  /** The validated sequence of steps or heuristic. */
  validatedPattern: string;
  /** How the agent should reuse this pattern when the trigger fires. */
  reuseInstruction: string;
  /** Observable evidence that validated this pattern. */
  evidence: string[];
  status: 'active' | 'candidate' | 'needs-validation';
}

// ---------------------------------------------------------------------------
// Artifact evaluation — CorpGen "artifact-based evaluation" primitive
// ---------------------------------------------------------------------------

export interface ArtifactCheck {
  id: string;
  label: string;
  score: number;
  pass: boolean;
  rationale: string;
}

export type ArtifactVerdict = 'ready' | 'needs-review' | 'blocked';

export interface ArtifactEvaluation {
  id: string;
  evaluatedAt: string;
  artifactType: string;
  title: string;
  score: number;
  verdict: ArtifactVerdict;
  rationale: string;
  checks: ArtifactCheck[];
}

// ---------------------------------------------------------------------------
// HITL governance — CorpGen "enterprise control" primitive
// ---------------------------------------------------------------------------

export type ApprovalLevel = 'L2' | 'L3';
export type ApprovalStatus =
  | 'pending'
  | 'approved'
  | 'approved_with_edits'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'executing'
  | 'executed'
  | 'failed';
export type ApprovalDecision = 'approve' | 'approve_with_edits' | 'decline' | 'cancel';

export interface ApproverIdentity {
  oid?: string;
  tenantId?: string;
  email?: string;
  name?: string;
}

export interface ApprovalRequest {
  id: string;
  level: ApprovalLevel;
  stage: string;
  title: string;
  actionType: string;
  /** Target of the action (email address, channel, etc.). */
  recipient: string;
  /** Short description of what will happen if approved. */
  bodyPreview: string;
  /** Why the agent is requesting this approval. */
  rationale: string;
  triggeredBy: string;
  /** Tool that will be called if approved. */
  tool: string;
  /** Params that will be passed to the tool. */
  toolParams: Record<string, unknown>;
  evidence: string[];
  createdAt: string;
  timeoutAt: string;
  status: ApprovalStatus;
  /** Monotonically increasing; used to detect stale submissions. */
  version: number;
  /** SHA-256 of canonical(tool, params) — prevents replay attacks. */
  actionDigest: string;
  transitionHistory: Array<{ at: string; status: ApprovalStatus; actor: string; reason?: string }>;
  decidedAt?: string;
  decidedBy?: string;
  decidedByOid?: string;
  rationaleFromApprover?: string;
  editedBody?: string;
}

export interface ApprovalDecisionResult {
  ok: boolean;
  request?: ApprovalRequest;
  error?: string;
  code?: 'unknown' | 'already-decided' | 'expired' | 'unauthorized' | 'stale-version' | 'digest-mismatch';
}

// ---------------------------------------------------------------------------
// Observability — Agent Mind event stream
// ---------------------------------------------------------------------------

/**
 * Event kinds are a superset of GitHub Copilot SDK session event names
 * (assistant.message, session.idle) so consumers can share event handlers
 * across SDK families.
 */
export type AgentEventKind =
  // GitHub Copilot SDK-compatible names
  | 'assistant.message'
  | 'session.idle'
  | 'tool.call'
  | 'tool.result'
  // CorpGen-specific
  | 'agent.reply'
  | 'cycle.start'
  | 'cycle.end'
  | 'mission.task'
  | 'hitl.request'
  | 'hitl.decision'
  | 'subagent.call'
  | 'subagent.result'
  | 'memory.update'
  | 'artifact.evaluated'
  | 'plan.generated'
  | 'policy.decision';

export interface AgentEvent {
  id: string;
  ts: string;
  kind: AgentEventKind;
  label: string;
  durationMs?: number;
  status?: 'ok' | 'error' | 'partial' | 'started';
  data?: Record<string, unknown>;
  correlationId?: string;
}

// ---------------------------------------------------------------------------
// Sub-agent bus
// ---------------------------------------------------------------------------

export type SubAgentKind = 'specialist' | 'bridge';

export interface SubAgentDefinition {
  id: string;
  name: string;
  kind: SubAgentKind;
  role: string;
  capabilities: string[];
  status: 'configured' | 'missing_endpoint';
  endpoint?: string;
}

export interface SubAgentCallResult {
  success: boolean;
  agentId: string;
  status?: number;
  response?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Work cycle context — passed to tool handlers each cycle
// ---------------------------------------------------------------------------

/**
 * Execution context for a single agent work cycle.
 * Analogous to the Copilot SDK's session context passed to tool handlers.
 */
export interface WorkCycleContext {
  /** Unique identifier for this cycle run. */
  correlationId: string;
  /** ISO timestamp when the cycle started. */
  cycleStartedAt: string;
  /** The active memory summary from the previous cycle. */
  memorySummary?: MemorySummary;
  /** The card currently being advanced. */
  activeCard?: WorkCard;
  /** If a prior approval was granted, its ID and digest are here. */
  approvalId?: string;
  approvalActionDigest?: string;
  /** Origin of this cycle (scheduler, user-request, etc.). */
  origin: 'scheduler' | 'user-request' | 'manual' | 'system';
}

// ---------------------------------------------------------------------------
// Work loop configuration — top-level SDK entry point config
// ---------------------------------------------------------------------------

/**
 * Configuration for the CorpGen WorkLoop.
 * Mirrors @github/copilot-sdk's CopilotClientOptions in its provider-agnostic
 * approach: you supply adapter implementations rather than hard-coded clients.
 */
export interface WorkLoopConfig {
  /** The agent's identity and job contract. */
  contract: AgentContract;
  /** Tools the agent can call during its work cycle. */
  tools: ToolDefinition[];
  /** LLM provider (Azure OpenAI, OpenAI, Anthropic, etc.). */
  llm: import('./adapters/LlmProvider').LlmProvider;
  /** Persistent storage for work cards, approvals, and memory. */
  storage?: import('./adapters/StorageProvider').StorageProvider;
  /** Notification channels (Teams, email, Slack, etc.). */
  notifications?: import('./adapters/NotificationProvider').NotificationProvider;
  /**
   * Called when the agent requests a human approval before acting.
   * Return true to auto-approve (useful for testing), false to hold.
   * Analogous to @github/copilot-sdk onPermissionRequest.
   */
  onApprovalRequest?: (request: ApprovalRequest) => Promise<boolean>;
  /**
   * Called after each event is emitted.
   * Analogous to session.on('assistant.message', ...) in Copilot SDK.
   */
  onEvent?: (event: AgentEvent) => void;
  /** Maximum number of cards to advance per cycle. Defaults to 2. */
  maxCardsPerCycle?: number;
  /** Whether to run outside the operating window. Defaults to false. */
  forceRun?: boolean;
}

// ---------------------------------------------------------------------------
// Workday result — returned from WorkLoop.run()
// ---------------------------------------------------------------------------

export interface WorkdayResult {
  correlationId: string;
  startedAt: string;
  completedAt: string;
  cyclesRun: number;
  cardsAdvanced: number;
  cardsCompleted: number;
  cardsBlocked: number;
  events: AgentEvent[];
  memorySnapshot: MemorySummary;
  board: KanbanBoard;
}
