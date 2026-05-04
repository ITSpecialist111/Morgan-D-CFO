# Morgan — Tools, Integrations & Sample Questions

> Quick reference for demo conversations with Morgan via Teams chat or Voice Live.

---

## Voice Interface

**URL:** `https://<your-app-name>.azurewebsites.net/voice`

Morgan's voice page is now avatar-first. It uses `/api/avatar/ice` for Speech avatar relay tokens and the existing `/api/voice` Voice Live WebSocket for realtime conversation.

## Mission Control

**URL:** `https://<your-app-name>.azurewebsites.net/mission-control`

Mission Control shows Morgan's customer-visible job description, autonomous instruction set, key tasks, operating cadence, today's work log, and end-of-day breakdown.

It also exposes the CorpGen paper alignment matrix and Beta Starfield modes so customers can inspect how Morgan maps to Multi-Horizon Task Environments, MOMA capabilities, hierarchical planning, isolated sub-agents, tiered memory, adaptive summarization, cognitive tools, experiential learning posture, emergent collaboration, artifact evaluation, and enterprise safety rails.

The next-gen Mission Control surface adds enterprise readiness checks, a callable cognitive toolchain, adaptive memory summary, experiential learning playbook, CFO operating plan, and artifact judge. These are not just dashboard labels: Morgan can call the same tools from chat, voice, hosted responses, and autonomous workday runs.

Mission Control now includes a **Microsoft IQ Command Layer** for the full CorpGen showcase. WorkIQ supplies Microsoft 365 work context, Foundry IQ supplies model/agent/knowledge/evaluation intelligence, and Fabric IQ supplies financial figures plus cross-functional business metrics. The showcase is fully working with deterministic Contoso demo adapters and is designed so production tenant data can replace the adapters behind the same tool contracts.

Mission Control also includes **Cost of Morgan**. The high-level panel shows daily and weekly run-rate, avatar cost share, value-to-cost ratio, Azure actuals, and a link to `/mission-control/costs`. The detailed dashboard combines Azure Cost Management actuals with transparent showback assumptions for realtime avatar/Teams voice, Agent 365, Microsoft IQ, Foundry/AI, Fabric/Power BI, Graph/MCP calls, compute, tools, storage, and observability.

## Foundry Hosted Agent

**Responses endpoint:** `https://<your-app-name>.azurewebsites.net/responses`

Morgan includes `agent.yaml`, `Dockerfile`, and `.foundry/agent-metadata.yaml` so the same codebase can run as a Microsoft Foundry Hosted Agent. The hosted protocol uses `/responses` and records each hosted invocation as Morgan audit events.

## Observability and Purview Audit

**Status endpoint:** `GET /api/observability`

**Audit events endpoint:** `GET /api/audit/events`

Both endpoints are protected by `SCHEDULED_SECRET`. Morgan emits structured events for Agent 365 Teams turns, Foundry hosted turns, tool calls, Mission Control task records, and failures. With `APPLICATIONINSIGHTS_CONNECTION_STRING` configured these events become Application Insights custom events. M365 actions through Agent 365/MCP/Graph remain visible in Microsoft Purview audit logs under the executing identity; use Morgan's `correlationId` to join the custom event stream with Purview records.

## Teams Federation Calling

**Status endpoint:** `GET /api/calls/federation/status`

**Mission Control console:** `GET /api/mission-control/teams-call/status` and `POST /api/mission-control/teams-call`

Morgan can ring Teams users through the ACS-to-Teams federation bridge inherited from Cassidy and enhanced for Morgan. Configure `ACS_CONNECTION_STRING`, `ACS_SOURCE_USER_ID`, `BASE_URL`, `PUBLIC_HOSTNAME`, and `AZURE_OPENAI_REALTIME_DEPLOYMENT`, then apply the tenant policy:

```powershell
Set-CsTeamsAcsFederationConfiguration -EnableAcsUsers $true `
	-AllowedAcsResources @{Add='<ACS resource id>'}
```

Set `ACS_TEAMS_FEDERATION_RESOURCE_ID` to the allowed ACS resource marker so Morgan can show readiness in Mission Control and the federation status endpoint. The current bridge is bidirectional audio into Teams; Aria-as-Morgan in the Teams video feed is tracked as the next video sender workstream.

---

## Sample Questions to Ask Morgan

### Budget & Actuals
- "How are we tracking against budget this quarter?"
- "Show me budget vs actuals for marketing"
- "Are there any departments over budget?"
- "What's our total variance for March 2026?"
- "Break down the R&D spend against what was budgeted"

### Financial KPIs
- "What are our key financial metrics?"
- "Give me a summary of our KPIs for Q1"
- "What's our gross margin looking like?"
- "How much cash runway do we have?"
- "What's our monthly burn rate?"

### Anomaly Detection
- "Are there any unusual spending patterns?"
- "Flag any financial anomalies above 10 percent"
- "Which categories are significantly over budget?"
- "Run an anomaly scan on this month's numbers"

### Trend Analysis
- "What's the revenue trend over the last 6 months?"
- "How has our burn rate trended?"
- "Show me the EBITDA trend"
- "Is marketing spend going up or down?"
- "What direction is our cash runway heading?"

### General Context
- "Tell me about the company"
- "What date is it today?"

### Cost and Value
- "Show me the cost of Morgan this week"
- "Open the Morgan cost dashboard"
- "Which Morgan capability is driving the highest run-rate?"
- "What assumptions are used for avatar, Agent 365, Microsoft IQ, Foundry, Fabric, compute, and tools cost?"

### Conversational Follow-ups
- "Why is that category over budget?"
- "What should we do about the variance in OPEX?"
- "Can you compare this month to last month?"
- "Summarise the financial health in one sentence"

---

## Morgan's Tools

| Tool | What It Does | Parameters |
|---|---|---|
| **`analyzeBudgetVsActuals`** | Compares budget vs actual spend by category, flags overruns and calculates variance in dollars and percentages | `period` (required), `category` (optional) |
| **`getFinancialKPIs`** | Returns Gross Margin %, EBITDA, Cash Runway (months), Monthly Burn Rate, and Revenue Growth % | `period` (required) |
| **`detectAnomalies`** | Scans all expense and revenue categories for items exceeding a variance threshold; returns severity-classified alerts (critical / warning / info) | `period` (required), `threshold_percent` (required) |
| **`calculateTrend`** | Calculates a historical trend for a financial metric over N months; returns trend direction and overall change | `metric` (required), `periods` (required) |
| **`get_current_date`** | Returns the current date and time | — |
| **`get_company_context`** | Returns company info: name, ticker, industry, fiscal year end, currency | — |
| **`getMissionControlSnapshot`** | Returns Morgan's job description, autonomous instructions, key tasks, cadence, and daily log | — |
| **`getPaperAlignment`** | Returns Morgan's CorpGen paper alignment matrix with implementation status, enterprise controls, and proof points | — |
| **`recordMissionTaskCompletion`** | Records completed, blocked, or failed work for Mission Control and end-of-day reporting | `task_id`, `summary`, `evidence`, `status` |
| **`generateCfoOperatingPlan`** | Creates a strategic, tactical, and operational CFO plan with dependencies, escalation queue, and proof requirements | — |
| **`listOpenMissionTasks`** | Lists open or blocked Mission Control work and recommends the next autonomous action | — |
| **`getAdaptiveMemorySummary`** | Summarizes working context, structured memory, semantic recall, critical content, and compression policy | — |
| **`getExperientialLearningPlaybook`** | Returns reusable CFO workflow patterns and when Morgan should apply them | — |
| **`getEnterpriseReadiness`** | Checks Agent 365 SDK, MCP, observability, Purview posture, avatar, sub-agents, durable memory, and scheduler safety | — |
| **`evaluateMissionArtifact`** | Scores reports, plans, briefings, demo scripts, and workday summaries for evidence, actionability, governance, and executive readiness | `content` required; `artifact_type`, `title`, `evidence` optional |
| **`getEndOfDayReport`** | Generates the CFO day-end breakdown with completed work, blocked items, and tomorrow priorities | `date` (optional) |
| **`runAutonomousCfoWorkday`** | Runs Morgan's daily finance checks and records the completed work | — |
| **`getMicrosoftIQCapabilityMap`** | Shows how WorkIQ, Foundry IQ, and Fabric IQ fit into Morgan's autonomous CFO operating model | — |
| **`queryWorkIQSignals`** | Returns Microsoft 365 work-context signals such as meetings, finance threads, approvals, Planner due work, and SharePoint artifacts | `period`, `focus` |
| **`queryFoundryIQInsights`** | Returns Foundry-style knowledge, model, trace, evaluation, and artifact-readiness insights | `period`, `focus` |
| **`queryFabricIQFinancials`** | Returns Fabric-style finance figures and cross-functional metrics from a deterministic CFO semantic model | `period`, `business_unit` |
| **`synthesizeMicrosoftIQBriefing`** | Combines WorkIQ, Foundry IQ, and Fabric IQ into an executive CFO briefing with evidence and autonomous actions | `period`, `audience`, `focus` |
| **`getMorganCostDashboard`** | Returns Morgan cost/value summary, category breakdown, Azure actuals, showback assumptions, usage drivers, and recommendations for `/mission-control/costs` | Internal API model for `/api/mission-control/costs` |
| **`getSubAgentRegistry`** | Lists Cassidy, Avatar, and AI Kanban sub-agent endpoint status and capabilities | — |
| **`callSubAgent`** | Calls a configured specialist sub-agent endpoint | `agent_id`, `message`, `path` (optional) |
| **`getTeamsFederationCallingStatus`** | Checks ACS-to-Teams federation readiness, active calls, tenant policy command, and video-presence roadmap | — |
| **`initiateTeamsFederatedCall`** | Rings any supplied Teams user object ID through ACS-to-Teams federation | `reason`, `teams_user_aad_oid`, `target_display_name`, `requested_by`, `instructions` |
| **`initiateTeamsCallToCfo`** | Rings the CFO/operator in Microsoft Teams through the ACS federation bridge for urgent finance escalation | `reason`, `teams_user_aad_oid` (optional) |

---

## Production Integration Map

Each tool currently returns deterministic mock data for consistent demos. In production, each tool would make an authenticated API call to the corresponding system.

### Tool → Data Source Mapping

| Tool | Production Data Source | Integration Method |
|---|---|---|
| **`analyzeBudgetVsActuals`** | **SAP S/4HANA** or **Oracle NetSuite** GL module | REST API — pulls real-time budget allocations and posted actuals from the ERP general ledger |
| **`getFinancialKPIs`** | **Power BI Dataflows** or **Microsoft Fabric Lakehouse** | Semantic Link / REST API — queries the aggregated KPI layer sitting on top of the enterprise data warehouse |
| **`detectAnomalies`** | **Azure Anomaly Detector** + **Dataverse** | Azure AI Services — ML-based anomaly scoring against historical GL posting patterns and seasonal baselines |
| **`calculateTrend`** | **Azure Data Explorer (Kusto)** | KQL queries — time-series analysis against financial telemetry stored in ADX clusters |
| **`get_company_context`** | **Microsoft Graph** + **Dataverse** | Graph API — org profile, tenant metadata, fiscal calendar from the company's M365/Dynamics tenant |
| **`queryWorkIQSignals`** | **Microsoft Graph / Agent 365 MCP / Microsoft 365 Copilot context** | Graph and Agent 365 MCP — meetings, mail, Teams, Planner, SharePoint, Word, Excel, and work-graph signals |
| **`queryFoundryIQInsights`** | **Microsoft Foundry Project** | Foundry project API — knowledge indexes, model deployments, agent traces, prompt/eval datasets, evaluator results, and hosted-agent telemetry |
| **`queryFabricIQFinancials`** | **Microsoft Fabric / Power BI semantic model** | Fabric REST/API or semantic link — OneLake, Lakehouse/Warehouse, Data Factory pipelines, Power BI semantic model, and cross-domain finance data products |
| **`synthesizeMicrosoftIQBriefing`** | **WorkIQ + Foundry IQ + Fabric IQ** | Multi-source orchestration — correlate work context, model/eval readiness, and governed business metrics into CFO-ready action |

### Platform & Channel Integrations

| System | How Morgan Uses It | Status |
|---|---|---|
| **Microsoft Teams** | Chat interface + proactive P&L alerts posted to the Finance channel on a 25-minute monitoring cycle | ✅ Live |
| **Azure Voice Live + Speech Avatar** | Real-time speech-to-speech avatar via browser — HD neural voice (Ava), WebRTC avatar relay, server-side VAD, noise suppression, echo cancellation | ✅ Live |
| **Azure Communication Services** | Cassidy-style ACS-to-Teams federation calling, inbound ACS call answer, and bidirectional audio bridge to Azure OpenAI realtime | Configure `ACS_CONNECTION_STRING` and Teams federation policy |
| **Mission Control** | Live job description, key tasks, daily work log, and end-of-day CFO breakdown | ✅ Live |
| **CorpGen cognitive toolchain** | Operating plan, open-task selection, adaptive memory, experiential learning, readiness checks, and artifact judge surfaced as real tools | ✅ Live |
| **Microsoft IQ command layer** | WorkIQ, Foundry IQ, and Fabric IQ tools synthesize M365 work context, Foundry model/eval intelligence, and Fabric business data into CFO-ready insights | ✅ Live demo |
| **Cost of Morgan** | Daily/weekly cost and value dashboard with Azure Cost Management actuals plus showback estimates for avatar, Agent 365, Microsoft IQ, Foundry, Fabric, compute, tools, storage, and observability | ✅ Live |
| **Azure OpenAI (GPT-5)** | Primary LLM for reasoning, tool selection, and response generation (East US 2, 100K TPM) | ✅ Live |
| **MCP (Model Context Protocol)** | Runtime tool extensibility — add new tools without redeploying the agent | ✅ Live |
| **Cassidy / Avatar / AI Kanban** | Sub-agent swarm endpoints for operations, visible avatar experience, and task-board intelligence | Configure endpoint env vars |
| **SharePoint / OneDrive** | Pull board decks, quarterly reports, and budget spreadsheets as grounding data for RAG | 🔜 Production |
| **Dynamics 365 Finance** | AP/AR aging, cash flow forecasting, intercompany reconciliation, journal entries | 🔜 Production |
| **Bloomberg / Refinitiv API** | Market data feeds, peer benchmarking, FX rates for multi-currency reporting | 🔜 Production |
| **Azure Data Explorer** | Time-series financial telemetry, real-time dashboarding, ad hoc KQL queries | 🔜 Production |
| **Microsoft Fabric** | Unified analytics — lakehouse, data pipelines, Power BI semantic models as a single source of truth | 🔜 Production |

---

## Architecture Summary

| Component | Technology |
|---|---|
| Agent Runtime | Microsoft Agents SDK (`@microsoft/agents-hosting` v1.2.2) |
| LLM | Azure OpenAI GPT-5 (East US 2, 100K TPM) |
| Voice | Azure Voice Live API + HD Neural Voice (en-US-Ava:DragonHDLatestNeural) |
| Hosting | Azure App Service (B1, Node.js 20, Australia East) |
| Auth | Azure Managed Identity + DefaultAzureCredential |
| Chat Channel | Microsoft Teams (Agentic Auth) |
| Voice Channel | Browser WebSocket → server-side Voice Live proxy |
| Proactive Alerts | 25-min interval P&L monitoring → Teams channel |
| Tool Extension | MCP (Model Context Protocol) for runtime tool registration |
