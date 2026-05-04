import type { ChatCompletionTool } from 'openai/resources/chat';

export interface SubAgentDefinition {
  id: string;
  name: string;
  role: string;
  endpointEnv: string;
  defaultPath: string;
  capabilities: string[];
  status: 'configured' | 'missing_endpoint';
  endpoint?: string;
}

function readEndpoint(envName: string): string | undefined {
  const value = process.env[envName];
  if (!value) return undefined;
  if (value.includes('<') || value.includes('>')) return undefined;
  return value.replace(/\/$/, '');
}

function handoffAuthHeaders(agentId: string): Record<string, string> {
  const normalized = agentId.toUpperCase().replace(/-/g, '_');
  const bearerToken = process.env[`${normalized}_AGENT_BEARER_TOKEN`] || process.env.SUB_AGENT_BEARER_TOKEN;
  const sharedSecret = process.env[`${normalized}_AGENT_SHARED_SECRET`] || process.env.SUB_AGENT_SHARED_SECRET;
  return {
    ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
    ...(sharedSecret ? { 'x-agent-secret': sharedSecret } : {}),
  };
}

export function getSubAgentRegistry(): SubAgentDefinition[] {
  const agents: Array<Omit<SubAgentDefinition, 'status' | 'endpoint'>> = [
    {
      id: 'cassidy',
      name: 'Cassidy',
      role: 'Autonomous Chief of Staff and operations coordinator',
      endpointEnv: 'CASSIDY_AGENT_ENDPOINT',
      defaultPath: '/api/agent-messages',
      capabilities: ['Teams calling', 'autonomous work loop', 'operations escalation', 'MCP orchestration'],
    },
    {
      id: 'avatar',
      name: 'Avatar',
      role: 'Visible spoken agent interface',
      endpointEnv: 'AVATAR_AGENT_ENDPOINT',
      defaultPath: '/api/voice',
      capabilities: ['WebRTC avatar', 'Voice Live', 'visual customer demos', 'spoken status updates'],
    },
    {
      id: 'ai-kanban',
      name: 'AI Kanban',
      role: 'Mission board and task intelligence agent',
      endpointEnv: 'AI_KANBAN_AGENT_ENDPOINT',
      defaultPath: '/api/agent-actions',
      capabilities: ['task-board summary', 'workload context', 'completion prediction', 'delivery tracking'],
    },
  ];

  return agents.map((agent) => {
    const endpoint = readEndpoint(agent.endpointEnv);
    return {
      ...agent,
      status: endpoint ? 'configured' : 'missing_endpoint',
      endpoint,
    };
  });
}

export async function callSubAgent(params: {
  agent_id: string;
  message: string;
  path?: string;
  timeout_ms?: number;
}): Promise<{ success: boolean; agentId: string; status?: number; response?: unknown; error?: string }> {
  const agent = getSubAgentRegistry().find((item) => item.id === params.agent_id);
  if (!agent) return { success: false, agentId: params.agent_id, error: `Unknown sub-agent: ${params.agent_id}` };
  if (!agent.endpoint) {
    return {
      success: false,
      agentId: params.agent_id,
      error: `${agent.name} is not configured. Set ${agent.endpointEnv} to enable live agent-to-agent calls.`,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeout_ms || Number(process.env.AGENT_FETCH_TIMEOUT_MS) || 30_000);
  try {
    const url = `${agent.endpoint}${params.path || agent.defaultPath}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-id': process.env.AGENT_NAME || 'Morgan',
        ...handoffAuthHeaders(agent.id),
      },
      body: JSON.stringify({ message: params.message, sourceAgent: 'Morgan' }),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    return { success: response.ok, agentId: agent.id, status: response.status, response: parsed };
  } catch (err) {
    return { success: false, agentId: agent.id, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

export const SUB_AGENT_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'getSubAgentRegistry',
      description: 'List Morgan configured specialist sub-agents such as Cassidy, Avatar, and AI Kanban with their capabilities and endpoint status.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'callSubAgent',
      description: 'Send a task or question to one of Morgan specialist sub-agents when its endpoint is configured.',
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', enum: ['cassidy', 'avatar', 'ai-kanban'], description: 'Sub-agent to call.' },
          message: { type: 'string', description: 'Task or question to send to the sub-agent.' },
          path: { type: 'string', description: 'Optional path override. Defaults to the agent registered path.' },
          timeout_ms: { type: 'number', description: 'Optional request timeout in milliseconds.' },
        },
        required: ['agent_id', 'message'],
      },
    },
  },
];
