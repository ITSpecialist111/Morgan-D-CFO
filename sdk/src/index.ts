/**
 * @corpgen/agent-sdk
 *
 * CorpGen Digital Worker SDK — build AI teammates for long-running agentic tasks.
 *
 * Implements the Microsoft CorpGen paper primitives (arXiv:2602.14229) as a
 * reusable TypeScript SDK that is intentionally compatible with GitHub Copilot
 * SDK ergonomics (@github/copilot-sdk, @copilot-extensions/preview-sdk).
 *
 * Quick start:
 * ```typescript
 * import { WorkLoop, InMemoryStorageProvider } from '@corpgen/agent-sdk';
 *
 * const agent = new WorkLoop({
 *   contract: {
 *     name: 'My Digital Worker',
 *     purpose: 'Automate repetitive knowledge work.',
 *     reportsTo: 'manager@example.com',
 *     mandate: ['Complete tasks autonomously.'],
 *     autonomyPrinciples: ['Use tools before making claims.'],
 *     escalationRules: ['Escalate on error.'],
 *     successMeasures: ['All tasks completed with evidence.'],
 *     operatingWindow: '09:00-17:00',
 *   },
 *   tools: [
 *     {
 *       name: 'doWork',
 *       description: 'Perform a unit of work.',
 *       parameters: {},
 *       handler: async (params, context) => ({ done: true }),
 *     },
 *   ],
 *   llm: myLlmProvider,
 *   storage: new InMemoryStorageProvider(),
 *   onEvent: (event) => console.log(event.kind, event.label),
 * });
 *
 * await agent.board.addCard({
 *   id: 'task-1',
 *   title: 'First task',
 *   status: 'pending',
 *   summary: 'Do the first thing.',
 *   tools: ['doWork'],
 *   subAgents: [],
 *   evidence: [],
 *   owner: 'My Digital Worker',
 * });
 *
 * const result = await agent.run();
 * console.log(`Completed ${result.cardsCompleted} cards in ${result.cyclesRun} cycles.`);
 * ```
 */

// --- Core ---
export { WorkLoop } from './core/WorkLoop';
export { AgentIdentity } from './core/AgentIdentity';
export { KanbanBoardManager } from './core/KanbanBoard';
export { WorkReasoner } from './core/WorkReasoner';
export type { CardDecision, ReasonedDecision, WorkReasonerOptions } from './core/WorkReasoner';

// --- Memory ---
export { MemoryEngine } from './memory/MemoryEngine';
export { LearningPlaybook } from './memory/LearningPlaybook';
export type { MemoryEngineOptions } from './memory/MemoryEngine';

// --- Governance ---
export { ToolPolicyGateway, actionDigest, canonicalAction, summarizeAction } from './governance/ToolPolicy';
export { ArtifactJudge } from './governance/ArtifactJudge';
export { HitlGateway } from './governance/HitlGateway';
export type { ToolPolicyConfig } from './governance/ToolPolicy';
export type { JudgeRubricItem, JudgeArtifact } from './governance/ArtifactJudge';
export type { HitlGatewayOptions, RequestApprovalInput } from './governance/HitlGateway';

// --- Observability ---
export { EventBus } from './observability/EventBus';
export { AuditTrail } from './observability/AuditTrail';
export type { EventBusOptions } from './observability/EventBus';
export type { AuditRecord, AuditEventCategory } from './observability/AuditTrail';

// --- Sub-agents ---
export { SubAgentBus } from './subagents/SubAgentBus';
export type { SubAgentEntry, SubAgentBusOptions } from './subagents/SubAgentBus';

// --- Adapters (built-in implementations) ---
export { InMemoryStorageProvider } from './adapters/InMemoryStorageProvider';
export { ConsoleNotificationProvider } from './adapters/ConsoleNotificationProvider';
export type { LlmProvider, LlmMessage, LlmCompletionOptions, LlmCompletionResult } from './adapters/LlmProvider';
export type { StorageProvider } from './adapters/StorageProvider';
export type { NotificationProvider, NotificationMessage, NotificationResult } from './adapters/NotificationProvider';

// --- All shared types ---
export type {
  // Tool system
  ToolDefinition,
  ParameterSchema,
  ToolRiskClass,
  ToolPolicyDecision,
  ToolPolicy,
  ToolPolicyEvaluation,
  // Agent identity
  AgentContract,
  // Work cards and planning
  WorkCard,
  WorkCardLane,
  WorkCardCadence,
  WorkCardStatus,
  KanbanColumn,
  KanbanBoard,
  WorkPlan,
  // Memory
  MemorySummary,
  LearningPattern,
  // Artifact evaluation
  ArtifactCheck,
  ArtifactVerdict,
  ArtifactEvaluation,
  // HITL governance
  ApprovalLevel,
  ApprovalStatus,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalDecisionResult,
  ApproverIdentity,
  // Observability
  AgentEventKind,
  AgentEvent,
  // Sub-agents
  SubAgentKind,
  SubAgentDefinition,
  SubAgentCallResult,
  // Work loop
  WorkCycleContext,
  WorkLoopConfig,
  WorkdayResult,
} from './types';
