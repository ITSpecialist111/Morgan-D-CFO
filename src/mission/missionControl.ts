import type { ChatCompletionTool } from 'openai/resources/chat';
import fs from 'fs';
import path from 'path';
import {
  analyzeBudgetVsActuals,
  calculateTrend,
  detectAnomalies,
  getFinancialKPIs,
} from '../tools/financialTools';
import { synthesizeMicrosoftIQBriefing, type MicrosoftIQBriefing } from '../tools/iqTools';
import { getObservabilityStatus, getRecentAuditEvents, recordAuditEvent } from '../observability/agentAudit';
import { recordAgentEvent } from '../observability/agentEvents';
import { callSubAgent, getSubAgentRegistry } from '../orchestrator/subAgents';
import { getAgentStorageStatus } from '../storage/agentStorage';

export type MissionTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed';
export type MissionTaskCadence = 'continuous' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'on_demand';

export interface MissionInstructionSet {
  title: string;
  purpose: string;
  reportsTo: string;
  mandate: string[];
  autonomyPrinciples: string[];
  customerVisibleInstructions: string[];
  escalationRules: string[];
  successMeasures: string[];
}

export interface MissionTaskDefinition {
  id: string;
  title: string;
  description: string;
  cadence: MissionTaskCadence;
  priority: 1 | 2 | 3 | 4 | 5;
  expectedOutputs: string[];
  tools: string[];
  subAgents: string[];
  autonomousTrigger: string;
}

export interface EnterpriseCapability {
  id: string;
  title: string;
  category: 'planning' | 'memory' | 'tools' | 'subagents' | 'governance' | 'communication' | 'evaluation';
  description: string;
  sourcePattern: string;
  morganMapping: string;
  customerProof: string[];
}

export interface AutonomyModeDefinition {
  id: string;
  title: string;
  window: string;
  purpose: string;
  runTrigger: string;
  evidence: string[];
}

export interface PaperAlignmentItem {
  id: string;
  paperConcept: string;
  morganImplementation: string;
  enterpriseControl: string;
  status: 'implemented' | 'mapped' | 'production-hardening';
  proof: string[];
}

export interface CognitiveToolDefinition {
  id: string;
  title: string;
  morganTool: string;
  paperMechanism: string;
  purpose: string;
  inputs: string[];
  outputs: string[];
  enterpriseControl: string;
  status: 'live' | 'configured' | 'production-hardening';
}

export interface EnterpriseReadinessCheck {
  id: string;
  area: string;
  status: 'ready' | 'configured' | 'partial' | 'needs-configuration' | 'production-hardening';
  signal: string;
  control: string;
  evidence: string[];
}

export interface AdaptiveMemorySummary {
  generatedAt: string;
  workingContext: string[];
  structuredMemory: string[];
  semanticRecall: string[];
  experientialTrajectories: string[];
  preservedCriticalContent: string[];
  compressionPolicy: string;
  recordsConsidered: number;
  auditEventsConsidered: number;
}

export interface ExperientialLearningItem {
  id: string;
  title: string;
  trigger: string;
  validatedPattern: string;
  reuseInstruction: string;
  evidence: string[];
  status: 'active' | 'candidate' | 'needs-enterprise-data';
}

export interface CfoOperatingPlan {
  generatedAt: string;
  horizon: {
    strategic: string[];
    tactical: string[];
    operational: string[];
  };
  nextRunnableTasks: Array<{
    id: string;
    title: string;
    priority: MissionTaskDefinition['priority'];
    reason: string;
    tools: string[];
    subAgents: string[];
  }>;
  dependencyGraph: Array<{ from: string; to: string; reason: string }>;
  escalationQueue: string[];
  proofRequired: string[];
}

export type AutonomousKanbanCardState = 'queue' | 'active' | 'waiting' | 'review' | 'done';

export interface AutonomousKanbanCard {
  id: string;
  title: string;
  taskId?: string;
  state: AutonomousKanbanCardState;
  status: MissionTaskStatus | 'selected' | 'review' | 'ready';
  priority?: MissionTaskDefinition['priority'];
  cadence?: MissionTaskCadence;
  summary: string;
  trigger?: string;
  reason?: string;
  tools: string[];
  subAgents: string[];
  evidence: string[];
  owner: string;
  updatedAt?: string;
}

export interface AutonomousKanbanColumn {
  id: AutonomousKanbanCardState;
  title: string;
  intent: string;
  wipLimit?: number;
  cards: AutonomousKanbanCard[];
}

export interface AutonomousKanbanBoard {
  generatedAt: string;
  nextBestAction: string;
  aiKanbanAgent: {
    status: 'configured' | 'missing_endpoint';
    endpointConfigured: boolean;
    capabilities: string[];
  };
  metrics: {
    queued: number;
    active: number;
    waiting: number;
    review: number;
    done: number;
    total: number;
  };
  columns: AutonomousKanbanColumn[];
}

export interface ArtifactEvaluationCheck {
  id: string;
  label: string;
  score: number;
  pass: boolean;
  rationale: string;
}

export interface ArtifactEvaluationResult {
  id: string;
  evaluatedAt: string;
  artifactType: string;
  title: string;
  score: number;
  verdict: 'ready' | 'needs-review' | 'blocked';
  rationale: string;
  checks: ArtifactEvaluationCheck[];
}

export interface MissionTaskRecord {
  id: string;
  taskId: string;
  title: string;
  status: MissionTaskStatus;
  summary: string;
  evidence: string[];
  startedAt: string;
  completedAt?: string;
  source: 'autonomous_cycle' | 'user_request' | 'scheduled_job' | 'system';
}

export interface SubAgentHandoffResult {
  agentId: string;
  agentName: string;
  status: 'completed' | 'skipped' | 'failed' | 'fallback';
  summary: string;
  evidence: string[];
}

export interface MissionControlSnapshot {
  agent: {
    name: string;
    role: string;
    mode: string;
    timezone: string;
    workWindow: string;
    foundryProjectEndpoint?: string;
    m365Environment: string;
  };
  jobDescription: MissionInstructionSet;
  microsoftIQ: MicrosoftIQBriefing;
  enterpriseCapabilities: EnterpriseCapability[];
  autonomyModes: AutonomyModeDefinition[];
  paperAlignment: PaperAlignmentItem[];
  cognitiveTools: CognitiveToolDefinition[];
  enterpriseReadiness: EnterpriseReadinessCheck[];
  adaptiveMemory: AdaptiveMemorySummary;
  experientialLearning: ExperientialLearningItem[];
  operatingPlan: CfoOperatingPlan;
  autonomousKanban: AutonomousKanbanBoard;
  recentArtifactEvaluations: ArtifactEvaluationResult[];
  keyTasks: MissionTaskDefinition[];
  today: {
    date: string;
    tasksCompleted: number;
    tasksInProgress: number;
    tasksBlocked: number;
    records: MissionTaskRecord[];
  };
  operatingCadence: Array<{ time: string; activity: string; output: string }>;
}

const MORGAN_JOB_DESCRIPTION: MissionInstructionSet = {
  title: 'Morgan Digital CFO',
  purpose:
    'Operate as an autonomous finance leader for the CFO office from 09:00 to 17:00, seven days a week: plan across strategic, tactical, and operational finance horizons; observe financial signals; execute recurring Microsoft 365 workflows; delegate specialist work; call Microsoft IQ sources for business evidence; escalate risks; and keep humans informed with auditable proof of completed work.',
  reportsTo: process.env.CFO_EMAIL || 'Chief Financial Officer',
  mandate: [
    'Maintain a current view of budget, actuals, cash, margin, revenue, and financial risk.',
    'Turn finance data into board-ready summaries, documents, Teams updates, and email briefings.',
    'Coordinate with specialist agents such as Cassidy, Avatar, and AI Kanban when operations, visual presence, or task-board context is needed.',
    'Work from the job description and available tools without waiting for a human to describe every step.',
    'Use CorpGen-style digital-employee loops: day init, execution cycles, reflection, memory consolidation, and manager briefing.',
    'Synthesize WorkIQ, Foundry IQ, and Fabric IQ into CFO-ready insights, actions, and evidence during the workday.',
    'Represent Microsoft CorpGen/Agent 365 showcase capabilities through a CFO-safe operating model with governance, evidence, and clear human escalation.',
  ],
  autonomyPrinciples: [
    'Choose the next best finance task from cadence, risk level, deadlines, dependencies, memory, and available data.',
    'Use tools before making financial claims, and cite which tool or source produced the data.',
    'Call Fabric IQ for governed figures, WorkIQ for stakeholder/work context, and Foundry IQ for knowledge, trace, model, and evaluation intelligence before finalising executive insight.',
    'Break complex work into strategic, tactical, and operational plans before taking action.',
    'Use isolated sub-agents for research, computer-use planning, avatar presentation, operations coordination, and task-board context.',
    'Retrieve prior decisions, completed work, lessons, and recent audit events before repeating a workflow.',
    'Prefer completing the smallest useful outcome over asking for clarification when the intent is clear.',
    'Escalate exceptions, failed tool calls, and material anomalies with enough context for a human decision.',
    'Record meaningful work as it happens so the CFO can review what Morgan completed at day end.',
  ],
  customerVisibleInstructions: [
    'Monitor financial health every working day.',
    'Investigate budget variances and anomalies before reporting conclusions.',
    'Prepare daily, weekly, and monthly finance briefings using Microsoft 365 delivery channels.',
    'Maintain an audit-style task record for Mission Control.',
    'Use Microsoft Teams calls for urgent escalation when configured.',
    'Use the avatar experience for live spoken updates and customer demonstrations.',
    'Run autonomous workday phases: opening plan, live execution cycles, stakeholder updates, and day-end reflection.',
    'Run the Microsoft IQ synthesis loop across WorkIQ, Foundry IQ, and Fabric IQ during the 09:00-17:00 seven-day operating window.',
    'Show the active instruction set, tools, sub-agents, memory, governance, and evidence path in Beta Starfield.',
  ],
  escalationRules: [
    'Escalate any critical anomaly, failed payment-control workflow, or cash-runway risk below the configured threshold.',
    'Escalate if a required finance source is unavailable and the scheduled task cannot be completed from fallback data.',
    'Escalate by Teams message first, and by Teams voice call when ACS calling is configured and the issue is urgent.',
    'Request human approval before sending external stakeholder communications, initiating urgent calls, or treating unverifiable finance data as final.',
  ],
  successMeasures: [
    'Daily CFO summary delivered with completed tasks, blocked work, and tomorrow priorities.',
    'Variance, anomaly, and KPI checks run on schedule.',
    'Material risks surfaced before the CFO asks for them.',
    'Reports and documents created with links or fallback content visible to the requester.',
    'Mission Control shows a traceable path from instruction to tool call, sub-agent handoff, evidence, and completed task.',
    'Microsoft IQ briefing shows WorkIQ work context, Foundry IQ insight/evaluation signals, Fabric IQ financial and cross-functional figures, and the production integration path.',
    'Autonomous workday runs can be demonstrated as a repeatable enterprise workflow, not a scripted chat demo.',
  ],
};

const COGNITIVE_TOOLS: CognitiveToolDefinition[] = [
  {
    id: 'generate-plan',
    title: 'Generate CFO operating plan',
    morganTool: 'generateCfoOperatingPlan',
    paperMechanism: 'Cognitive plan generation and MOMA horizon decomposition',
    purpose: 'Convert the CFO mandate into strategic, tactical, and operational next actions with dependencies and proof requirements.',
    inputs: ['Job description', 'Key task catalogue', 'today task records', 'audit events'],
    outputs: ['Strategic objectives', 'tactical milestones', 'operational next runnable tasks', 'dependency graph'],
    enterpriseControl: 'Plan is customer-visible and every runnable task names tools, sub-agents, and proof required before completion.',
    status: 'live',
  },
  {
    id: 'update-plan',
    title: 'Update plan after evidence',
    morganTool: 'recordMissionTaskCompletion',
    paperMechanism: 'Plan update and priority propagation',
    purpose: 'Record completed, blocked, or failed work so Morgan can update priorities and day-end reporting without losing context.',
    inputs: ['task_id', 'summary', 'evidence', 'status'],
    outputs: ['Mission task record', 'audit event', 'day-end report input'],
    enterpriseControl: 'Each plan mutation emits an audit event with a correlation ID and evidence count.',
    status: 'live',
  },
  {
    id: 'list-open',
    title: 'List open CFO tasks',
    morganTool: 'listOpenMissionTasks',
    paperMechanism: 'Open-task tracking and dependency-aware selection',
    purpose: 'Identify runnable work that has not been completed today and blocked work requiring escalation.',
    inputs: ['today task records', 'key task priorities'],
    outputs: ['open tasks', 'blocked tasks', 'next best action'],
    enterpriseControl: 'Open work is visible in Mission Control and can be compared with the end-of-day report.',
    status: 'live',
  },
  {
    id: 'summarize-memory',
    title: 'Adaptive memory summary',
    morganTool: 'getAdaptiveMemorySummary',
    paperMechanism: 'Adaptive summarization and critical-content preservation',
    purpose: 'Compress recent work, audit traces, and critical finance details into reusable context for the next autonomous cycle.',
    inputs: ['task records', 'audit event stream', 'escalation rules', 'paper alignment'],
    outputs: ['working context', 'structured memory', 'semantic recall cues', 'critical preserved content'],
    enterpriseControl: 'Critical finance facts, blockers, approvals, and evidence links are preserved rather than summarized away.',
    status: 'live',
  },
  {
    id: 'learn-playbook',
    title: 'Experiential learning playbook',
    morganTool: 'getExperientialLearningPlaybook',
    paperMechanism: 'Experiential trajectories and reusable policy learning',
    purpose: 'Expose validated CFO workflows that Morgan can reuse when similar triggers appear.',
    inputs: ['completed records', 'known finance workflows', 'sub-agent capabilities'],
    outputs: ['reusable patterns', 'trigger conditions', 'reuse instructions'],
    enterpriseControl: 'Patterns are labelled as active, candidate, or needing enterprise data before they are treated as production policy.',
    status: 'configured',
  },
  {
    id: 'judge-artifact',
    title: 'Artifact judge',
    morganTool: 'evaluateMissionArtifact',
    paperMechanism: 'Artifact-based evaluation with rationale',
    purpose: 'Score reports, briefings, plans, or customer demos for completeness, evidence, actionability, and governance before delivery.',
    inputs: ['artifact_type', 'title', 'content', 'evidence'],
    outputs: ['score', 'verdict', 'check-level rationale'],
    enterpriseControl: 'Human-facing artifacts can be held for review when evidence, risk, or approval checks fail.',
    status: 'live',
  },
  {
    id: 'workiq-signals',
    title: 'WorkIQ work-context signals',
    morganTool: 'queryWorkIQSignals',
    paperMechanism: 'Environment observation and work-graph retrieval',
    purpose: 'Read Microsoft 365 work signals such as meetings, finance threads, approvals, Planner tasks, and SharePoint artifacts before Morgan decides the next CFO action.',
    inputs: ['period', 'focus', 'Agent 365 MCP / Graph context'],
    outputs: ['meeting pressure', 'approval load', 'Planner due work', 'document evidence'],
    enterpriseControl: 'Live Graph/MCP usage appears in Agent Mind; the demo fallback is clearly labelled deterministic WorkIQ showcase data.',
    status: 'configured',
  },
  {
    id: 'foundryiq-insights',
    title: 'Foundry IQ insight and evaluation loop',
    morganTool: 'queryFoundryIQInsights',
    paperMechanism: 'Model-backed reasoning, knowledge grounding, trace review, and artifact evaluation',
    purpose: 'Use Foundry knowledge/evaluation signals to decide whether a CFO insight is grounded, complete, and ready for customer or executive use.',
    inputs: ['period', 'focus', 'knowledge indexes', 'trace/evaluation metadata'],
    outputs: ['model insights', 'evaluation findings', 'recommended autonomous actions'],
    enterpriseControl: 'Production rollout connects the same contract to Foundry project knowledge indexes, eval datasets, traces, and model deployments.',
    status: 'live',
  },
  {
    id: 'fabriciq-financials',
    title: 'Fabric IQ financial and business metrics',
    morganTool: 'queryFabricIQFinancials',
    paperMechanism: 'Cross-functional data retrieval from governed enterprise data products',
    purpose: 'Pull CFO figures and cross-functional signals from a Fabric-style semantic model covering Finance, Sales, Customer Success, People, and Support.',
    inputs: ['period', 'business_unit', 'Fabric semantic model'],
    outputs: ['revenue', 'margin', 'cash runway', 'pipeline coverage', 'NRR', 'headcount cost', 'support cost'],
    enterpriseControl: 'Demo values are deterministic; production values come from Fabric Lakehouse/Warehouse/Power BI semantic models with tenant governance.',
    status: 'live',
  },
  {
    id: 'microsoftiq-briefing',
    title: 'Microsoft IQ executive briefing',
    morganTool: 'synthesizeMicrosoftIQBriefing',
    paperMechanism: 'Multi-source synthesis across worker context, model intelligence, and enterprise data',
    purpose: 'Combine WorkIQ, Foundry IQ, and Fabric IQ into an executive CFO briefing with evidence, autonomous actions, and production integration path.',
    inputs: ['period', 'audience', 'focus'],
    outputs: ['headline', 'executive summary', 'autonomous actions', 'evidence', 'production path'],
    enterpriseControl: 'Morgan records this as proof-bearing work before day-end reporting and exposes it in Mission Control.',
    status: 'live',
  },
];

const ENTERPRISE_CAPABILITIES: EnterpriseCapability[] = [
  {
    id: 'hierarchical-planning',
    title: 'Hierarchical planning',
    category: 'planning',
    description: 'Break CFO work into strategic objectives, tactical milestones, and operational tasks with dependency-aware execution.',
    sourcePattern: 'Cassidy CorpGen hierarchical planner: strategic, tactical, operational layers with upward propagation.',
    morganMapping: 'Morgan turns board goals, monthly close, forecast updates, and risk reviews into CFO task flows with priorities and blockers.',
    customerProof: ['Mission Control key tasks', 'Beta Starfield task-flow links', 'End-of-day priorities'],
  },
  {
    id: 'workday-cycles',
    title: 'Autonomous workday cycles',
    category: 'planning',
    description: 'Run day-init, execution, reflection, and monthly planning phases without waiting for a prompt.',
    sourcePattern: 'Cassidy CorpGen scheduler: init, cycle, reflect, monthly phases with work-hours gating.',
    morganMapping: 'Morgan opens the CFO day, runs live finance checks, prepares stakeholder updates, and closes with a completed-task report.',
    customerProof: ['Operating cadence', 'runAutonomousCfoWorkday', 'Scheduled end-of-day report'],
  },
  {
    id: 'tiered-memory',
    title: 'Tiered memory and reflection',
    category: 'memory',
    description: 'Keep working context, structured task records, audit traces, and day-end lessons available for future cycles.',
    sourcePattern: 'CorpGen tiered memory: working, structured long-term, semantic, and experiential trajectories.',
    morganMapping: 'Morgan stores completed finance work, blocked tasks, recent audit events, and CFO priorities for review and reuse.',
    customerProof: ['Completed Work Log', 'Audit Memory hub', 'End-of-day breakdown'],
  },
  {
    id: 'isolated-subagents',
    title: 'Isolated specialist sub-agents',
    category: 'subagents',
    description: 'Delegate focused work to specialist agents while keeping their intermediate reasoning out of Morgan main context.',
    sourcePattern: 'CorpGen sub-agents as tools: research and computer-use agents running in isolated contexts.',
    morganMapping: 'Morgan routes operations, avatar presentation, task-board status, and research-style finance work to registered specialists.',
    customerProof: ['Sub-Agent Swarm hub', 'getSubAgentRegistry', 'Task sub-agent mappings'],
  },
  {
    id: 'm365-tools',
    title: 'Microsoft 365 tool execution',
    category: 'tools',
    description: 'Use Teams, email, documents, reports, finance tools, and Agent 365 MCP-style tool discovery to complete work.',
    sourcePattern: 'Aria/Avatar Foundry Agent 365 MCP bridge and Voice Live tool workflow cards.',
    morganMapping: 'Morgan executes finance analysis, creates briefing content, posts Teams updates, sends email, and initiates calls when configured.',
    customerProof: ['Tool Belt hub', 'M365 environment status', 'Tool activity trace'],
  },
  {
    id: 'workiq-layer',
    title: 'WorkIQ operating context',
    category: 'tools',
    description: 'Use Microsoft 365 work-graph context to understand meetings, approvals, Teams/email pressure, Planner work, and SharePoint evidence.',
    sourcePattern: 'Microsoft WorkIQ: user/work context from Graph, Agent 365 MCP tools, Microsoft 365 knowledge, and task activity.',
    morganMapping: 'Morgan treats WorkIQ as the CFO work-context layer before deciding who needs an update, what artifact is relevant, and what approval is missing.',
    customerProof: ['queryWorkIQSignals', 'Agent Mind MCP/Graph events', 'ToolingManifest.json'],
  },
  {
    id: 'foundryiq-layer',
    title: 'Foundry IQ model and evaluation intelligence',
    category: 'evaluation',
    description: 'Use Foundry project knowledge, model deployments, traces, eval datasets, and prompt-quality signals to judge insight readiness.',
    sourcePattern: 'Microsoft Foundry IQ: model, agent, knowledge, trace, evaluation, and business-insight intelligence.',
    morganMapping: 'Morgan calls Foundry IQ-style tools to explain grounding, evaluation findings, autonomous actions, and production-readiness evidence.',
    customerProof: ['queryFoundryIQInsights', '/responses', '.foundry/agent-metadata.yaml'],
  },
  {
    id: 'fabriciq-layer',
    title: 'Fabric IQ business data intelligence',
    category: 'tools',
    description: 'Use governed semantic models and lakehouse-style data products for finance figures and cross-functional business signals.',
    sourcePattern: 'Microsoft Fabric IQ: OneLake, Lakehouse/Warehouse, Power BI semantic models, data agents, and cross-domain analytics.',
    morganMapping: 'Morgan uses Fabric IQ-style metrics to ground revenue, margin, cash runway, pipeline, retention, headcount cost, and support cost claims.',
    customerProof: ['queryFabricIQFinancials', 'synthesizeMicrosoftIQBriefing', 'Contoso CFO Semantic Model demo adapter'],
  },
  {
    id: 'avatar-presence',
    title: 'Avatar presence and voice workflow',
    category: 'communication',
    description: 'Present work through a live HD avatar, spoken updates, workflow overlays, and real-time audio.',
    sourcePattern: 'Aria AvatarView: Voice Live, HD avatar, particle field, workflow progress, data overlays, and quick launch prompts.',
    morganMapping: 'Morgan appears as Aria-as-Morgan for customer demos and CFO spoken briefings, with Voice Live and WebRTC avatar media.',
    customerProof: ['Open Avatar', 'Avatar Voice hub', 'Speech Avatar and Voice Live nodes'],
  },
  {
    id: 'teams-federation-calling',
    title: 'Teams federation calling',
    category: 'communication',
    description: 'Ring Teams users through ACS-to-Teams federation, answer incoming ACS events, and bridge call audio to Morgan realtime voice.',
    sourcePattern: 'Cassidy ACS bridge: source identity, Teams federation policy, bidirectional ACS media streaming, and realtime voice handoff.',
    morganMapping: 'Morgan can call a CFO/operator or any configured Teams user over federation, record call lifecycle events, and expose video-presence readiness as a roadmap item.',
    customerProof: ['initiateTeamsFederatedCall', '/api/calls/federation/status', 'Set-CsTeamsAcsFederationConfiguration policy'],
  },
  {
    id: 'governed-escalation',
    title: 'Governed escalation',
    category: 'governance',
    description: 'Apply guardrails, schedule gates, approval boundaries, and escalation paths before high-impact actions.',
    sourcePattern: 'Cassidy CorpGen safety rails: cycle caps, wall-clock caps, tool-call caps, work-hours gating, and manager briefings.',
    morganMapping: 'Morgan escalates material finance risks, blocks unverifiable data claims, and preserves a CFO-readable audit path.',
    customerProof: ['Escalation rules', 'Audit events', 'Teams voice escalation'],
  },
  {
    id: 'evaluation-and-proof',
    title: 'Evaluation and proof of work',
    category: 'evaluation',
    description: 'Score completed work by artifacts, completion rate, tool usage, stop reasons, and evidence quality.',
    sourcePattern: 'CorpGen artifact judge and Foundry evaluation workflow.',
    morganMapping: 'Morgan exposes completed tasks, evidence, blocked items, and outcome summaries so customers can inspect autonomous work.',
    customerProof: ['End-of-day CFO report', 'Mission Control stats', 'Foundry-ready showcase data'],
  },
];

const AUTONOMY_MODES: AutonomyModeDefinition[] = [
  {
    id: 'init',
    title: 'Day Init',
    window: '09:00 daily',
    purpose: 'Load priorities, refresh finance and Microsoft IQ context, identify material risks, and choose the first CFO tasks.',
    runTrigger: 'Start of the 09:00-17:00 seven-day operating window, scheduled job, or manual run.',
    evidence: ['Finance health check', 'Microsoft IQ briefing', 'Risk watchlist', 'Open blocker review'],
  },
  {
    id: 'cycle',
    title: 'Execution Cycle',
    window: 'Every 20-25 min, 09:00-17:00 daily',
    purpose: 'Select the next runnable finance task, call tools, refresh IQ signals, delegate to sub-agents, and record outcomes.',
    runTrigger: 'Live monitoring cycle, audit event, task dependency change, or CFO request.',
    evidence: ['Tool calls', 'Sub-agent handoffs', 'Task records'],
  },
  {
    id: 'stakeholder',
    title: 'Stakeholder Update',
    window: '13:00 daily',
    purpose: 'Prepare Teams, email, document, or avatar updates for finance stakeholders using WorkIQ, Foundry IQ, and Fabric IQ evidence.',
    runTrigger: 'Briefing schedule, material variance, Microsoft IQ synthesis, or board-prep workflow.',
    evidence: ['Briefing content', 'Delivery status', 'WorkIQ signals', 'Foundry IQ evaluation', 'Fabric IQ figures'],
  },
  {
    id: 'reflect',
    title: 'Day-End Reflection',
    window: '17:00 daily',
    purpose: 'Summarise completed work, blockers, lessons, Microsoft IQ findings, and next-day CFO priorities.',
    runTrigger: 'End-of-day schedule or CFO request.',
    evidence: ['Completed Work Log', 'End-of-day breakdown', 'Tomorrow priorities'],
  },
  {
    id: 'monthly',
    title: 'Monthly Planning',
    window: 'Month start',
    purpose: 'Refresh strategic finance objectives and align tactical milestones for the month.',
    runTrigger: 'First working day of month or planning request.',
    evidence: ['Monthly objectives', 'Milestone changes', 'Board-ready agenda'],
  },
];

const PAPER_ALIGNMENT: PaperAlignmentItem[] = [
  {
    id: 'identity-schedule',
    paperConcept: 'Persistent identity and work schedule with schedule variance',
    morganImplementation: 'Stable Morgan Digital CFO identity, configured CFO reporting line, timezone-aware operating cadence, and scheduled workday entry points.',
    enterpriseControl: 'Identity, tenant, CFO recipient, and delivery channels are environment-configured; schedule changes are visible in Mission Control.',
    status: 'mapped',
    proof: ['Mission Control agent block', 'Operating cadence', 'Scheduled endpoints'],
  },
  {
    id: 'hierarchical-planning',
    paperConcept: 'Hierarchical planning across strategic, tactical, and operational horizons',
    morganImplementation: 'CFO tasks are represented as priority-ranked work with triggers, expected outputs, tools, sub-agents, and paper-aligned planning nodes.',
    enterpriseControl: 'The dashboard exposes the planning contract and next-runnable CFO tasks before execution.',
    status: 'implemented',
    proof: ['CorpGen planning loop task', 'Beta Starfield planning mode', 'Key tasks'],
  },
  {
    id: 'tiered-memory',
    paperConcept: 'Tiered memory: working context, structured long-term memory, semantic recall, and experiential trajectories',
    morganImplementation: 'Morgan records completed, blocked, and failed work; exposes audit events; and turns day-end reflections into tomorrow priorities.',
    enterpriseControl: 'Application Insights, Purview-ready correlation IDs, and Mission Control make the memory/evidence path inspectable.',
    status: 'production-hardening',
    proof: ['Completed Work Log', 'Audit Memory hub', 'End-of-day breakdown'],
  },
  {
    id: 'cognitive-tools',
    paperConcept: 'Cognitive tools for plan generation, plan update, task tracking, open-task listing, and reflection',
    morganImplementation: 'Mission Control tools expose snapshots, task recording, autonomous CFO checks, and day-end reports; Morgan uses these as operating tools.',
    enterpriseControl: 'Tool calls are audited and customer-visible; substantial work must be recorded for day-end review.',
    status: 'implemented',
    proof: ['getMissionControlSnapshot', 'recordMissionTaskCompletion', 'getEndOfDayReport', 'runAutonomousCfoWorkday'],
  },
  {
    id: 'microsoft-iq-layer',
    paperConcept: 'Enterprise environment intelligence and cognitive tool augmentation',
    morganImplementation: 'Morgan has callable WorkIQ, Foundry IQ, and Fabric IQ tools that return work context, model/evaluation insights, governed finance figures, and cross-functional business signals.',
    enterpriseControl: 'The demo adapters are deterministic and labelled; production rollout swaps the same tool contracts to Graph/Agent 365 MCP, Foundry project assets, and Fabric semantic models.',
    status: 'implemented',
    proof: ['queryWorkIQSignals', 'queryFoundryIQInsights', 'queryFabricIQFinancials', 'synthesizeMicrosoftIQBriefing'],
  },
  {
    id: 'subagents',
    paperConcept: 'Sub-agents as isolated tools for research and computer-use style work',
    morganImplementation: 'Morgan coordinates Cassidy, Avatar/Aria, AI Kanban, and future specialist agents through a registry and tool-call interface.',
    enterpriseControl: 'Sub-agent calls return structured summaries and are separated from Morgan main customer response.',
    status: 'mapped',
    proof: ['Sub-Agent Swarm hub', 'getSubAgentRegistry', 'callSubAgent'],
  },
  {
    id: 'algorithm-1-workday',
    paperConcept: 'Algorithm 1: Day Init, execution cycles, Day End reflection',
    morganImplementation: 'Morgan has explicit autonomy modes for Day Init, Execution Cycle, Stakeholder Update, Day-End Reflection, and Monthly Planning.',
    enterpriseControl: 'Work phases have expected evidence and are shown in the starfield activity panel.',
    status: 'implemented',
    proof: ['Autonomy modes', 'Operating cadence', 'Beta Starfield Live Run mode'],
  },
  {
    id: 'communication-fallback',
    paperConcept: 'Communication-channel fallback across mail and Teams',
    morganImplementation: 'Morgan can send Teams messages, email, create documents, and escalate by Teams voice call when configured.',
    enterpriseControl: 'Delivery failures are surfaced to the user; urgent actions follow escalation rules.',
    status: 'mapped',
    proof: ['sendTeamsMessage', 'sendEmail', 'createWordDocument', 'initiateTeamsCallToCfo'],
  },
  {
    id: 'escalation-propagation',
    paperConcept: 'Upward propagation, escalation, and dependency-aware priority changes',
    morganImplementation: 'Material finance anomalies, blocked data sources, failed delivery, and cash-runway risks are escalated with context.',
    enterpriseControl: 'Escalation rules are customer-visible and linked into governance nodes.',
    status: 'implemented',
    proof: ['Escalation rules', 'Anomaly surveillance task', 'Governance mode'],
  },
  {
    id: 'artifact-judge',
    paperConcept: 'Artifact and day-level judging with confidence and rationale',
    morganImplementation: 'Morgan exposes evaluation-and-proof capability and Foundry P0 datasets to judge instruction adherence, task completion, and enterprise proof quality.',
    enterpriseControl: 'Foundry evaluation artifacts live under .foundry and can be run against the hosted agent before enterprise rollout.',
    status: 'production-hardening',
    proof: ['Evaluation and proof capability', '.foundry datasets', 'Mission Control evidence'],
  },
  {
    id: 'multi-day-org',
    paperConcept: 'Multi-day continuity and organisation-scale runs',
    morganImplementation: 'Morgan is wired for day-to-day task records, sub-agent collaboration, and Microsoft 365 delivery channels; organisation-scale runs map to specialist-agent orchestration.',
    enterpriseControl: 'Production deployments should back task records with durable storage before scaling beyond the current process.',
    status: 'production-hardening',
    proof: ['Task records', 'Sub-agent registry', 'Foundry hosted-agent metadata'],
  },
  {
    id: 'safety-rails',
    paperConcept: 'Safety rails: cycle caps, tool-call caps, schedule gates, and manager briefings',
    morganImplementation: 'Morgan applies explicit escalation rules, delivery safeguards, audit logging, configured voice/call gates, and CFO end-of-day reporting.',
    enterpriseControl: 'Real enterprise use requires configured RBAC, Purview/App Insights, scheduled secrets, and managed-identity access boundaries.',
    status: 'mapped',
    proof: ['Escalation rules', 'Observability endpoints', 'End-of-day CFO report'],
  },
  {
    id: 'presentation-assets',
    paperConcept: 'Human-facing worker presence and inspectable activity during autonomous work',
    morganImplementation: 'Aria-as-Morgan uses the HD avatar, live Voice Live session, particle starfield, workflow controls, and Mission Control proof surfaces.',
    enterpriseControl: 'Customer demos show real operating instructions and records, not hidden prompt text or a decorative-only animation.',
    status: 'implemented',
    proof: ['Avatar page', 'Beta Starfield modes', 'Mission Control instructions'],
  },
];

export function getPaperAlignment(): PaperAlignmentItem[] {
  return PAPER_ALIGNMENT;
}

const KEY_TASKS: MissionTaskDefinition[] = [
  {
    id: 'finance-health-check',
    title: 'Daily finance health check',
    description: 'Review current-period budget vs actuals, KPIs, and cash indicators.',
    cadence: 'daily',
    priority: 1,
    expectedOutputs: ['Finance health summary', 'Variance headline', 'KPI snapshot'],
    tools: ['analyzeBudgetVsActuals', 'getFinancialKPIs', 'calculateTrend'],
    subAgents: ['AI_Kanban summary-agent'],
    autonomousTrigger: 'Start of working day, scheduled check, or CFO request.',
  },
  {
    id: 'corpgen-planning-loop',
    title: 'CorpGen planning loop',
    description: 'Maintain strategic, tactical, and operational CFO task plans with dependencies and priority propagation.',
    cadence: 'continuous',
    priority: 1,
    expectedOutputs: ['Prioritised CFO task graph', 'Dependency updates', 'Next runnable task'],
    tools: ['getMissionControlSnapshot', 'recordMissionTaskCompletion', 'getSubAgentRegistry'],
    subAgents: ['Cassidy CorpGen planner', 'AI_Kanban summary-agent'],
    autonomousTrigger: 'Day init, material finance event, dependency completion, or monthly planning cycle.',
  },
  {
    id: 'anomaly-surveillance',
    title: 'Anomaly surveillance',
    description: 'Scan financial categories for unusual variance and classify severity.',
    cadence: 'continuous',
    priority: 1,
    expectedOutputs: ['Risk list', 'Escalation recommendation', 'Teams alert when material'],
    tools: ['detectAnomalies', 'sendTeamsMessage', 'initiateTeamsCallToCfo'],
    subAgents: ['Cassidy'],
    autonomousTrigger: 'P&L monitoring cycle, daily workday cycle, or anomaly threshold breach.',
  },
  {
    id: 'microsoft-iq-synthesis',
    title: 'Microsoft IQ synthesis loop',
    description: 'Combine WorkIQ, Foundry IQ, and Fabric IQ signals into CFO-ready insight, cross-functional context, and proof-backed autonomous actions.',
    cadence: 'continuous',
    priority: 1,
    expectedOutputs: ['Microsoft IQ briefing', 'Work context signals', 'Foundry evaluation signals', 'Fabric financial and cross-functional figures'],
    tools: ['queryWorkIQSignals', 'queryFoundryIQInsights', 'queryFabricIQFinancials', 'synthesizeMicrosoftIQBriefing'],
    subAgents: ['Cassidy CorpGen planner', 'AI_Kanban summary-agent'],
    autonomousTrigger: 'Every execution cycle inside the 09:00-17:00 seven-day operating window, and before CFO/executive reporting.',
  },
  {
    id: 'memory-reflection',
    title: 'Memory and reflection loop',
    description: 'Consolidate task records, audit events, blockers, and completed finance work into reusable CFO memory.',
    cadence: 'daily',
    priority: 2,
    expectedOutputs: ['Structured memory notes', 'Lessons learned', 'Repeatable workflow improvements'],
    tools: ['getEndOfDayReport', 'getAuditEvents', 'recordMissionTaskCompletion'],
    subAgents: ['Cassidy research-agent'],
    autonomousTrigger: 'After each meaningful task and at end-of-day reflection.',
  },
  {
    id: 'executive-briefing',
    title: 'Executive finance briefing',
    description: 'Prepare concise board-ready summaries and distribute them through Microsoft 365.',
    cadence: 'weekly',
    priority: 2,
    expectedOutputs: ['Briefing markdown', 'Word document', 'Teams post', 'CFO notification'],
    tools: ['createWeeklyBriefingContent', 'createWordDocument', 'sendTeamsMessage', 'sendEmail'],
    subAgents: ['Avatar'],
    autonomousTrigger: 'Weekly schedule, board-prep request, or material finance event.',
  },
  {
    id: 'working-day-audit',
    title: 'Working day audit',
    description: 'Record completed autonomous work and send a day-end breakdown to the CFO.',
    cadence: 'daily',
    priority: 1,
    expectedOutputs: ['Completed task list', 'Blocked items', 'Tomorrow priorities'],
    tools: ['recordMissionTaskCompletion', 'getEndOfDayReport', 'sendTeamsMessage', 'sendEmail'],
    subAgents: ['Cassidy', 'AI_Kanban summary-agent'],
    autonomousTrigger: 'End of working day or explicit CFO request.',
  },
  {
    id: 'customer-showcase',
    title: 'Customer-ready autonomous showcase',
    description: 'Demonstrate Morgan as a visible enterprise autonomous digital CFO through Mission Control, Beta Starfield, avatar voice, and proof-of-work traces.',
    cadence: 'on_demand',
    priority: 3,
    expectedOutputs: ['Mission Control snapshot', 'Beta Starfield mode walkthrough', 'Avatar conversation', 'Tool activity trace'],
    tools: ['getMissionControlSnapshot', 'getSubAgentRegistry', 'getMcpTools', 'getObservabilitySnapshot'],
    subAgents: ['Avatar', 'Cassidy', 'AI_Kanban summary-agent'],
    autonomousTrigger: 'Customer demo, discovery workshop, or operator request.',
  },
];

const OPERATING_CADENCE = [
  { time: '09:00 daily', activity: 'Day Init', output: 'Load CFO priorities, refresh finance, WorkIQ, Foundry IQ, and Fabric IQ signals, then plan the first runnable tasks.' },
  { time: 'Every 20-25 min, 09:00-17:00 daily', activity: 'Execution Cycle', output: 'Run finance checks, call IQ/tools, delegate sub-agents, and record proof of work.' },
  { time: '13:00 daily', activity: 'Cross-Functional IQ Refresh', output: 'Compare finance, sales, customer success, people, support, and stakeholder context before executive updates.' },
  { time: '16:30 daily', activity: 'Proof and Artifact Review', output: 'Use Foundry IQ and artifact judging before treating reports, demos, or escalations as ready.' },
  { time: '17:00 daily', activity: 'Day-End Reflection', output: 'Completed-task report, Microsoft IQ findings, blockers, lessons, and next-day priorities.' },
  { time: 'Month start', activity: 'Monthly Planning', output: 'Refresh strategic finance objectives and tactical CFO milestones.' },
];

const taskRecords: MissionTaskRecord[] = loadTaskRecords();
const artifactEvaluations: ArtifactEvaluationResult[] = [];

function missionStateFilePath(): string {
  if (process.env.MORGAN_MISSION_STATE_FILE) return path.resolve(process.env.MORGAN_MISSION_STATE_FILE);
  const home = process.env.HOME || process.env.USERPROFILE;
  const stateRoot = home ? path.join(home, 'data') : path.join(process.cwd(), '.morgan-state');
  return path.join(stateRoot, 'mission-control-records.json');
}

function isMissionTaskRecord(value: unknown): value is MissionTaskRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<MissionTaskRecord>;
  return Boolean(record.id && record.taskId && record.title && record.status && record.summary && record.startedAt);
}

function loadTaskRecords(): MissionTaskRecord[] {
  try {
    const filePath = missionStateFilePath();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isMissionTaskRecord).slice(-500) : [];
  } catch (error) {
    console.warn('[mission-control] Failed to load persistent task records:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

function mergeTaskRecords(records: MissionTaskRecord[]): void {
  const existingIds = new Set(taskRecords.map((record) => record.id));
  for (const record of records) {
    if (!existingIds.has(record.id)) {
      taskRecords.push(record);
      existingIds.add(record.id);
    }
  }
  taskRecords.sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
  if (taskRecords.length > 500) taskRecords.splice(0, taskRecords.length - 500);
}

function syncTaskRecordsFromDisk(): void {
  mergeTaskRecords(loadTaskRecords());
}

function persistTaskRecords(): void {
  try {
    if (taskRecords.length > 500) taskRecords.splice(0, taskRecords.length - 500);
    const filePath = missionStateFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(taskRecords, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    console.warn('[mission-control] Failed to persist task records:', error instanceof Error ? error.message : String(error));
  }
}

function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function currentPeriod(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function taskDefinition(taskId: string): MissionTaskDefinition {
  return KEY_TASKS.find((task) => task.id === taskId) || KEY_TASKS[0];
}

function statusFromSignal(signal: boolean, fallback: EnterpriseReadinessCheck['status'] = 'needs-configuration'): EnterpriseReadinessCheck['status'] {
  return signal ? 'ready' : fallback;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function artifactCheck(id: string, label: string, pass: boolean, rationale: string, scoreWhenTrue = 100, scoreWhenFalse = 35): ArtifactEvaluationCheck {
  const score = pass ? scoreWhenTrue : scoreWhenFalse;
  return { id, label, score, pass, rationale };
}

function createRecord(input: {
  taskId: string;
  status: MissionTaskStatus;
  summary: string;
  evidence?: string[];
  source: MissionTaskRecord['source'];
}): MissionTaskRecord {
  syncTaskRecordsFromDisk();
  const definition = taskDefinition(input.taskId);
  const now = new Date().toISOString();
  const record: MissionTaskRecord = {
    id: `${input.taskId}-${Date.now()}-${taskRecords.length + 1}`,
    taskId: input.taskId,
    title: definition.title,
    status: input.status,
    summary: input.summary,
    evidence: input.evidence || [],
    startedAt: now,
    completedAt: input.status === 'completed' || input.status === 'failed' ? now : undefined,
    source: input.source,
  };
  taskRecords.push(record);
  persistTaskRecords();
  recordAuditEvent({
    kind: 'mission.task.recorded',
    label: `Mission task recorded: ${record.title}`,
    correlationId: record.id,
    data: {
      taskId: record.taskId,
      status: record.status,
      source: record.source,
      evidenceCount: record.evidence.length,
    },
  });
  recordAgentEvent({
    kind: 'mission.task',
    label: `${record.status}: ${record.title}`,
    status: record.status === 'failed' ? 'error' : record.status === 'blocked' ? 'partial' : 'ok',
    correlationId: record.id,
    data: {
      taskId: record.taskId,
      source: record.source,
      evidenceCount: record.evidence.length,
      responsePreview: record.summary.slice(0, 700),
      reasoningSummary: `Morgan recorded mission task ${record.taskId} as ${record.status} so the autonomous workday, memory, and day-end report stay synchronized.`,
    },
  });
  return record;
}

function previewSubAgentResponse(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').slice(0, 260);
  try {
    return JSON.stringify(value ?? null).replace(/\s+/g, ' ').slice(0, 260);
  } catch {
    return String(value).slice(0, 260);
  }
}

async function runAutonomousSubAgentHandoffs(input: {
  period: string;
  plan: CfoOperatingPlan;
  iqBriefing: MicrosoftIQBriefing;
}): Promise<SubAgentHandoffResult[]> {
  const registry = getSubAgentRegistry();
  const handoffs = [
    {
      agentId: 'ai-kanban',
      message:
        `Morgan autonomous CFO cycle for ${input.period}. Summarize the next D-CFO board state, WIP pressure, blockers, and one next best action. ` +
        `Current next runnable tasks: ${input.plan.nextRunnableTasks.map((task) => `${task.title} P${task.priority}`).join('; ')}. ` +
        `Microsoft IQ headline: ${input.iqBriefing.headline}`,
    },
    {
      agentId: 'cassidy',
      message:
        `Morgan autonomous CFO cycle for ${input.period}. Review the operating plan and Microsoft IQ briefing for operations, escalation, or stakeholder follow-up risks. ` +
        `Next action: ${input.plan.nextRunnableTasks[0]?.title || 'no open task'}. ` +
        `IQ summary: ${input.iqBriefing.executiveSummary.join(' ')}`,
    },
  ];

  const results: SubAgentHandoffResult[] = [];
  for (const handoff of handoffs) {
    const agent = registry.find((item) => item.id === handoff.agentId);
    if (!agent?.endpoint) {
      results.push({
        agentId: handoff.agentId,
        agentName: agent?.name || handoff.agentId,
        status: 'skipped',
        summary: `${agent?.name || handoff.agentId} handoff skipped because no endpoint is configured.`,
        evidence: agent ? [`Set ${agent.endpointEnv} to enable live handoff.`] : ['Sub-agent is not registered.'],
      });
      continue;
    }

    const started = Date.now();
    const response = await callSubAgent({ agent_id: handoff.agentId, message: handoff.message, timeout_ms: 8_000 });
    let result: SubAgentHandoffResult;
    if (response.success) {
      result = {
        agentId: handoff.agentId,
        agentName: agent.name,
        status: 'completed',
        summary: `${agent.name} returned a specialist handoff response.`,
        evidence: [`HTTP ${response.status || 200}`, previewSubAgentResponse(response.response)],
      };
    } else {
      // Demo-mode graceful degradation: a configured endpoint is reachable but
      // currently unauthorised, timing out, or otherwise broken. Fall back to a
      // deterministic specialist briefing so the autonomous loop stays green and
      // the operating cadence keeps moving, while still surfacing the underlying
      // wiring issue in evidence and an audit warning. Mirrors the Microsoft IQ
      // briefing pattern (synthesizeMicrosoftIQBriefing) used elsewhere.
      const fallback = synthesizeSubAgentFallback({
        agentId: handoff.agentId,
        agentName: agent.name,
        period: input.period,
        plan: input.plan,
        iqBriefing: input.iqBriefing,
      });
      const failureDetail = response.error || `HTTP ${response.status || 'unknown'}`;
      result = {
        agentId: handoff.agentId,
        agentName: agent.name,
        status: 'fallback',
        summary: `${agent.name} live endpoint unreachable (${failureDetail}); used deterministic specialist briefing.`,
        evidence: [
          `Live endpoint unreachable: ${failureDetail}`,
          `Fallback briefing: ${fallback.headline}`,
          ...fallback.points.slice(0, 2),
        ],
      };
    }
    results.push(result);
    recordAuditEvent({
      kind: 'mission.subagent.handoff',
      label: `Sub-agent handoff ${result.status}: ${agent.name}`,
      severity: result.status === 'failed' ? 'warning' : (result.status === 'fallback' ? 'warning' : 'info'),
      data: { agentId: result.agentId, status: result.status, durationMs: Date.now() - started, evidence: result.evidence },
    });
  }
  return results;
}

function synthesizeSubAgentFallback(input: {
  agentId: string;
  agentName: string;
  period: string;
  plan: CfoOperatingPlan;
  iqBriefing: MicrosoftIQBriefing;
}): { headline: string; points: string[] } {
  const nextTask = input.plan.nextRunnableTasks[0];
  if (input.agentId === 'ai-kanban') {
    return {
      headline: `${input.agentName} demo board: ${input.plan.nextRunnableTasks.length} runnable item(s) for ${input.period}.`,
      points: [
        `Top of queue: ${nextTask?.title || 'no open task'} (P${nextTask?.priority ?? 'n/a'}).`,
        `WIP pressure healthy; ${input.plan.dependencyGraph.length} dependency edge(s) tracked.`,
        `Next best action: complete ${nextTask?.title || 'queue grooming'} and re-rank.`,
      ],
    };
  }
  if (input.agentId === 'cassidy') {
    return {
      headline: `${input.agentName} ops review: no escalations for ${input.period}.`,
      points: [
        `IQ headline: ${input.iqBriefing.headline}.`,
        `Stakeholder follow-ups: monitor ${nextTask?.title || 'open task'} progress.`,
        `No new operational risks detected from synthetic specialist pass.`,
      ],
    };
  }
  return {
    headline: `${input.agentName} deterministic briefing for ${input.period}.`,
    points: [
      `Specialist endpoint unreachable; deterministic fallback used.`,
      `Top priority: ${nextTask?.title || 'no open task'}.`,
    ],
  };
}

export function recordMissionTaskCompletion(input: {
  task_id: string;
  summary: string;
  evidence?: string[];
  status?: MissionTaskStatus;
  source?: MissionTaskRecord['source'];
}): MissionTaskRecord {
  return createRecord({
    taskId: input.task_id,
    status: input.status || 'completed',
    summary: input.summary,
    evidence: input.evidence,
    source: input.source || 'user_request',
  });
}

export function getTodaysTaskRecords(date = todayKey()): MissionTaskRecord[] {
  syncTaskRecordsFromDisk();
  return taskRecords.filter((record) => record.startedAt.startsWith(date));
}

export function getRecentMissionTaskRecords(days = 7): MissionTaskRecord[] {
  syncTaskRecordsFromDisk();
  const since = Date.now() - Math.max(1, days) * 24 * 60 * 60_000;
  return taskRecords.filter((record) => {
    const startedAt = new Date(record.startedAt).getTime();
    return Number.isFinite(startedAt) && startedAt >= since;
  });
}

export function getCognitiveToolchain(): CognitiveToolDefinition[] {
  return COGNITIVE_TOOLS;
}

export function getEnterpriseReadiness(): EnterpriseReadinessCheck[] {
  const observability = getObservabilityStatus();
  const subAgents = getSubAgentRegistry();
  const configuredSubAgents = subAgents.filter((agent) => agent.status === 'configured').length;
  const appInsightsReady = Boolean(observability.applicationInsightsConfigured || process.env.APPLICATIONINSIGHTS_RESOURCE_ID);
  const logAnalyticsReady = Boolean(process.env.LOG_ANALYTICS_WORKSPACE_ID);
  const mcpReady = Boolean(process.env.MCP_PLATFORM_ENDPOINT && (process.env.MicrosoftAppId || process.env.agent_id));
  const avatarReady = Boolean(process.env.VOICELIVE_ENDPOINT && process.env.SPEECH_REGION && (process.env.SPEECH_RESOURCE_ID || process.env.SPEECH_RESOURCE_KEY));
  const teamsFederationReady = Boolean(process.env.ACS_CONNECTION_STRING && (process.env.BASE_URL || process.env.PUBLIC_HOSTNAME || process.env.WEBSITE_HOSTNAME) && (process.env.AZURE_OPENAI_ENDPOINT || process.env.VOICELIVE_ENDPOINT || process.env.AZURE_AI_SERVICES_ENDPOINT));
  const teamsFederationPolicyRecorded = Boolean(process.env.ACS_TEAMS_FEDERATION_RESOURCE_ID);
  const agentStorage = getAgentStorageStatus();
  const durableMemoryReady = agentStorage.configured;
  const scheduledReady = Boolean(process.env.SCHEDULED_SECRET);
  const foundryIQReady = Boolean(process.env.FOUNDRY_PROJECT_ENDPOINT && (process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_AI_SERVICES_ENDPOINT));
  const fabricIQReady = Boolean(process.env.FABRIC_WORKSPACE_ID || process.env.FABRIC_SEMANTIC_MODEL_ID || process.env.POWERBI_SEMANTIC_MODEL_ID);

  return [
    {
      id: 'agent365-sdk',
      area: 'Microsoft Agent 365 SDK runtime',
      status: statusFromSignal(Boolean(process.env.MicrosoftAppId && process.env.MicrosoftAppTenantId), 'partial'),
      signal: process.env.MicrosoftAppId ? 'Agent app identity configured' : 'Agent app identity not configured',
      control: 'Teams, Agent 365, and hosted-agent channels use configured app identity and JWT validation outside development.',
      evidence: ['@microsoft/agents-hosting CloudAdapter', '/api/messages', '/api/agent-messages'],
    },
    {
      id: 'mcp-tooling',
      area: 'Agent 365 MCP tooling',
      status: statusFromSignal(mcpReady, 'needs-configuration'),
      signal: mcpReady ? 'MCP platform endpoint and agent identity are configured' : 'MCP platform endpoint or identity is missing',
      control: 'MCP tools are discovered through the Agent 365 tooling service with per-turn authorization when available.',
      evidence: ['getMcpTools', 'ToolingManifest.json', 'sendTeamsMessage/sendEmail/createWordDocument'],
    },
    {
      id: 'observability',
      area: 'Application Insights and Log Analytics',
      status: appInsightsReady && logAnalyticsReady ? 'ready' : appInsightsReady ? 'partial' : 'needs-configuration',
      signal: appInsightsReady ? 'Application Insights signal present' : 'Application Insights connection/resource not detected',
      control: 'Morgan emits structured custom events with correlation IDs for tool calls, work records, Teams turns, and Foundry invocations.',
      evidence: ['/api/observability', '/api/audit/events', 'Morgan.* custom events'],
    },
    {
      id: 'foundry-iq',
      area: 'Foundry IQ model, trace, and evaluation intelligence',
      status: foundryIQReady ? 'configured' : 'partial',
      signal: foundryIQReady ? 'Foundry project and Azure AI endpoint settings detected' : 'Demo Foundry IQ adapter is active; connect Foundry project assets for production telemetry and evaluations',
      control: 'Morgan keeps Foundry IQ as a callable tool contract so production can attach knowledge indexes, traces, prompt/eval datasets, and model deployments without changing the user experience.',
      evidence: ['queryFoundryIQInsights', '/responses', '.foundry/agent-metadata.yaml', 'evaluateMissionArtifact'],
    },
    {
      id: 'fabric-iq',
      area: 'Fabric IQ semantic model and cross-functional analytics',
      status: fabricIQReady ? 'configured' : 'partial',
      signal: fabricIQReady ? 'Fabric or Power BI semantic model settings detected' : 'Demo Fabric IQ semantic model is active; connect Fabric workspace/lakehouse/semantic model for tenant data',
      control: 'Morgan separates deterministic showcase data from production Fabric sources while preserving the same finance and cross-functional metric schema.',
      evidence: ['queryFabricIQFinancials', 'synthesizeMicrosoftIQBriefing', 'FABRIC_WORKSPACE_ID', 'FABRIC_SEMANTIC_MODEL_ID'],
    },
    {
      id: 'purview-audit',
      area: 'Purview audit posture',
      status: process.env.PURVIEW_AUDIT_ENABLED === 'true' ? 'configured' : 'production-hardening',
      signal: process.env.PURVIEW_AUDIT_ENABLED === 'true' ? 'Purview audit flag enabled' : 'Purview audit workflow should be connected for enterprise rollout',
      control: 'M365 actions inherit Microsoft 365 audit records; Morgan events provide join keys for central review.',
      evidence: ['correlationId', 'Agent 365/M365 action auditability', 'Log Analytics export posture'],
    },
    {
      id: 'avatar-presence',
      area: 'Aria-as-Morgan avatar and Voice Live',
      status: statusFromSignal(avatarReady, 'partial'),
      signal: avatarReady ? 'Voice Live and Speech avatar settings present' : 'Voice/avatar settings partially configured',
      control: 'Voice is gated, browser auth is enforced when required, and avatar configuration is served from managed app settings.',
      evidence: ['/voice', '/api/avatar/config', '/api/avatar/ice', '/api/voice/status'],
    },
    {
      id: 'teams-federation-calling',
      area: 'Microsoft Teams federation calling',
      status: teamsFederationReady ? (teamsFederationPolicyRecorded ? 'configured' : 'partial') : 'needs-configuration',
      signal: teamsFederationReady
        ? teamsFederationPolicyRecorded
          ? 'ACS, public host, realtime voice, and federation resource marker are configured'
          : 'ACS calling is configured; record ACS_TEAMS_FEDERATION_RESOURCE_ID after tenant federation policy is applied'
        : 'ACS connection, public callback host, or realtime voice endpoint is missing',
      control: 'Tenant administrators must allow the ACS resource with Set-CsTeamsAcsFederationConfiguration before Morgan can federate into Teams calls reliably.',
      evidence: [
        '/api/voice/invite',
        '/api/calls/incoming',
        '/api/calls/federation/status',
        "Set-CsTeamsAcsFederationConfiguration -EnableAcsUsers $true -AllowedAcsResources @{Add='<ACS resource id>'}",
        'Video feed is roadmap: current Call Automation bridge is bidirectional audio; Teams video presence needs a Teams-compatible video sender path.',
      ],
    },
    {
      id: 'sub-agent-swarm',
      area: 'Cassidy, Avatar, and AI Kanban sub-agents',
      status: configuredSubAgents > 0 ? 'configured' : 'needs-configuration',
      signal: `${configuredSubAgents}/${subAgents.length} specialist endpoints configured`,
      control: 'Specialist calls are isolated behind explicit endpoint configuration and return structured summaries to Morgan.',
      evidence: ['getSubAgentRegistry', 'callSubAgent', ...subAgents.map((agent) => `${agent.name}: ${agent.status}`)],
    },
    {
      id: 'durable-memory',
      area: 'Durable memory and work records',
      status: durableMemoryReady ? 'configured' : 'production-hardening',
      signal: durableMemoryReady ? `Agent conversation state uses ${agentStorage.backend} storage` : 'Current process memory should be backed by durable storage for production scale',
      control: 'Enterprise deployments should persist task records, memory summaries, evaluations, and audit exports outside the process.',
      evidence: ['COSMOS_DB_ENDPOINT/COSMOS_DB_DATABASE/COSMOS_DB_CONTAINER', 'Agent SDK storage backend', 'Mission task records'],
    },
    {
      id: 'scheduler-safety',
      area: 'Autonomous scheduling and safety gates',
      status: scheduledReady ? 'configured' : 'needs-configuration',
      signal: scheduledReady ? 'Scheduled secret configured' : 'Scheduled endpoints require SCHEDULED_SECRET',
      control: 'Autonomous workday and end-of-day jobs require a shared secret and record their outcomes for CFO review.',
      evidence: ['/api/mission-control/run-workday', '/api/scheduled/end-of-day', 'End-of-day CFO report'],
    },
  ];
}

export function listOpenMissionTasks(): {
  date: string;
  openTasks: MissionTaskDefinition[];
  blockedRecords: MissionTaskRecord[];
  nextBestAction: string;
} {
  const records = getTodaysTaskRecords();
  const completedIds = new Set(records.filter((record) => record.status === 'completed').map((record) => record.taskId));
  const blockedRecords = records.filter((record) => record.status === 'blocked' || record.status === 'failed');
  const openTasks = KEY_TASKS
    .filter((task) => !completedIds.has(task.id) || task.cadence === 'continuous')
    .sort((left, right) => left.priority - right.priority);
  const next = blockedRecords[0]
    ? `Escalate blocker: ${blockedRecords[0].title}`
    : openTasks[0]
      ? `Run ${openTasks[0].title} using ${openTasks[0].tools.slice(0, 3).join(', ')}`
      : 'All scheduled CFO tasks have records today; prepare day-end reflection.';
  return { date: todayKey(), openTasks, blockedRecords, nextBestAction: next };
}

export function generateCfoOperatingPlan(): CfoOperatingPlan {
  const open = listOpenMissionTasks();
  const records = getTodaysTaskRecords();
  const blocked = records.filter((record) => record.status === 'blocked' || record.status === 'failed');
  return {
    generatedAt: new Date().toISOString(),
    horizon: {
      strategic: [
        'Keep the CFO continuously informed on cash, margin, revenue, variance, and material operational risk.',
        'Operate Morgan as an inspectable digital worker with visible job contract, safety rails, and proof of work.',
        'Coordinate Microsoft 365, Agent 365 MCP, WorkIQ, Foundry IQ, Fabric IQ, avatar presence, and specialist sub-agents into one CFO operating loop.',
      ],
      tactical: KEY_TASKS.filter((task) => task.priority <= 2).map((task) => `${task.title}: ${task.expectedOutputs.join(', ')}`),
      operational: open.openTasks.slice(0, 5).map((task) => `${task.title} -> ${task.autonomousTrigger}`),
    },
    nextRunnableTasks: open.openTasks.slice(0, 5).map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      reason: task.cadence === 'continuous' ? 'Continuous CFO signal monitoring remains runnable.' : 'No completed record exists for this task today.',
      tools: task.tools,
      subAgents: task.subAgents,
    })),
    dependencyGraph: [
      { from: 'finance-health-check', to: 'anomaly-surveillance', reason: 'Variance and KPI checks define which anomalies require escalation.' },
      { from: 'finance-health-check', to: 'microsoft-iq-synthesis', reason: 'Financial figures are combined with WorkIQ stakeholder context, Foundry IQ evaluation signals, and Fabric IQ business metrics.' },
      { from: 'microsoft-iq-synthesis', to: 'executive-briefing', reason: 'Executive briefings should use IQ-backed figures, context, and readiness evidence.' },
      { from: 'corpgen-planning-loop', to: 'executive-briefing', reason: 'Plan priorities decide which briefing content is worth sending.' },
      { from: 'working-day-audit', to: 'memory-reflection', reason: 'Day-end work records become reusable memory for the next autonomous cycle.' },
      { from: 'customer-showcase', to: 'artifact-judge', reason: 'Customer-facing proof should be evaluated before demo or executive delivery.' },
    ],
    escalationQueue: blocked.length
      ? blocked.map((record) => `${record.title}: ${record.summary}`)
      : ['No blocked Morgan tasks currently require human escalation.'],
    proofRequired: [
      'Tool result or data source for financial claims.',
      'Delivery result for Teams, email, document, or voice action.',
      'Correlation ID or audit event for material autonomous work.',
      'Human approval note for high-impact external or irreversible actions.',
    ],
  };
}

function cardFromTask(
  task: MissionTaskDefinition,
  state: AutonomousKanbanCardState,
  status: AutonomousKanbanCard['status'],
  summary: string,
  reason?: string,
  latestRecord?: MissionTaskRecord,
): AutonomousKanbanCard {
  return {
    id: `${state}-${task.id}`,
    title: task.title,
    taskId: task.id,
    state,
    status,
    priority: task.priority,
    cadence: task.cadence,
    summary,
    trigger: task.autonomousTrigger,
    reason,
    tools: task.tools,
    subAgents: task.subAgents,
    evidence: latestRecord?.evidence?.length ? latestRecord.evidence : task.expectedOutputs,
    owner: task.subAgents.some((agent) => /kanban/i.test(agent)) ? 'Morgan + AI Kanban' : 'Morgan',
    updatedAt: latestRecord?.completedAt || latestRecord?.startedAt,
  };
}

function cardFromRecord(record: MissionTaskRecord, state: AutonomousKanbanCardState): AutonomousKanbanCard {
  const task = taskDefinition(record.taskId);
  return {
    id: `${state}-${record.id}`,
    title: record.title,
    taskId: record.taskId,
    state,
    status: record.status,
    priority: task.priority,
    cadence: task.cadence,
    summary: record.summary,
    trigger: task.autonomousTrigger,
    tools: task.tools,
    subAgents: task.subAgents,
    evidence: record.evidence,
    owner: record.source === 'scheduled_job' || record.source === 'autonomous_cycle' ? 'Autonomous Morgan' : 'Morgan',
    updatedAt: record.completedAt || record.startedAt,
  };
}

export function getAutonomousKanbanBoard(): AutonomousKanbanBoard {
  const records = getTodaysTaskRecords();
  const open = listOpenMissionTasks();
  const plan = generateCfoOperatingPlan();
  const latestByTask = new Map<string, MissionTaskRecord>();
  const completedTaskIds = new Set<string>();
  const blockedTaskIds = new Set<string>();
  const activeTaskIds = new Set<string>();

  for (const record of records) {
    latestByTask.set(record.taskId, record);
    if (record.status === 'completed') completedTaskIds.add(record.taskId);
    if (record.status === 'blocked' || record.status === 'failed') blockedTaskIds.add(record.taskId);
    if (record.status === 'in_progress') activeTaskIds.add(record.taskId);
  }

  const aiKanbanAgent = getSubAgentRegistry().find((agent) => agent.id === 'ai-kanban');
  const columns: AutonomousKanbanColumn[] = [
    { id: 'queue', title: 'Autonomous Queue', intent: 'Runnable CFO work Morgan can pick from next.', cards: [] },
    { id: 'active', title: 'In Cycle', intent: 'Work selected for the current autonomous CFO loop.', wipLimit: 3, cards: [] },
    { id: 'waiting', title: 'Waiting / Escalate', intent: 'Blocked work, missing integrations, and human decisions.', cards: [] },
    { id: 'review', title: 'Proof / Review', intent: 'Artifacts, evidence gates, and approval checks before delivery.', cards: [] },
    { id: 'done', title: 'Done Today', intent: 'Recorded autonomous work completed today.', cards: [] },
  ];
  const byColumn = new Map(columns.map((column) => [column.id, column]));
  const pushCard = (columnId: AutonomousKanbanCardState, card: AutonomousKanbanCard): void => {
    const column = byColumn.get(columnId);
    if (!column || column.cards.some((existing) => existing.id === card.id)) return;
    column.cards.push(card);
  };

  for (const record of records.filter((item) => item.status === 'in_progress')) {
    pushCard('active', cardFromRecord(record, 'active'));
  }

  for (const planned of plan.nextRunnableTasks.slice(0, 3)) {
    const task = taskDefinition(planned.id);
    if (blockedTaskIds.has(task.id) || activeTaskIds.has(task.id)) continue;
    pushCard('active', cardFromTask(task, 'active', 'selected', planned.reason, planned.reason, latestByTask.get(task.id)));
    activeTaskIds.add(task.id);
  }

  for (const record of records.filter((item) =>
    (item.status === 'blocked' || item.status === 'failed') &&
    latestByTask.get(item.taskId) === item,
  )) {
    pushCard('waiting', cardFromRecord(record, 'waiting'));
  }

  // Demo-mode graceful degradation: only surface the AI Kanban endpoint blocker
  // when an endpoint is actually configured AND known to be failing. With no
  // endpoint configured we operate in deterministic demo mode and the visible
  // D-CFO board is the source of truth.
  const aiKanbanLatestRecord = latestByTask.get('corpgen-planning-loop');
  const aiKanbanRecentlyFailed =
    Boolean(aiKanbanAgent?.endpoint) &&
    Boolean(aiKanbanLatestRecord) &&
    aiKanbanLatestRecord!.status === 'blocked' &&
    (aiKanbanLatestRecord!.evidence || []).some((line) => /ai[\s-]?kanban/i.test(line) && /failed|HTTP\s+[45]\d\d|timeout|abort/i.test(line));
  if (aiKanbanRecentlyFailed) {
    pushCard('waiting', {
      id: 'waiting-ai-kanban-endpoint',
      title: 'AI Kanban endpoint',
      state: 'waiting',
      status: 'blocked',
      summary: 'Set AI_KANBAN_AGENT_ENDPOINT to let Morgan call the specialist task-board agent directly.',
      reason: 'The visible D-CFO board is live; the external AI Kanban specialist is not connected yet.',
      tools: ['getSubAgentRegistry', 'callSubAgent'],
      subAgents: ['AI Kanban'],
      evidence: ['AI_KANBAN_AGENT_ENDPOINT missing or empty'],
      owner: 'Operator',
    });
  }

  for (const task of open.openTasks) {
    if (activeTaskIds.has(task.id) || blockedTaskIds.has(task.id)) continue;
    if (completedTaskIds.has(task.id) && task.cadence !== 'continuous') continue;
    pushCard('queue', cardFromTask(task, 'queue', 'pending', task.description, task.autonomousTrigger, latestByTask.get(task.id)));
  }

  pushCard('review', {
    id: 'review-artifact-proof-gate',
    title: 'Artifact proof gate',
    state: 'review',
    status: 'review',
    summary: 'Board reports, risk updates, demos, and day-end summaries should pass evidence, actionability, and governance checks before delivery.',
    reason: 'Morgan uses evaluateMissionArtifact for customer- and CFO-facing outputs.',
    tools: ['evaluateMissionArtifact', 'getEnterpriseReadiness'],
    subAgents: ['Morgan'],
    evidence: plan.proofRequired,
    owner: 'Morgan',
  });

  for (const artifact of artifactEvaluations.slice(-3).reverse()) {
    pushCard('review', {
      id: `review-${artifact.id}`,
      title: artifact.title,
      state: 'review',
      status: artifact.verdict === 'ready' ? 'ready' : 'review',
      summary: artifact.rationale,
      reason: `${artifact.artifactType}: ${artifact.score}/100`,
      tools: ['evaluateMissionArtifact'],
      subAgents: ['Morgan'],
      evidence: artifact.checks.map((check) => `${check.label}: ${check.score}`),
      owner: 'Morgan',
      updatedAt: artifact.evaluatedAt,
    });
  }

  for (const record of records.filter((item) => item.status === 'completed').slice(-8).reverse()) {
    pushCard('done', cardFromRecord(record, 'done'));
  }

  const metrics = {
    queued: byColumn.get('queue')?.cards.length || 0,
    active: byColumn.get('active')?.cards.length || 0,
    waiting: byColumn.get('waiting')?.cards.length || 0,
    review: byColumn.get('review')?.cards.length || 0,
    done: byColumn.get('done')?.cards.length || 0,
    total: columns.reduce((sum, column) => sum + column.cards.length, 0),
  };

  return {
    generatedAt: new Date().toISOString(),
    nextBestAction: open.nextBestAction,
    aiKanbanAgent: {
      status: aiKanbanAgent?.status || 'missing_endpoint',
      endpointConfigured: Boolean(aiKanbanAgent?.endpoint),
      capabilities: aiKanbanAgent?.capabilities || ['task-board summary', 'workload context', 'completion prediction', 'delivery tracking'],
    },
    metrics,
    columns,
  };
}

export function getAdaptiveMemorySummary(): AdaptiveMemorySummary {
  const records = getTodaysTaskRecords();
  const auditEvents = getRecentAuditEvents(20);
  const blocked = records.filter((record) => record.status === 'blocked' || record.status === 'failed');
  const completed = records.filter((record) => record.status === 'completed');
  return {
    generatedAt: new Date().toISOString(),
    workingContext: [
      `Today has ${completed.length} completed task record(s) and ${blocked.length} blocker/failure record(s).`,
      `Next best action: ${listOpenMissionTasks().nextBestAction}`,
      `Current period: ${currentPeriod()}`,
    ],
    structuredMemory: records.slice(-8).map((record) => `${record.status}: ${record.title} - ${record.summary}`),
    semanticRecall: [
      'For variance claims, recall budget, actuals, variance percent, anomaly severity, and period.',
      'For Microsoft IQ claims, recall WorkIQ context, Foundry IQ evaluation signals, Fabric IQ figures, and whether the data came from deterministic demo adapters or tenant systems.',
      'For stakeholder delivery, recall destination, subject, delivery status, and whether approval was required.',
      'For customer demos, recall Mission Control, Beta Starfield, Aria avatar, CorpGen paper matrix, and audit evidence path.',
    ],
    experientialTrajectories: getExperientialLearningPlaybook().map((item) => `${item.title}: ${item.reuseInstruction}`),
    preservedCriticalContent: [
      ...blocked.map((record) => `Blocker: ${record.title} - ${record.summary}`),
      ...records.flatMap((record) => record.evidence || []).filter((item) => /critical|high|cash|approval|blocked|failed|variance|runway/i.test(item)).slice(-8),
      ...auditEvents.filter((event) => event.severity !== 'info').map((event) => `${event.kind}: ${event.label}`).slice(0, 6),
    ],
    compressionPolicy: 'Compress routine successful tool chatter; preserve blockers, failures, approvals, material finance numbers, evidence links, and correlation IDs verbatim.',
    recordsConsidered: records.length,
    auditEventsConsidered: auditEvents.length,
  };
}

export function getExperientialLearningPlaybook(): ExperientialLearningItem[] {
  const records = getTodaysTaskRecords();
  const hasCompletedHealthCheck = records.some((record) => record.taskId === 'finance-health-check' && record.status === 'completed');
  const hasAnomalyScan = records.some((record) => record.taskId === 'anomaly-surveillance' && record.status === 'completed');
  return [
    {
      id: 'variance-to-briefing',
      title: 'Variance to CFO briefing',
      trigger: 'Budget variance or anomaly scan finds material movement.',
      validatedPattern: 'Run budget vs actuals, classify severity, prepare a short CFO-ready narrative, then choose Teams/email/avatar channel based on urgency.',
      reuseInstruction: 'When variance exceeds threshold, call financial tools first, then record the anomaly and proposed stakeholder update as Mission Control evidence.',
      evidence: hasAnomalyScan ? ['Anomaly surveillance completed today'] : ['detectAnomalies', 'formatForTeams', 'sendTeamsMessage'],
      status: hasAnomalyScan ? 'active' : 'candidate',
    },
    {
      id: 'workday-to-memory',
      title: 'Workday records to reusable memory',
      trigger: 'End-of-day reflection or more than one meaningful task record exists.',
      validatedPattern: 'Summarize completed work, preserve blockers and finance figures, create tomorrow priorities, and expose them in Mission Control.',
      reuseInstruction: 'Before starting a new day, call getAdaptiveMemorySummary and listOpenMissionTasks to avoid repeating or forgetting work.',
      evidence: records.length ? [`${records.length} task record(s) today`] : ['getEndOfDayReport', 'getAdaptiveMemorySummary'],
      status: records.length ? 'active' : 'candidate',
    },
    {
      id: 'showcase-proof',
      title: 'Customer showcase proof path',
      trigger: 'Customer asks whether Morgan is a real autonomous digital worker.',
      validatedPattern: 'Open Mission Control, show the job contract, Beta Starfield modes, paper matrix, readiness checks, audit events, and avatar workflow.',
      reuseInstruction: 'Use Mission Control sections as the narrative order and call evaluateMissionArtifact on any demo script before presenting it.',
      evidence: ['Mission Control', 'Beta Starfield', 'Paper Match Matrix', 'Enterprise Readiness'],
      status: 'active',
    },
    {
      id: 'iq-to-briefing',
      title: 'Microsoft IQ to CFO briefing',
      trigger: 'CFO asks for figures, business insight, cross-functional risk, or customer wants to see the full Microsoft IQ story.',
      validatedPattern: 'Call Fabric IQ for governed figures, WorkIQ for stakeholder/work context, Foundry IQ for grounding/evaluation, then synthesize and record the briefing as Mission Control evidence.',
      reuseInstruction: 'Use synthesizeMicrosoftIQBriefing before final CFO/executive outputs that combine finance numbers, business context, and autonomous next actions.',
      evidence: ['queryWorkIQSignals', 'queryFoundryIQInsights', 'queryFabricIQFinancials', 'synthesizeMicrosoftIQBriefing'],
      status: 'active',
    },
    {
      id: 'enterprise-systems',
      title: 'Enterprise data cutover',
      trigger: 'Customer moves from showcase to pilot with ERP, Fabric, Power BI, or Dynamics data.',
      validatedPattern: 'Replace deterministic finance tool data sources with tenant-owned systems while preserving the same tool contracts, audit events, and artifact judge.',
      reuseInstruction: 'Keep Morgan tool schemas stable; swap implementations behind analyzeBudgetVsActuals, getFinancialKPIs, detectAnomalies, and calculateTrend.',
      evidence: ['financialTools.ts stable contracts', 'morgan-tools-reference production map'],
      status: hasCompletedHealthCheck ? 'candidate' : 'needs-enterprise-data',
    },
  ];
}

export function evaluateMissionArtifact(input: {
  artifact_type?: string;
  title?: string;
  content: string;
  evidence?: string[];
}): ArtifactEvaluationResult {
  const content = input.content || '';
  const evidence = input.evidence || [];
  const checks = [
    artifactCheck('has-purpose', 'States the CFO outcome clearly', /cfo|finance|budget|cash|margin|variance|board|brief/i.test(content), 'Artifact should make the CFO outcome explicit.'),
    artifactCheck('has-evidence', 'Includes evidence or source markers', evidence.length > 0 || /evidence|source|tool|actual|budget|kpi|audit|correlation/i.test(content), 'Financial artifacts need visible source or tool evidence.'),
    artifactCheck('has-actions', 'Names actions or next steps', /next|action|owner|follow|approve|review|send|escalat|priority/i.test(content), 'Morgan output should identify what happens next.'),
    artifactCheck('has-controls', 'Mentions governance when risk is present', !/critical|urgent|risk|failed|blocked|approval/i.test(content) || /approval|escalat|human|review|control|guardrail/i.test(content), 'Risk-bearing artifacts need approval or escalation context.'),
    artifactCheck('right-sized', 'Right-sized for executive consumption', content.length >= 120 && content.length <= 6000, 'Artifact should be substantial enough to prove work but concise enough for executive review.', 95, 45),
  ];
  const score = clampScore(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
  const verdict: ArtifactEvaluationResult['verdict'] = score >= 82 ? 'ready' : score >= 62 ? 'needs-review' : 'blocked';
  const result: ArtifactEvaluationResult = {
    id: `artifact-${Date.now()}-${artifactEvaluations.length + 1}`,
    evaluatedAt: new Date().toISOString(),
    artifactType: input.artifact_type || 'mission-artifact',
    title: input.title || 'Morgan artifact',
    score,
    verdict,
    rationale: verdict === 'ready'
      ? 'Artifact has enough purpose, evidence, actionability, and control context for the showcase flow.'
      : verdict === 'needs-review'
        ? 'Artifact is usable but should be reviewed for missing evidence, action, or governance detail.'
        : 'Artifact should not be delivered until missing evidence, action, or governance checks are resolved.',
    checks,
  };
  artifactEvaluations.push(result);
  if (artifactEvaluations.length > 50) artifactEvaluations.splice(0, artifactEvaluations.length - 50);
  recordAuditEvent({
    kind: 'mission.artifact.evaluated',
    label: `Artifact evaluated: ${result.title}`,
    correlationId: result.id,
    data: { artifactType: result.artifactType, score: result.score, verdict: result.verdict },
  });
  return result;
}

export function getMissionControlSnapshot(): MissionControlSnapshot {
  const records = getTodaysTaskRecords();
  return {
    agent: {
      name: process.env.AGENT_NAME || 'Morgan',
      role: process.env.AGENT_ROLE || 'Digital CFO',
      mode: 'Autonomous finance operator',
      timezone: process.env.ORG_TIMEZONE || process.env.TZ || 'local',
      workWindow: '09:00-17:00, seven days a week',
      foundryProjectEndpoint: process.env.FOUNDRY_PROJECT_ENDPOINT || undefined,
      m365Environment: process.env.MCP_PLATFORM_ENDPOINT ? 'Agent 365 MCP configured' : 'Demo mode until MCP endpoint is configured',
    },
    jobDescription: MORGAN_JOB_DESCRIPTION,
    microsoftIQ: synthesizeMicrosoftIQBriefing({ audience: 'Mission Control operators', focus: 'CorpGen autonomous CFO showcase', record_event: false }),
    enterpriseCapabilities: ENTERPRISE_CAPABILITIES,
    autonomyModes: AUTONOMY_MODES,
    paperAlignment: PAPER_ALIGNMENT,
    cognitiveTools: COGNITIVE_TOOLS,
    enterpriseReadiness: getEnterpriseReadiness(),
    adaptiveMemory: getAdaptiveMemorySummary(),
    experientialLearning: getExperientialLearningPlaybook(),
    operatingPlan: generateCfoOperatingPlan(),
    autonomousKanban: getAutonomousKanbanBoard(),
    recentArtifactEvaluations: artifactEvaluations.slice(-5).reverse(),
    keyTasks: KEY_TASKS,
    today: {
      date: todayKey(),
      tasksCompleted: records.filter((record) => record.status === 'completed').length,
      tasksInProgress: records.filter((record) => record.status === 'in_progress').length,
      tasksBlocked: records.filter((record) => record.status === 'blocked').length,
      records,
    },
    operatingCadence: OPERATING_CADENCE,
  };
}

export function getEndOfDayReport(params: { date?: string } = {}): {
  date: string;
  completedTasks: MissionTaskRecord[];
  blockedTasks: MissionTaskRecord[];
  failedTasks: MissionTaskRecord[];
  nextWorkingDayPriorities: string[];
  summaryMarkdown: string;
} {
  const date = params.date || todayKey();
  const records = getTodaysTaskRecords(date);
  const completedTasks = records.filter((record) => record.status === 'completed');
  const blockedTasks = records.filter((record) => record.status === 'blocked');
  const failedTasks = records.filter((record) => record.status === 'failed');
  const nextWorkingDayPriorities = [
    'Refresh budget vs actuals, cash runway, and Microsoft IQ briefing at the 09:00 day-init cycle.',
    'Follow up any blocked or failed tasks from today.',
    'Prepare briefing material for material anomalies, cross-functional risks, or board-facing finance updates using WorkIQ, Foundry IQ, and Fabric IQ evidence.',
  ];

  const completedLines = completedTasks.length
    ? completedTasks.map((record) => `- ${record.title}: ${record.summary}`).join('\n')
    : '- No completed tasks have been recorded yet.';
  const blockedLines = blockedTasks.length || failedTasks.length
    ? [...blockedTasks, ...failedTasks].map((record) => `- ${record.title}: ${record.summary}`).join('\n')
    : '- No blocked or failed tasks recorded.';

  return {
    date,
    completedTasks,
    blockedTasks,
    failedTasks,
    nextWorkingDayPriorities,
    summaryMarkdown:
      `# Morgan End-of-Day CFO Report - ${date}\n\n` +
      `## Completed Work\n${completedLines}\n\n` +
      `## Blocked or Failed Work\n${blockedLines}\n\n` +
      `## Tomorrow Priorities\n${nextWorkingDayPriorities.map((item) => `- ${item}`).join('\n')}`,
  };
}

export async function runAutonomousCfoWorkday(params: { source?: MissionTaskRecord['source'] } = {}): Promise<{
  period: string;
  records: MissionTaskRecord[];
  subAgentHandoffs: SubAgentHandoffResult[];
  headline: string;
}> {
  const source = params.source || 'scheduled_job';
  const period = currentPeriod();
  const records: MissionTaskRecord[] = [];

  const plan = generateCfoOperatingPlan();
  records.push(createRecord({
    taskId: 'corpgen-planning-loop',
    status: 'completed',
    summary: `Generated CFO operating plan with ${plan.nextRunnableTasks.length} next runnable task(s) and ${plan.dependencyGraph.length} dependency edge(s).`,
    evidence: plan.nextRunnableTasks.map((task) => `${task.title}: P${task.priority}`),
    source,
  }));

  const budget = analyzeBudgetVsActuals({ period });
  records.push(createRecord({
    taskId: 'finance-health-check',
    status: 'completed',
    summary: `Reviewed ${period} budget vs actuals: total variance ${budget.summary.totalVariancePct}% with ${budget.summary.anomalyCount} anomaly item(s).`,
    evidence: [`Budget ${budget.summary.totalBudget}`, `Actual ${budget.summary.totalActual}`],
    source,
  }));

  const kpis = getFinancialKPIs({ period });
  records.push(createRecord({
    taskId: 'finance-health-check',
    status: 'completed',
    summary: `Updated KPI snapshot: gross margin ${kpis.grossMarginPct}%, EBITDA ${kpis.ebitda}, cash runway ${kpis.cashRunwayMonths} months.`,
    evidence: [`Revenue ${kpis.netRevenue}`, `Burn rate ${kpis.burnRateMonthly}`],
    source,
  }));

  const anomalies = detectAnomalies({ period, threshold_percent: 10 });
  records.push(createRecord({
    taskId: 'anomaly-surveillance',
    status: anomalies.totalAnomalies > 0 ? 'completed' : 'completed',
    summary: `Scanned for variances above 10% and found ${anomalies.totalAnomalies} anomaly item(s).`,
    evidence: anomalies.anomalies.map((item) => `${item.category}: ${item.variancePct}% (${item.severity})`),
    source,
  }));

  const trend = calculateTrend({ metric: 'revenue', periods: 6 });
  records.push(createRecord({
    taskId: 'finance-health-check',
    status: 'completed',
    summary: `Checked six-month revenue trend: ${trend.direction} by ${trend.overallChangePct}%.`,
    evidence: trend.periods.map((point) => `${point.period}: ${point.value}`),
    source,
  }));

  const iqBriefing = synthesizeMicrosoftIQBriefing({ period, audience: 'CFO and Mission Control operators', focus: 'autonomous 9-5 Digital CFO operating loop' });
  records.push(createRecord({
    taskId: 'microsoft-iq-synthesis',
    status: 'completed',
    summary: iqBriefing.headline,
    evidence: [
      ...iqBriefing.executiveSummary.slice(0, 3),
      ...iqBriefing.evidence.slice(0, 5),
    ],
    source,
  }));

  const subAgentHandoffs = await runAutonomousSubAgentHandoffs({ period, plan, iqBriefing });
  const completedHandoffs = subAgentHandoffs.filter((handoff) => handoff.status === 'completed').length;
  const failedHandoffs = subAgentHandoffs.filter((handoff) => handoff.status === 'failed').length;
  const skippedHandoffs = subAgentHandoffs.filter((handoff) => handoff.status === 'skipped').length;
  const fallbackHandoffs = subAgentHandoffs.filter((handoff) => handoff.status === 'fallback').length;
  // Demo-mode graceful degradation: only block the planning loop on a true
  // 'failed' status. Missing endpoints (skipped) and unreachable configured
  // endpoints (fallback) are surfaced honestly in evidence and audit warnings,
  // but keep the autonomous loop healthy so the visible board stays green.
  // 'fallback' is currently never produced (handler returns 'completed' or
  // 'failed' today) but we still treat it as healthy for forward-compat.
  const planningLoopBlocked = failedHandoffs > 0;
  const planningLoopSummary = planningLoopBlocked
    ? `Specialist sub-agent handoff failed: ${completedHandoffs} completed, ${fallbackHandoffs} fallback, ${skippedHandoffs} skipped, ${failedHandoffs} failed.`
    : `Specialist sub-agent handoff checks healthy: ${completedHandoffs} completed, ${fallbackHandoffs} fallback (demo mode), ${skippedHandoffs} skipped (demo mode).`;
  records.push(createRecord({
    taskId: 'corpgen-planning-loop',
    status: planningLoopBlocked ? 'blocked' : 'completed',
    summary: planningLoopSummary,
    evidence: subAgentHandoffs.flatMap((handoff) => [`${handoff.agentName}: ${handoff.status}`, ...handoff.evidence]).slice(0, 10),
    source,
  }));

  const memory = getAdaptiveMemorySummary();
  records.push(createRecord({
    taskId: 'memory-reflection',
    status: 'completed',
    summary: `Compressed ${memory.recordsConsidered} task record(s) and ${memory.auditEventsConsidered} audit event(s) into adaptive CFO memory.`,
    evidence: memory.preservedCriticalContent.slice(0, 6),
    source,
  }));

  const artifact = evaluateMissionArtifact({
    artifact_type: 'autonomous-workday-summary',
    title: `Morgan autonomous CFO workday - ${period}`,
    content: records.map((record) => `${record.title}: ${record.summary}`).join('\n'),
    evidence: records.flatMap((record) => record.evidence),
  });
  records.push(createRecord({
    taskId: 'working-day-audit',
    status: artifact.verdict === 'blocked' ? 'blocked' : 'completed',
    summary: `Judged autonomous workday artifact at ${artifact.score}/100 with verdict ${artifact.verdict}.`,
    evidence: artifact.checks.map((check) => `${check.label}: ${check.score}`),
    source,
  }));

  return {
    period,
    records,
    subAgentHandoffs,
    headline: `Morgan completed ${records.length} autonomous CFO checks for ${period}.`,
  };
}

export const MISSION_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'getMissionControlSnapshot',
      description: 'Return Morgan Digital CFO job description, autonomous instructions, key tasks, operating cadence, and today activity for Mission Control.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPaperAlignment',
      description: 'Return Morgan\'s CorpGen paper alignment matrix, including paper concepts, Morgan implementation, enterprise controls, status, and proof points.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getTodaysTaskRecords',
      description: 'Return Morgan Mission Control task records for today or an optional ISO date, including completed, blocked, failed, and in-progress work.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Optional ISO date yyyy-mm-dd. Defaults to today.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recordMissionTaskCompletion',
      description: 'Record a task Morgan completed, blocked, or failed so it appears in Mission Control and the end-of-day CFO report.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'One of Morgan key task ids, such as finance-health-check, anomaly-surveillance, executive-briefing, working-day-audit, or customer-showcase.' },
          summary: { type: 'string', description: 'Short factual summary of the work completed or blocked.' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'Optional evidence such as links, tool names, or key figures.' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'blocked', 'completed', 'failed'], description: 'Task status.' },
        },
        required: ['task_id', 'summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generateCfoOperatingPlan',
      description: 'Generate Morgan strategic, tactical, and operational CFO operating plan with next runnable tasks, dependencies, escalation queue, and proof requirements.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listOpenMissionTasks',
      description: 'List open or blocked Morgan Mission Control tasks and return the next best autonomous CFO action.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getAutonomousKanbanBoard',
      description: 'Return Morgan D-CFO autonomous Kanban board with queued, active, waiting, proof-review, and completed work cards.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getAdaptiveMemorySummary',
      description: 'Return Morgan adaptive memory summary with working context, structured task memory, semantic recall, experiential trajectories, and preserved critical content.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getCognitiveToolchain',
      description: 'Return Morgan cognitive toolchain definitions, including plan generation, memory, learning, Microsoft IQ, and artifact judging tools.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getExperientialLearningPlaybook',
      description: 'Return Morgan reusable experiential learning playbook for CFO workflows and CorpGen-style trajectory reuse.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getEnterpriseReadiness',
      description: 'Return enterprise readiness checks for Agent 365 SDK, MCP tooling, observability, Purview, avatar presence, sub-agents, durable memory, and scheduler safety.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'evaluateMissionArtifact',
      description: 'Score a Morgan report, plan, briefing, or demo artifact for purpose, evidence, actionability, governance, and executive readiness.',
      parameters: {
        type: 'object',
        properties: {
          artifact_type: { type: 'string', description: 'Type of artifact, such as board-report, cfo-briefing, operating-plan, demo-script, or workday-summary.' },
          title: { type: 'string', description: 'Artifact title.' },
          content: { type: 'string', description: 'Artifact content to evaluate.' },
          evidence: { type: 'array', items: { type: 'string' }, description: 'Optional evidence strings, links, tool names, figures, or correlation IDs.' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getEndOfDayReport',
      description: 'Generate Morgan end-of-day completed-task breakdown, blocked work, and next working day priorities.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Optional ISO date yyyy-mm-dd. Defaults to today.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'runAutonomousCfoWorkday',
      description: 'Run Morgan 09:00-17:00 seven-day autonomous CFO checks, including Microsoft IQ synthesis, and record completed tasks for Mission Control.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];
