# Morgan Wiring Gaps

This is the current wiring audit for Morgan after the sub-agent review pass. It separates items that are now wired in code from items that still require tenant resources, secrets, or external services.

## Wired in this pass

| Area | Status | Notes |
|---|---|---|
| Scheduled endpoint auth | Wired | Express scheduled endpoints now accept `x-scheduled-secret`, `Authorization: Bearer <secret>`, body `secret`, and query `secret` where appropriate. |
| 09:00-17:00 scheduler | Wired | The App Service now has an in-process autonomous scheduler gated by `AUTONOMOUS_WORKDAY_ENABLED`, and Azure Functions include a seven-day `autonomousWorkdayCycle` timer plus daily 17:00 `endOfDayReport` timer for external scheduling. |
| Sub-agent execution loop | Wired; external auth/config pending | `runAutonomousCfoWorkday` now attempts live AI Kanban and Cassidy handoffs when valid endpoints are configured, records completed/skipped/failed evidence, and avoids failing the whole run when endpoints are missing. Placeholder URLs are treated as unconfigured, and optional bearer/shared-secret headers can authenticate agent-to-agent calls. |
| Mission Control task/cognitive tools | Wired | `getTodaysTaskRecords` and `getCognitiveToolchain` are now agent-callable tools, not only internal exports. |
| Health readiness | Wired | `/api/health` now reports subsystem readiness for OpenAI, Voice Live, Speech avatar, scheduler secret, MCP, Foundry, Fabric/Power BI, Application Insights, durable memory, and sub-agent endpoints. |
| Agent conversation storage | Wired when Cosmos settings exist | The Agent SDK now uses Cosmos-backed storage when `COSMOS_DB_ENDPOINT`, `COSMOS_DB_DATABASE`, and `COSMOS_DB_CONTAINER` are configured; otherwise it reports memory fallback honestly. |
| Teams call UX | Wired | Mission Control now explains which Teams calling settings are missing, adds a disabled-button tooltip, and applies a request timeout for call initiation. |
| Tool-call observability | Wired | Tool audit events now classify calls by source: finance, report, Microsoft IQ, MCP static/discovered, Mission Control, sub-agent orchestration, Teams calling, or utility. |

## Still tenant-dependent

| Gap | Required wiring | How to verify |
|---|---|---|
| Live sub-agent swarm | Production verification showed `AI_KANBAN_AGENT_ENDPOINT` is still a placeholder and Cassidy returns `401` without an auth header. Set a real AI Kanban endpoint and configure either `*_AGENT_BEARER_TOKEN`/`SUB_AGENT_BEARER_TOKEN` or `*_AGENT_SHARED_SECRET`/`SUB_AGENT_SHARED_SECRET` for protected agents. `AVATAR_AGENT_ENDPOINT` should point to a real A2A presentation endpoint if used for delegation, not just the browser `/voice` page. | `scripts/verify-production-workday.ps1` shows each `subAgentHandoffs[].status` as `completed`. |
| Function App scheduling | Optional now that the App Service scheduler exists. If a separate Function App is provisioned, configure it with `MORGAN_AGENT_URL`, `SCHEDULED_SECRET`, and optionally `WEBSITE_TIME_ZONE`. The secret must match the Morgan App Service setting. | `/api/health` shows the App Service scheduler status; Function logs show `autonomousWorkdayCycle` and `endOfDayReport` returning HTTP 200/202 when an external Function App is used. |
| WorkIQ live graph | Configure Agent 365/MCP platform endpoint and identity/agentic auth so Graph/M365 tools can execute against the tenant. | `getMcpTools` returns live tools and Agent Mind shows MCP/Graph tool calls. |
| Foundry IQ live intelligence | Connect `FOUNDRY_PROJECT_ENDPOINT`, Foundry knowledge assets, model deployments, traces, and evaluation datasets. | `/responses/health` is ready, Foundry batch eval runs against `.foundry/datasets/morgan-digital-cfo-dev-test-v1.jsonl`, and Mission Control readiness marks Foundry IQ configured. |
| Fabric IQ live data | Set `FABRIC_WORKSPACE_ID`, `FABRIC_LAKEHOUSE_ID`, `FABRIC_SEMANTIC_MODEL_ID`, or `POWERBI_SEMANTIC_MODEL_ID`, then replace deterministic demo adapters with tenant semantic-model queries. | `/api/health` marks Fabric/Power BI configured and Fabric IQ outputs tenant-owned figures rather than Contoso demo figures. |
| Teams federation calling | Configure `ACS_CONNECTION_STRING`, source identity, public callback host, realtime voice endpoint, CFO target ID, and apply the Teams federation policy for the ACS resource. | Mission Control Teams Call Control shows federation ready and `/api/calls/federation/status` includes the expected resource marker. |
| Durable mission records | Agent conversation state can use Cosmos now, but production is missing `COSMOS_DB_ENDPOINT`, so `/api/health` reports memory fallback. Mission Control task records, memory summaries, and artifact evaluations are still process-local arrays. Wire those records to Cosmos/Azure Storage before multi-instance production. | `/api/health` reports `agentStorage.backend: cosmos`; app restart does not clear Mission Control task records, adaptive memory, or artifact evaluations. |
| Observability/Purview | Set Application Insights and Log Analytics settings and connect audit export to the enterprise review workspace. | `/api/observability` shows Application Insights configured and Morgan custom events appear with correlation IDs. |
| Managed identity RBAC | Grant the App Service managed identity Cognitive Services/Azure AI permissions for Azure OpenAI, Voice Live, and Speech avatar resources. | `/api/health` remains healthy and first agent/avatar requests do not fail with `DefaultAzureCredential` 401/403 errors. |

## Next execution order

1. Confirm `/api/health` reports `configuration.autonomousScheduler.enabled: true` and the expected timezone/window.
2. Point AI Kanban and Cassidy endpoints at real deployed agents, configure their A2A auth tokens/secrets, and run `scripts/verify-production-workday.ps1` once to confirm handoffs.
3. Replace the Fabric IQ demo adapter with a read-only Power BI/Fabric semantic-model query path.
4. Connect Foundry IQ to real trace/evaluation artifacts and run the P0 dataset.
5. Add durable storage for Mission Control records before scaling to multi-instance production.
