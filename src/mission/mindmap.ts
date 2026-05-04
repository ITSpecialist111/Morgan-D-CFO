import { getRecentAuditEvents } from '../observability/agentAudit';
import { getSubAgentRegistry } from '../orchestrator/subAgents';
import { getMissionControlSnapshot } from './missionControl';

export type MorganMindmapNodeType =
  | 'core'
  | 'mission'
  | 'instruction'
  | 'tool'
  | 'agent'
  | 'task'
  | 'memory'
  | 'finance'
  | 'voice'
  | 'planning'
  | 'governance'
  | 'evaluation'
  | 'communication'
  | 'audit';

export interface MorganMindmapNode {
  id: string;
  label: string;
  type: MorganMindmapNodeType;
  group: string;
  importance: number;
  detail?: string;
  status?: string;
  ts?: string;
}

export interface MorganMindmapLink {
  source: string;
  target: string;
  type: 'core' | 'instruction' | 'tool_use' | 'agent_link' | 'task_flow' | 'memory_recall' | 'voice_link' | 'audit_trace' | 'capability' | 'governance';
  strength: number;
  label?: string;
}

export interface MorganMindmapResponse {
  nodes: MorganMindmapNode[];
  links: MorganMindmapLink[];
  stats: {
    knowledgeNodes: number;
    instructions: number;
    toolsUsed: number;
    agentsOnline: number;
    tasksToday: number;
    auditEvents: number;
    enterpriseCapabilities: number;
    autonomyModes: number;
    paperConcepts: number;
    cognitiveTools: number;
    readinessChecks: number;
  };
}

function nodeId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'node';
}

function pushUnique<T extends { id: string }>(items: T[], seen: Set<string>, item: T): void {
  if (seen.has(item.id)) return;
  seen.add(item.id);
  items.push(item);
}

export function getMissionMindmap(): MorganMindmapResponse {
  const snapshot = getMissionControlSnapshot();
  const subAgents = getSubAgentRegistry();
  const auditEvents = getRecentAuditEvents(80);
  const nodes: MorganMindmapNode[] = [];
  const links: MorganMindmapLink[] = [];
  const seen = new Set<string>();
  const addNode = (node: MorganMindmapNode) => pushUnique(nodes, seen, node);
  const addLink = (link: MorganMindmapLink) => links.push(link);

  addNode({
    id: 'morgan-core',
    label: 'Morgan',
    type: 'core',
    group: 'core',
    importance: 10,
    detail: `${snapshot.agent.role} - ${snapshot.agent.mode}`,
    status: 'online',
  });

  const hubs: MorganMindmapNode[] = [
    { id: 'hub-mission', label: 'CFO Mission', type: 'mission', group: 'mission', importance: 8, detail: snapshot.jobDescription.purpose },
    { id: 'hub-instructions', label: 'Instruction Set', type: 'instruction', group: 'instruction', importance: 8, detail: 'Customer-visible operating instructions and escalation rules.' },
    { id: 'hub-finance', label: 'Finance Signals', type: 'finance', group: 'finance', importance: 8, detail: 'Budget, actuals, KPIs, trends, variance, and cash signals.' },
    { id: 'hub-tools', label: 'Tool Belt', type: 'tool', group: 'tool', importance: 8, detail: 'Native finance, Microsoft 365, report, voice, and sub-agent tools.' },
    { id: 'hub-microsoft-iq', label: 'Microsoft IQ', type: 'tool', group: 'tool', importance: 8, detail: 'WorkIQ, Foundry IQ, and Fabric IQ signals for CFO context, business insight, and governed figures.' },
    { id: 'hub-agents', label: 'Sub-Agent Swarm', type: 'agent', group: 'agent', importance: 7, detail: 'Cassidy, Avatar, AI Kanban, and future specialist agents.' },
    { id: 'hub-workday', label: 'Autonomous Workday', type: 'task', group: 'task', importance: 8, detail: 'Daily cadence, task records, EOD reporting, and next priorities.' },
    { id: 'hub-planning', label: 'CorpGen Planning', type: 'planning', group: 'planning', importance: 8, detail: 'Strategic, tactical, and operational CFO task planning with dependency-aware execution.' },
    { id: 'hub-governance', label: 'Governance', type: 'governance', group: 'governance', importance: 8, detail: 'Human approval boundaries, work-hours gates, escalation rules, caps, and evidence requirements.' },
    { id: 'hub-cognitive', label: 'Cognitive Tools', type: 'evaluation', group: 'evaluation', importance: 8, detail: 'Plan generation, open-task listing, adaptive memory, experiential learning, and artifact judging.' },
    { id: 'hub-voice', label: 'Avatar Voice', type: 'voice', group: 'voice', importance: 7, detail: 'Web avatar, Speech avatar relay, Voice Live, and Teams calling.' },
    { id: 'hub-audit', label: 'Audit Memory', type: 'memory', group: 'memory', importance: 7, detail: 'Recent Morgan audit events and observability trace.' },
  ];

  for (const hub of hubs) {
    addNode(hub);
    addLink({ source: 'morgan-core', target: hub.id, type: 'core', strength: 0.9 });
  }

  const iq = snapshot.microsoftIQ;
  const iqPillars = [
    { id: 'workiq', label: 'WorkIQ', type: 'tool' as MorganMindmapNodeType, detail: (iq.pillars.workIQ?.topSignals || []).join(' ') || 'Microsoft 365 work context for meetings, approvals, Planner work, Teams/email pressure, and SharePoint evidence.', status: 'work graph' },
    { id: 'foundryiq', label: 'Foundry IQ', type: 'evaluation' as MorganMindmapNodeType, detail: (iq.pillars.foundryIQ?.modelInsights || []).join(' ') || 'Model, knowledge, trace, and evaluation intelligence for grounded CFO outputs.', status: 'model/eval' },
    { id: 'fabriciq', label: 'Fabric IQ', type: 'finance' as MorganMindmapNodeType, detail: (iq.pillars.fabricIQ?.crossFunctionalSignals || []).map((signal) => `${signal.function}: ${signal.value}`).join(' ') || 'Fabric semantic model figures and cross-functional business signals.', status: 'semantic model' },
  ];
  for (const pillar of iqPillars) {
    const id = `iq-${pillar.id}`;
    addNode({ id, label: pillar.label, type: pillar.type, group: 'tool', importance: 7, detail: pillar.detail, status: pillar.status });
    addLink({ source: 'hub-microsoft-iq', target: id, type: 'capability', strength: 0.65, label: 'IQ pillar' });
    addLink({ source: 'hub-tools', target: id, type: 'tool_use', strength: 0.45, label: 'callable' });
  }
  addLink({ source: 'iq-workiq', target: 'iq-foundryiq', type: 'capability', strength: 0.42, label: 'context to evaluation' });
  addLink({ source: 'iq-fabriciq', target: 'iq-foundryiq', type: 'capability', strength: 0.42, label: 'figures to insight' });
  addLink({ source: 'iq-fabriciq', target: 'hub-finance', type: 'memory_recall', strength: 0.4, label: 'semantic model' });

  for (const item of snapshot.jobDescription.customerVisibleInstructions) {
    const id = `instruction-${nodeId(item)}`;
    addNode({ id, label: item, type: 'instruction', group: 'instruction', importance: 4, detail: item });
    addLink({ source: 'hub-instructions', target: id, type: 'instruction', strength: 0.45 });
  }

  for (const item of snapshot.jobDescription.escalationRules) {
    const id = `escalation-${nodeId(item)}`;
    addNode({ id, label: 'Escalation rule', type: 'instruction', group: 'instruction', importance: 5, detail: item, status: 'guardrail' });
    addLink({ source: 'hub-instructions', target: id, type: 'instruction', strength: 0.5, label: 'guardrail' });
    addLink({ source: 'hub-governance', target: id, type: 'governance', strength: 0.4, label: 'approval boundary' });
  }

  for (const capability of snapshot.enterpriseCapabilities) {
    const id = `capability-${capability.id}`;
    const type: MorganMindmapNodeType = capability.category === 'planning'
      ? 'planning'
      : capability.category === 'memory'
        ? 'memory'
        : capability.category === 'subagents'
          ? 'agent'
          : capability.category === 'tools'
            ? 'tool'
            : capability.category === 'communication'
              ? 'communication'
              : capability.category === 'evaluation'
                ? 'evaluation'
                : 'governance';
    const hub = capability.category === 'planning'
      ? 'hub-planning'
      : capability.category === 'memory'
        ? 'hub-audit'
        : capability.category === 'subagents'
          ? 'hub-agents'
          : capability.category === 'tools'
            ? 'hub-tools'
            : capability.category === 'communication'
              ? 'hub-voice'
              : capability.category === 'evaluation'
                ? 'hub-governance'
                : 'hub-governance';
    addNode({
      id,
      label: capability.title,
      type,
      group: capability.category,
      importance: 7,
      detail: `${capability.description} Morgan mapping: ${capability.morganMapping} Proof: ${capability.customerProof.join(', ')}.`,
      status: capability.sourcePattern,
    });
    addLink({ source: 'morgan-core', target: id, type: 'capability', strength: 0.46, label: 'enterprise capability' });
    addLink({ source: hub, target: id, type: 'capability', strength: 0.58, label: capability.category });
  }

  for (const mode of snapshot.autonomyModes) {
    const id = `mode-${mode.id}`;
    addNode({
      id,
      label: mode.title,
      type: 'planning',
      group: 'planning',
      importance: mode.id === 'cycle' ? 8 : 6,
      detail: `${mode.purpose} Trigger: ${mode.runTrigger} Evidence: ${mode.evidence.join(', ')}.`,
      status: mode.window,
    });
    addLink({ source: 'hub-planning', target: id, type: 'task_flow', strength: 0.58, label: mode.window });
    addLink({ source: 'hub-workday', target: id, type: 'task_flow', strength: 0.45, label: mode.id });
  }

  for (const item of snapshot.paperAlignment) {
    const id = `paper-${item.id}`;
    const type: MorganMindmapNodeType = item.status === 'production-hardening' ? 'evaluation' : item.id.includes('memory') ? 'memory' : item.id.includes('subagent') ? 'agent' : item.id.includes('communication') ? 'communication' : item.id.includes('safety') || item.id.includes('escalation') ? 'governance' : 'planning';
    const hub = item.status === 'production-hardening'
      ? 'hub-governance'
      : type === 'memory'
        ? 'hub-audit'
        : type === 'agent'
          ? 'hub-agents'
          : type === 'communication'
            ? 'hub-voice'
            : type === 'governance'
              ? 'hub-governance'
              : 'hub-planning';
    addNode({
      id,
      label: item.paperConcept,
      type,
      group: 'paper',
      importance: item.status === 'implemented' ? 7 : 6,
      detail: `Morgan: ${item.morganImplementation} Enterprise control: ${item.enterpriseControl} Proof: ${item.proof.join(', ')}.`,
      status: item.status,
    });
    addLink({ source: hub, target: id, type: item.status === 'production-hardening' ? 'governance' : 'capability', strength: 0.52, label: item.status });
  }

  for (const tool of snapshot.cognitiveTools) {
    const id = `cognitive-${tool.id}`;
    const type: MorganMindmapNodeType = tool.id.includes('memory') || tool.id.includes('learn') ? 'memory' : tool.id.includes('judge') ? 'evaluation' : 'planning';
    const hub = type === 'memory' ? 'hub-audit' : type === 'evaluation' ? 'hub-cognitive' : 'hub-planning';
    addNode({
      id,
      label: tool.title,
      type,
      group: 'cognitive',
      importance: tool.status === 'live' ? 7 : 6,
      detail: `${tool.paperMechanism}. Tool: ${tool.morganTool}. Outputs: ${tool.outputs.join(', ')}. Control: ${tool.enterpriseControl}`,
      status: tool.status,
    });
    addLink({ source: 'hub-cognitive', target: id, type: 'tool_use', strength: 0.6, label: tool.morganTool });
    addLink({ source: hub, target: id, type: 'capability', strength: 0.44, label: tool.status });
  }

  for (const check of snapshot.enterpriseReadiness) {
    const id = `readiness-${check.id}`;
    const type: MorganMindmapNodeType = check.status === 'ready' || check.status === 'configured' ? 'governance' : 'evaluation';
    addNode({
      id,
      label: check.area,
      type,
      group: 'readiness',
      importance: check.status === 'ready' ? 7 : check.status === 'configured' ? 6 : 5,
      detail: `${check.signal}. Control: ${check.control}. Evidence: ${check.evidence.join(', ')}.` ,
      status: check.status,
    });
    addLink({ source: 'hub-governance', target: id, type: 'governance', strength: 0.5, label: check.status });
  }

  const toolNames = new Set<string>();
  for (const task of snapshot.keyTasks) {
    const taskNode = `task-${task.id}`;
    addNode({
      id: taskNode,
      label: task.title,
      type: 'task',
      group: 'task',
      importance: Math.max(4, 8 - task.priority),
      detail: `${task.description} Trigger: ${task.autonomousTrigger}`,
      status: task.cadence,
    });
    addLink({ source: 'hub-workday', target: taskNode, type: 'task_flow', strength: 0.65, label: task.cadence });

    for (const tool of task.tools) {
      toolNames.add(tool);
      const toolNode = `tool-${nodeId(tool)}`;
      addNode({ id: toolNode, label: tool, type: 'tool', group: 'tool', importance: 5, detail: `Used by ${task.title}.` });
      addLink({ source: 'hub-tools', target: toolNode, type: 'tool_use', strength: 0.45 });
      addLink({ source: taskNode, target: toolNode, type: 'tool_use', strength: 0.38 });
    }

    for (const subAgent of task.subAgents) {
      const agentNode = `task-agent-${nodeId(subAgent)}`;
      addNode({ id: agentNode, label: subAgent, type: 'agent', group: 'agent', importance: 4, detail: `Specialist agent used by ${task.title}.` });
      addLink({ source: taskNode, target: agentNode, type: 'agent_link', strength: 0.35 });
      addLink({ source: 'hub-agents', target: agentNode, type: 'agent_link', strength: 0.35 });
    }
  }

  for (const agent of subAgents) {
    const id = `agent-${agent.id}`;
    addNode({
      id,
      label: agent.name,
      type: 'agent',
      group: 'agent',
      importance: agent.status === 'configured' ? 6 : 4,
      detail: `${agent.role}. Capabilities: ${agent.capabilities.join(', ')}.`,
      status: agent.status,
    });
    addLink({ source: 'hub-agents', target: id, type: 'agent_link', strength: agent.status === 'configured' ? 0.55 : 0.32, label: agent.status });
  }

  const financeSignals = ['Budget vs actuals', 'Gross margin', 'EBITDA', 'Cash runway', 'Revenue trend', 'Expense anomaly', 'Board briefing', 'P&L narrative', 'Fabric semantic model', 'Pipeline coverage', 'Net revenue retention'];
  for (const signal of financeSignals) {
    const id = `finance-${nodeId(signal)}`;
    addNode({ id, label: signal, type: 'finance', group: 'finance', importance: 4, detail: `${signal} is part of Morgan's CFO signal model.` });
    addLink({ source: 'hub-finance', target: id, type: 'memory_recall', strength: 0.3 });
  }

  const voiceNodes = [
    { label: 'Speech Avatar', detail: 'Microsoft Speech avatar relay token and WebRTC media.' },
    { label: 'Voice Live', detail: 'Realtime conversational audio session.' },
    { label: 'Teams Calling', detail: 'ACS outbound Teams calling and escalation bridge.' },
    { label: 'Customer Showcase', detail: 'Visible avatar experience for demos and spoken CFO updates.' },
  ];
  for (const item of voiceNodes) {
    const id = `voice-${nodeId(item.label)}`;
    addNode({ id, label: item.label, type: 'voice', group: 'voice', importance: 5, detail: item.detail });
    addLink({ source: 'hub-voice', target: id, type: 'voice_link', strength: 0.48 });
  }

  for (const record of snapshot.today.records.slice(0, 50)) {
    const id = `record-${record.id}`;
    addNode({ id, label: record.title, type: 'memory', group: 'memory', importance: 4, detail: record.summary, status: record.status, ts: record.completedAt || record.startedAt });
    addLink({ source: 'hub-audit', target: id, type: 'memory_recall', strength: 0.45, label: record.status });
    addLink({ source: `task-${record.taskId}`, target: id, type: 'task_flow', strength: 0.35 });
  }

  for (const event of auditEvents) {
    const id = `audit-${event.id}`;
    addNode({ id, label: event.label, type: 'audit', group: 'memory', importance: event.severity === 'error' ? 5 : 2, detail: event.kind, status: event.severity, ts: event.timestamp });
    addLink({ source: 'hub-audit', target: id, type: 'audit_trace', strength: event.severity === 'error' ? 0.45 : 0.2 });
  }

  return {
    nodes,
    links,
    stats: {
      knowledgeNodes: nodes.length,
      instructions: snapshot.jobDescription.customerVisibleInstructions.length + snapshot.jobDescription.escalationRules.length,
      toolsUsed: toolNames.size,
      agentsOnline: subAgents.filter((agent) => agent.status === 'configured').length,
      tasksToday: snapshot.keyTasks.length,
      auditEvents: auditEvents.length,
      enterpriseCapabilities: snapshot.enterpriseCapabilities.length,
      autonomyModes: snapshot.autonomyModes.length,
      paperConcepts: snapshot.paperAlignment.length,
      cognitiveTools: snapshot.cognitiveTools.length,
      readinessChecks: snapshot.enterpriseReadiness.length,
    },
  };
}