# @corpgen/agent-sdk

**CorpGen Digital Worker SDK** — build AI teammates for long-running, agenda-driven, agentic tasks.

Implements the Microsoft CorpGen research paper primitives ([arXiv:2602.14229](https://arxiv.org/abs/2602.14229)) as a reusable TypeScript SDK. Morgan D-CFO is the reference consumer: a finance-domain digital worker built entirely on top of this SDK.

---

## Why this SDK exists

The GitHub Copilot SDK (`@github/copilot-sdk`) and similar SDKs are excellent for single-turn or short-session agentic tasks. They do not implement the CorpGen primitives required for a digital co-worker that:

- Holds a **persistent job contract** with a mandate and escalation rules
- Plans across **strategic / tactical / operational horizons**
- Maintains a **Kanban work queue** and advances cards autonomously over hours
- Uses **tiered memory** that survives across cycles without context saturation
- Delegates to **isolated sub-agents** without sharing its context window
- Requires **Human-in-the-Loop (HITL) approval** before external side effects
- Produces **evidence-backed artifacts** scored by an evaluation rubric

This SDK fills that gap. It is **intentionally ergonomically compatible** with the Copilot SDK — tool definitions, event kinds, provider patterns, and lifecycle hooks use the same shape so teams already familiar with the Copilot SDK can orient quickly.

---

## GitHub Copilot SDK alignment

| Copilot SDK concept | CorpGen SDK equivalent |
|---|---|
| `new CopilotClient()` | `new WorkLoop(config)` |
| `client.createSession({ model, tools, onPermissionRequest })` | `agent.run({ maxCycles })` |
| `session.send({ prompt })` | Autonomous — the loop selects work from the Kanban board |
| `ToolDefinition { name, description, parameters, handler }` | Same shape — fully compatible |
| `session.on('assistant.message', handler)` | `config.onEvent` callback + `EventBus.getRecent()` |
| `onPermissionRequest` | `onApprovalRequest` (L2/L3 HITL governance) |
| Session transcript | `WorkdayResult.events` |
| Session state (in-process) | `StorageProvider` — pluggable (file, Cosmos, Dataverse, in-memory) |

---

## Quick start

```typescript
import {
  WorkLoop,
  InMemoryStorageProvider,
  ConsoleNotificationProvider,
} from '@corpgen/agent-sdk';

const agent = new WorkLoop({
  contract: {
    name: 'My Digital Worker',
    purpose: 'Automate knowledge work across long sessions.',
    reportsTo: 'manager@example.com',
    mandate: ['Complete assigned tasks autonomously.', 'Escalate blockers promptly.'],
    autonomyPrinciples: ['Use tools before making claims.', 'Record evidence for every action.'],
    escalationRules: ['Escalate if a required tool is unavailable.'],
    successMeasures: ['All tasks completed with linked evidence.'],
    operatingWindow: '09:00-17:00',
  },
  tools: [
    {
      name: 'fetchReport',
      description: 'Retrieve the latest weekly report.',
      parameters: { period: { type: 'string', description: 'e.g. "2026-W30"' } },
      handler: async (params, context) => {
        // Your domain logic here
        return { report: 'Q3 summary data...' };
      },
    },
  ],
  llm: myAzureOpenAIProvider, // Implement LlmProvider or use a community adapter
  storage: new InMemoryStorageProvider(),
  notifications: new ConsoleNotificationProvider(),
  onEvent: (event) => console.log(`[${event.kind}] ${event.label}`),
  maxCardsPerCycle: 2,
});

// Seed the board with work
await agent.board.addCard({
  id: 'report-001',
  title: 'Generate weekly briefing',
  status: 'pending',
  cadence: 'weekly',
  priority: 1,
  summary: 'Compile the weekly finance briefing.',
  tools: ['fetchReport'],
  subAgents: [],
  evidence: [],
  owner: 'My Digital Worker',
});

// Run one autonomous workday
const result = await agent.run({ maxCycles: 5 });
console.log(`Completed ${result.cardsCompleted} cards in ${result.cyclesRun} cycles.`);
```

---

## Architecture

```
@corpgen/agent-sdk
│
├── WorkLoop                    ← Main entry point (analogous to CopilotClient.createSession)
│   ├── AgentIdentity           ← Job contract + operating window check
│   ├── KanbanBoardManager      ← queue → active → waiting → review → done
│   ├── WorkReasoner            ← LLM-driven or deterministic card selection
│   ├── MemoryEngine            ← Tiered memory: working / structured / semantic / preserved
│   ├── EventBus                ← Ring-buffered event stream (Copilot SDK-compatible kinds)
│   ├── AuditTrail              ← Durable audit records with correlation IDs
│   ├── ToolPolicyGateway       ← Server-side allow/deny/approval-required per tool call
│   └── ArtifactJudge           ← Scoring rubric: completeness, evidence, actionability, governance
│
├── HitlGateway                 ← L2/L3 approval request lifecycle
├── SubAgentBus                 ← Isolated sub-agent registry + HTTP handoff
│
└── Adapters (pluggable)
    ├── LlmProvider             ← Interface: Azure OpenAI / OpenAI / Anthropic / any
    ├── StorageProvider         ← Interface: Cosmos / file / Dataverse / in-memory
    └── NotificationProvider    ← Interface: Teams / email / Slack / console
```

---

## CorpGen paper primitives → SDK modules

| CorpGen primitive | SDK module | Key class / interface |
|---|---|---|
| Persistent worker identity | `core/AgentIdentity` | `AgentContract` |
| Multi-horizon planning | `WorkLoop` (cycle logic) | `WorkPlan` |
| LLM-driven work selection | `core/WorkReasoner` | `WorkReasoner.decide()` |
| Kanban work queue | `core/KanbanBoard` | `KanbanBoardManager` |
| Sub-agent isolation | `subagents/SubAgentBus` | `SubAgentBus.call()` |
| Tiered memory | `memory/MemoryEngine` | `MemoryEngine.summarize()` |
| Experiential learning | `memory/LearningPlaybook` | `LearningPlaybook` |
| Artifact evaluation | `governance/ArtifactJudge` | `ArtifactJudge.evaluate()` |
| HITL governance | `governance/HitlGateway` | `HitlGateway.request() / decide()` |
| Tool policy gateway | `governance/ToolPolicy` | `ToolPolicyGateway.evaluate()` |
| Agent Mind event stream | `observability/EventBus` | `EventBus.record() / getRecent()` |
| Audit trail | `observability/AuditTrail` | `AuditTrail.record()` |

---

## Extending with a custom LLM provider

Implement the `LlmProvider` interface to connect any model:

```typescript
import type { LlmProvider, LlmCompletionOptions, LlmCompletionResult } from '@corpgen/agent-sdk';

class AzureOpenAIProvider implements LlmProvider {
  readonly providerName = 'Azure OpenAI';
  readonly defaultModel = 'gpt-5-mini';

  async complete(options: LlmCompletionOptions): Promise<LlmCompletionResult> {
    const client = new AzureOpenAI({ /* ... */ });
    const response = await client.chat.completions.create({
      model: options.model ?? this.defaultModel,
      messages: options.messages,
      max_completion_tokens: options.maxTokens,
      response_format: options.jsonMode ? { type: 'json_object' } : undefined,
    });
    return {
      content: response.choices[0]?.message?.content ?? '',
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      model: response.model,
      finishReason: response.choices[0]?.finish_reason ?? 'stop',
    };
  }
}
```

---

## Reference implementation

**Morgan D-CFO** (`src/` in this repository) is the first production consumer of `@corpgen/agent-sdk`. Every CorpGen capability in Morgan maps to an SDK module:

| Morgan capability | SDK module used |
|---|---|
| `missionControl.ts` — job contract | `AgentIdentity` |
| `cfoWorkReasoner.ts` — LLM card selection | `WorkReasoner` |
| `missionControl.ts` — Kanban board | `KanbanBoardManager` |
| `missionControl.ts` — adaptive memory | `MemoryEngine` |
| `orchestrator/subAgents.ts` | `SubAgentBus` |
| `mission/hitlApprovals.ts` | `HitlGateway` |
| `observability/agentEvents.ts` | `EventBus` |
| `observability/agentAudit.ts` | `AuditTrail` |
| `governance/toolPolicy.ts` | `ToolPolicyGateway` |
| `evaluateMissionArtifact` | `ArtifactJudge` |

---

## License

MIT

---

## Known Limitations

### Authentication and authorization for HITL approvers

`HitlGateway.decide()` accepts an `ApproverIdentity` record but does not authenticate the caller against an identity provider. In production, wrap the gateway behind an authenticated middleware (Azure AD, Azure B2C, Entra ID protected endpoint) and derive the identity server-side before calling `decide()`. Do not expose `decide()` directly to untrusted callers.

### `approve_with_edits` does not rebind tool parameters

The `approved_with_edits` approval decision is persisted in the approval record and its `transitionHistory`, but the SDK does not currently extract or apply edited parameters at execution time. A card resumed after an `approve_with_edits` decision will execute with its original `toolParams`. To implement edited-params execution in your consumer, override `onApprovalRequest`, capture the edited parameters, update the card's `toolParams` in your storage layer before calling `hitlGateway.decide('approve_with_edits', ...)`, and extend `WorkCard` with a typed `editedToolParams` field.

### Single pending approval per card

Each card supports one `pendingApprovalId` at a time. If a card has multiple L2/L3 tools, they will each go through sequential approval cycles. Parallel multi-tool approval is not yet supported.
