# Morgan Wiring Gaps

This is the current wiring audit for Morgan after the sub-agent review pass. It separates items that are now wired in code from items that still require tenant resources, secrets, or external services.

## Wired in this pass

| Area | Status | Notes |
|---|---|---|
| Scheduled endpoint auth | Wired | Express scheduled endpoints now accept `x-scheduled-secret`, `Authorization: Bearer <secret>`, body `secret`, and query `secret` where appropriate. |
| 09:00-17:00 scheduler | Wired and verified self-running | The App Service is scaled to Basic B1 with Always On enabled, so the in-process autonomous scheduler (gated by `AUTONOMOUS_WORKDAY_ENABLED=true`) runs daily 09:00-17:00 Europe/London without external triggers; `lastCycleAt` is populated, confirming self-running cycles. Azure Functions still include a seven-day `autonomousWorkdayCycle` timer plus daily 17:00 `endOfDayReport` timer for optional external scheduling. |
| Sub-agent execution loop | Wired; external auth/config pending | `runAutonomousCfoWorkday` now attempts live AI Kanban and Cassidy handoffs when valid endpoints are configured, records completed/skipped/failed evidence, and avoids failing the whole run when endpoints are missing. Placeholder URLs are treated as unconfigured, and optional bearer/shared-secret headers can authenticate agent-to-agent calls. |
| Mission Control task/cognitive tools | Wired | `getTodaysTaskRecords` and `getCognitiveToolchain` are now agent-callable tools, not only internal exports. |
| Health readiness | Wired | `/api/health` now reports subsystem readiness for OpenAI, Voice Live, Speech avatar, scheduler secret, MCP, Foundry, Fabric/Power BI, Application Insights, durable memory, and sub-agent endpoints. |
| Agent conversation storage | Wired when Cosmos settings exist | The Agent SDK now uses Cosmos-backed storage when `COSMOS_DB_ENDPOINT`, `COSMOS_DB_DATABASE`, and `COSMOS_DB_CONTAINER` are configured; otherwise it reports memory fallback honestly. |
| Teams call UX | Wired | Mission Control now explains which Teams calling settings are missing, adds a disabled-button tooltip, and applies a request timeout for call initiation. |
| Tool-call observability | Wired | Tool audit events now classify calls by source: finance, report, Microsoft IQ, MCP static/discovered, Mission Control, sub-agent orchestration, Teams calling, or utility. |
| D-ID humanoid avatar | Wired in code (hosted image + App Service) | `src/voice/didConfig.ts`, `src/voice/didAvatarService.ts`, `src/voice/didAvatarRoutes.ts`, `src/voice/didWebSocketHandler.ts`, and `did-voice.html` serve the humanoid avatar at `/voice/did` and `/api/avatar/did/*`. The Mission Control avatar toggle (`avatarToggleManager.ts` + `avatar-toggle-ui.js`) switches presentation modes. Live D-ID rendering still needs a D-ID API key/account. |
| HITL L2/L3 approvals | Wired in code; prompt-level gating, process-local state | `src/mission/hitlApprovals.ts` + `hitl-approvals.html` surface approvals at `/approvals`, with routes `/api/hitl/approvals`, `/api/hitl/approvals/surface`, `/api/hitl/approvals/send-mod-card`, and `/api/hitl/approvals/:id/decision`, plus tools `listHitlApprovalRequests`, `getHitlApprovalSurface`, `recordHitlApprovalDecision`, and `sendHitlApprovalCardToModAdministrator`. Honest caveat: gating is enforced through persona/prompt rules, not a hard dispatcher interceptor, and decisions persist in process memory only. |
| Agentic kanban link | Wired in code | `src/mission/agenticKanban.ts` serves `/agentic-kanban` and `/api/mission-control/agentic-kanban`. |
| CFO retrospectives | Wired in code | `src/tools/retrospectiveTools.ts` exposes the `generateCfoRetrospective` and `getRetrospectiveHistory` tools, surfaced at `/api/mission-control/retrospectives`. |
| Governance observability surface | Wired in code | `/api/mission-control/governance` returns governance observability data for Mission Control. |
| Mission Control status/config endpoints | Wired in code | `/api/workiq/status`, `/api/avatar/config` (now including `voiceStyle` and `agenticKanban`), `/api/avatar/readiness`, and `/api/mission-control/corpgen-report` are agent- and UI-callable. Live WorkIQ graph data still depends on Agent 365/MCP (tracked below). |
| Sub-agent registry kind | Wired in code | The sub-agent registry now records a `kind` field (`specialist` or `bridge`) to distinguish specialist agents from bridge handoffs. |
| Agent SDK + build hardening | Wired in code | Upgraded to `@microsoft/agents-a365-tooling` 1.0.0, `@microsoft/agents-hosting` 1.5.2, and `@microsoft/agents-activity` 1.5.1. The Dockerfile installs with `npm install` (not `npm ci`) for cross-platform lockfile resilience, and `.dockerignore` was tightened so the build context dropped from roughly 1 GB to about 8 MB. |

## Current deployment state

| Surface | State | Notes |
|---|---|---|
| Foundry hosted agent | Active at version 17 | `morgan-digital-cfo-hosted` is active in the North Central US project `ai-project-morgan-hosted-ncus`, protocol `responses/1.0.0`, model deployment `gpt-5-mini`. Image `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260612110227` (digest `sha256:46506783a7036fd7d5337cd749fb51650df6f195beeb4546d00e40d5104a7064`). This version carries the feature-parity port and upgraded Agent SDK and re-passed all four hosted P0 smoke prompts through the direct REST Responses route. Versions 10 and 16 remain prior known-good restore points. |
| Hosted environment payload | Verified-minimal | Only `NODE_ENV`, `HOST`, `MORGAN_FOUNDRY_RESPONSES_ONLY`, `AUTONOMOUS_WORKDAY_*`, `AZURE_CLIENT_ID`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT=gpt-5-mini`, and `AZURE_OPENAI_API_VERSION` are set. Graph/MCP, voice, observability, and durable storage are intentionally not configured in the hosted payload, so hosted model text must not be read as proof those connectors are live. |
| App Service | Basic B1, Always On | Scaled to Basic B1 with Always On enabled so the in-process autonomous workday scheduler runs daily 09:00-17:00 Europe/London (`AUTONOMOUS_WORKDAY_ENABLED=true`, verified self-running with `lastCycleAt` populated). |

## Still tenant-dependent

| Gap | Required wiring | How to verify |
|---|---|---|
| Live sub-agent swarm | Production verification showed `AI_KANBAN_AGENT_ENDPOINT` is still a placeholder and Cassidy returns `401` without an auth header. Set a real AI Kanban endpoint and configure either `*_AGENT_BEARER_TOKEN`/`SUB_AGENT_BEARER_TOKEN` or `*_AGENT_SHARED_SECRET`/`SUB_AGENT_SHARED_SECRET` for protected agents. `AVATAR_AGENT_ENDPOINT` should point to a real A2A presentation endpoint if used for delegation, not just the browser `/voice` page. | `scripts/verify-production-workday.ps1` shows each `subAgentHandoffs[].status` as `completed`. |
| Function App scheduling | Optional now that the App Service scheduler exists. If a separate Function App is provisioned, configure it with `MORGAN_AGENT_URL`, `SCHEDULED_SECRET`, and optionally `WEBSITE_TIME_ZONE`. The secret must match the Morgan App Service setting. | `/api/health` shows the App Service scheduler status; Function logs show `autonomousWorkdayCycle` and `endOfDayReport` returning HTTP 200/202 when an external Function App is used. |
| WorkIQ live graph | Configure Agent 365/MCP platform endpoint and identity/agentic auth so Graph/M365 tools can execute against the tenant. | `getMcpTools` returns live tools and Agent Mind shows MCP/Graph tool calls. |
| Foundry IQ live intelligence | Connect `FOUNDRY_PROJECT_ENDPOINT`, Foundry knowledge assets, model deployments, traces, and evaluation datasets. | `/responses/health` is ready, Foundry batch eval runs against `.foundry/datasets/morgan-digital-cfo-dev-test-v1.jsonl`, and Mission Control readiness marks Foundry IQ configured. |
| Fabric IQ live data | Set `FABRIC_WORKSPACE_ID`, `FABRIC_LAKEHOUSE_ID`, `FABRIC_SEMANTIC_MODEL_ID`, or `POWERBI_SEMANTIC_MODEL_ID`, then replace deterministic demo adapters with tenant semantic-model queries. | `/api/health` marks Fabric/Power BI configured and Fabric IQ outputs tenant-owned figures rather than Contoso demo figures. |
| Teams federation calling | Configure `ACS_CONNECTION_STRING`, source identity, public callback host, realtime voice endpoint, CFO target ID, and apply the Teams federation policy for the ACS resource. | Mission Control Teams Call Control shows federation ready and `/api/calls/federation/status` includes the expected resource marker. |
| Durable mission records | Agent conversation state can use Cosmos now, but production is missing `COSMOS_DB_ENDPOINT`, so `/api/health` reports memory fallback. Mission Control task records, memory summaries, artifact evaluations, and HITL approval decisions are still process-local arrays. Wire those records to Cosmos/Azure Storage before multi-instance production. | `/api/health` reports `agentStorage.backend: cosmos`; app restart does not clear Mission Control task records, adaptive memory, artifact evaluations, or HITL approval decisions. |
| Observability/Purview | Set Application Insights and Log Analytics settings and connect audit export to the enterprise review workspace. | `/api/observability` shows Application Insights configured and Morgan custom events appear with correlation IDs. |
| Managed identity RBAC | Grant the App Service managed identity Cognitive Services/Azure AI permissions for Azure OpenAI, Voice Live, and Speech avatar resources. | `/api/health` remains healthy and first agent/avatar requests do not fail with `DefaultAzureCredential` 401/403 errors. |

## Next execution order

1. Confirm `/api/health` reports `configuration.autonomousScheduler.enabled: true` and the expected timezone/window.
2. Point AI Kanban and Cassidy endpoints at real deployed agents, configure their A2A auth tokens/secrets, and run `scripts/verify-production-workday.ps1` once to confirm handoffs.
3. Replace the Fabric IQ demo adapter with a read-only Power BI/Fabric semantic-model query path.
4. Connect Foundry IQ to real trace/evaluation artifacts and run the P0 dataset.
5. Add durable storage for Mission Control records (including HITL approval decisions) before scaling to multi-instance production, so prompt-level HITL gating can be backed by enforced, persisted approvals.
