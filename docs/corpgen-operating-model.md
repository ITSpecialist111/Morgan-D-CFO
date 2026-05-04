# Morgan CorpGen Operating Model

Morgan is the D-CFO implementation of a CorpGen-style autonomous digital worker. The goal is not to make a finance chatbot look polished; the goal is to show how a real enterprise worker can hold a job contract, plan across time horizons, use tools, preserve memory, collaborate with other agents, communicate through Microsoft 365, and prove what it did.

## What Morgan Does

Morgan acts as an autonomous Digital CFO for the CFO office. During the configured 09:00-17:00 operating window, seven days a week, Morgan can:

- Monitor budget, actuals, revenue, margin, cash runway, burn rate, trend, and variance signals.
- Run finance checks and anomaly scans without waiting for a user prompt.
- Generate CFO operating plans with strategic, tactical, and operational horizons.
- Maintain an autonomous D-CFO Kanban board with queue, active, waiting/escalation, review, and done lanes.
- Produce executive briefings, board-ready narratives, Teams updates, email content, and Word-ready report content.
- Use WorkIQ, Foundry IQ, and Fabric IQ style tools to combine work context, model/evaluation intelligence, and governed business figures.
- Call Graph/Agent 365 MCP tools when configured, and show those calls in Agent Mind.
- Delegate specialist work to Cassidy, Avatar, and AI Kanban endpoints when configured.
- Present as Aria-as-Morgan through the avatar and Azure Voice Live experience.
- Initiate governed Microsoft Teams federation calls through Azure Communication Services for urgent finance escalation.
- Track the daily/weekly/monthly cost and value of the Morgan project.
- Record task evidence and generate day-end CFO reports.

## How Morgan Works

Morgan follows a repeatable control loop that maps directly to the CorpGen worker architecture.

| Loop step | Runtime behavior | Primary implementation |
|---|---|---|
| Identity and job contract | Morgan loads the Digital CFO role, mandate, autonomy principles, escalation rules, and success measures. | `src/mission/missionControl.ts` |
| Day Init | Morgan refreshes open work, finance context, Microsoft IQ signals, blockers, and the next runnable CFO task. | `runAutonomousCfoWorkday`, `generateCfoOperatingPlan` |
| Execution Cycle | Morgan calls finance/IQ/M365 tools, delegates sub-agent work, records outcomes, and emits Agent Mind events. | `src/tools`, `src/tools/iqTools.ts`, `src/orchestrator/subAgents.ts` |
| Memory update | Morgan preserves completed work, blockers, audit events, finance figures, and reusable workflow patterns. | `getAdaptiveMemorySummary`, `getExperientialLearningPlaybook` |
| Proof and evaluation | Morgan checks reports, plans, demo scripts, and workday summaries for evidence, actionability, governance, and readiness. | `evaluateMissionArtifact` |
| Stakeholder communication | Morgan can brief through Teams, email, documents, avatar voice, or Teams federation call. | `src/tools/mcpToolSetup.ts`, `src/voice` |
| Day-End Reflection | Morgan returns a CFO-readable summary of completed work, blocked work, lessons, Microsoft IQ findings, and next priorities. | `getEndOfDayReport`, `/api/scheduled/end-of-day` |

## CorpGen Capability Map

| CorpGen concept | Morgan capability | Customer-visible proof |
|---|---|---|
| Persistent worker identity | Morgan Digital CFO, CFO reporting line, configured work window, tenant/app identity | Mission Control agent block, README, `.env.template` |
| Multi-horizon planning | Strategic, tactical, and operational CFO plan with dependencies and proof requirements | CFO Operating Plan, Beta Starfield planning mode |
| Autonomous schedule | In-process scheduler plus Azure Function timers for workday cycles and day-end report | `/api/mission-control/run-workday`, `azure-function-trigger` |
| Cognitive tools | Plan generation, open-task list, task recording, memory summary, learning playbook, artifact judge | Mission Control Cognitive Toolchain |
| Tiered memory | Working context, structured task records, semantic recall cues, critical content preservation | Adaptive Memory, Completed Work Log |
| Experiential learning | Reusable finance workflow patterns and production cutover lessons | Experiential Learning panel |
| Isolated sub-agents | Cassidy, Avatar, and AI Kanban registry and handoff API | Sub-Agent Swarm, D-CFO Kanban |
| Enterprise tools | Finance tools, Graph/MCP tools, Microsoft IQ, Teams/email/document actions | Agent Mind and Tooling Manifest |
| WorkIQ | Microsoft 365 work context: meetings, finance threads, approvals, Planner, SharePoint | Microsoft IQ Command Layer |
| Foundry IQ | Model, knowledge, trace, evaluation, artifact readiness, hosted Responses protocol | Foundry IQ card, `.foundry`, `/responses` |
| Fabric IQ | Finance and cross-functional metrics from a semantic-model style adapter | Fabric IQ metrics and production path |
| Human-facing presence | Aria-as-Morgan avatar, Voice Live, black background, moving orbs, live activity overlay | `/voice`, `/avatar` |
| Governed escalation | Teams messages, Teams federation call control, approval boundaries, escalation rules | Teams Call Control, ACS federation status |
| Audit and observability | Application Insights-ready custom events, audit endpoint, Agent Mind ring buffer | `/api/observability`, `/api/audit/events`, `/api/mission-control/events` |
| Cost/value management | Azure Cost Management actuals plus transparent showback estimates | `/mission-control/costs` |

## Mission Control Surfaces

`/mission-control` is the customer proof surface. It is meant to answer the question: "What is this autonomous worker doing, and can we inspect it?"

It includes:

- Job Description: Morgan's Digital CFO purpose, mandate, visible instructions, escalation rules, and success measures.
- Cost of Morgan: daily and weekly run-rate, avatar share, value-to-cost estimate, Azure actuals, and link to the detailed dashboard.
- Beta Starfield: CorpGen graph showing mission, tools, sub-agents, finance signals, memory, governance, and live events.
- Agent Mind: visible events for prompts, replies, LLM turns, tool calls, tool results, MCP/Graph discovery, voice sessions, Teams calls, and mission tasks.
- Microsoft IQ Command Layer: WorkIQ, Foundry IQ, and Fabric IQ pillars in one CFO briefing.
- Teams Call Control: EasyAuth-protected operator panel for Teams federation calls.
- Enterprise Capabilities and Readiness: the current implementation state and production hardening boundaries.
- D-CFO Kanban: autonomous CFO work board.
- Operating Plan, Artifact Judge, Paper Match Matrix, Key Tasks, Completed Work Log, and End-of-Day Breakdown.

## Microsoft IQ Layer

Morgan includes a working Microsoft IQ layer even when no real customer data is available.

| IQ pillar | Demo source | Production source |
|---|---|---|
| WorkIQ | Deterministic Microsoft 365 work-graph signals | Microsoft Graph, Agent 365 MCP, Outlook, Teams, Planner, SharePoint, Word, Excel |
| Foundry IQ | Synthetic Foundry knowledge/evaluation signals and hosted-agent traces | Foundry project knowledge indexes, model deployments, traces, eval datasets, prompt optimization |
| Fabric IQ | Deterministic Contoso CFO semantic model | Fabric Lakehouse/Warehouse, OneLake, Power BI semantic models, Data Factory pipelines |

The important design decision is that the tool contracts are production-shaped now. The showcase can run without customer data, but the route from demo to enterprise data is adapter replacement, not a rebuild of the user experience.

## Voice, Avatar, and Teams Federation

Morgan has two human-facing presence modes.

The browser avatar is served at `/voice` and `/avatar`. It uses Azure Voice Live, Speech avatar relay tokens, a black background, moving orbs, activity overlays, and customer-friendly Mission Control links.

The Teams federation path uses Azure Communication Services Call Automation. Morgan can place a governed call to a CFO/operator or a supplied Teams user object ID, receive ACS lifecycle events, bridge bidirectional audio to Azure OpenAI realtime or Voice Live, and record call events into Agent Mind and the audit stream. The current bridge is bidirectional audio; video presence inside Teams remains a separate media sender workstream.

## Cost and Value Model

Morgan's cost dashboard separates actual Azure spend from estimate/showback assumptions.

- Azure actuals come from the Azure Cost Management Query API at the Morgan resource-group scope when RBAC is available.
- Avatar and Teams voice cost is estimated from voice/call session activity when precise Speech, Voice Live, and ACS meters are not yet visible.
- Agent 365, Microsoft IQ, Fabric/Power BI, Foundry/evaluation, Graph/MCP tools, compute, storage, and observability use configurable `MORGAN_COST_*` settings.
- Value estimates use `MORGAN_VALUE_FINANCE_HOURLY_RATE` and `MORGAN_VALUE_HOURS_PER_COMPLETED_TASK` so a customer can tune the business case.

This makes the expensive real-time avatar path visible rather than hidden, which is important for enterprise pilots and customer demos.

## Demo Mode vs Production Mode

Morgan is intentionally honest about what is live, what is deterministic demo data, and what needs tenant resources.

| Area | Demo mode | Production cutover |
|---|---|---|
| Finance data | Deterministic Contoso financial tools | ERP, treasury, Dynamics 365 Finance, Fabric, Power BI semantic models |
| Work context | Deterministic WorkIQ adapter plus MCP visibility when configured | Graph/Agent 365 MCP and customer Microsoft 365 tenant data |
| Foundry intelligence | Synthetic knowledge/eval signals and hosted Responses protocol | Foundry project assets, eval datasets, traces, model deployments |
| Fabric intelligence | Contoso semantic-model adapter | Fabric Lakehouse/Warehouse/Power BI semantic model |
| Memory | Process-local mission records plus optional Agent SDK Cosmos state | Durable mission records, audit export, retention, Purview/Sentinel workflow |
| Sub-agents | Endpoint registry with configured/missing status | Cassidy, Avatar, AI Kanban, and specialist production endpoints |
| Teams calls | ACS bridge and tenant federation policy required | Production ACS resource, policy allow-list, call monitoring, approved operator flow |

## Key Files

| File | Why it matters |
|---|---|
| `src/mission/missionControl.ts` | Morgan's job contract, CorpGen capability map, tasks, memory, Kanban, artifact judge, and autonomous workday loop |
| `src/mission/mission-control.html` | Customer-facing Mission Control UI |
| `src/mission/mindmap.ts` | Beta Starfield / Agent Mind graph model |
| `src/mission/costModel.ts` | Cost and value dashboard backend |
| `src/tools/iqTools.ts` | WorkIQ, Foundry IQ, Fabric IQ adapters and synthesis |
| `src/observability/agentEvents.ts` | Agent Mind live event stream |
| `src/observability/agentAudit.ts` | Audit/Application Insights event model |
| `src/voice/acsBridge.ts` | ACS Teams federation calling and media bridge |
| `src/voice/avatarRoutes.ts` | Speech avatar config and relay token routes |
| `src/foundry/responsesAdapter.ts` | Foundry hosted-agent Responses protocol |
| `azure-function-trigger/src/weeklyBriefing.ts` | Weekly briefing, daily anomaly check, autonomous workday cycle, and EOD timers |

## Enterprise Controls

Morgan is built for demos and pilots that need enterprise discipline:

- Browser Mission Control, cost, and avatar surfaces require Microsoft web sign-in outside development.
- Scheduled endpoints require `SCHEDULED_SECRET`.
- M365/Graph/MCP actions inherit Microsoft 365 auditability under the executing identity.
- Morgan emits custom audit events with correlation IDs for joining to App Insights, Log Analytics, Purview, and Sentinel workflows.
- Artifact evaluation and Paper Match Matrix rows show production-hardening boundaries instead of pretending every enterprise dependency is already complete.
- Cost assumptions are visible and configurable.

## One-Sentence Narrative

Morgan is the CorpGen Digital CFO: an inspectable Microsoft 365 and Azure worker that plans its finance day, calls tools, uses Microsoft IQ, collaborates with specialist agents, talks through avatar and Teams, proves its work, reports its cost, and gives the CFO a daily record of what was completed.