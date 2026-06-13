# Morgan Digital CFO — Daily Showcase Runbook

A working, repeatable daily showcase. Two surfaces are live:

| Surface | URL / how to invoke | What it's for |
|---|---|---|
| **Hosted Foundry agent** | Foundry project `ai-project-morgan-hosted-ncus`, agent `morgan-digital-cfo-hosted` (version **17**, `gpt-5-mini`) | "Invoke Morgan as a governed hosted agent" — vNext Responses |
| **App Service (rich UI)** | https://morganfinanceagent-webapp.azurewebsites.net | Mission Control, voice, D-ID avatar, HITL approvals, governance view |

---

## D-ID humanoid avatar — domain authorization

The D-ID browser SDK authorizes connections with a **client key** that is scoped to an
explicit `allowed_domains` list (a D-ID **API-only** feature — there is no such setting in the
D-ID Studio UI). If a deployment's domain is not on that list, the browser gets **HTTP 401**
and a CORS-looking error when connecting, even though the API key, agent, and client key are all valid.

Morgan's client key already authorizes its production domains, for example:
`studio.d-id.com`, `morganfinanceagent-webapp.azurewebsites.net`, and `localhost:3978`.

To authorize a **new** domain (no redeploy needed — the key value doesn't change):

```powershell
node scripts/did-allow-domain.cjs https://your-app.azurewebsites.net
```

The script reads `DID_API_KEY` / `DID_AGENT_ID` / `DID_CLIENT_KEY` from `.env`, PATCHes the
client key to add the domain (preserving existing domains, so other deployments keep working),
and verifies. Secrets are never printed.

---

## D-ID humanoid avatar — expressiveness (voice delivery)

How "expressive" Morgan sounds (emotional range, warmth, emphasis) is driven by the D-ID
agent's **presenter voice config**, not by the page. Out of the box the agent used
`eleven_flash_v2_5` with **no** `voice_config`, which is ElevenLabs' fastest but flattest /
most monotone profile. Morgan now uses an expressive-but-executive profile:

| Setting | Value | Effect |
|---|---|---|
| `model_id` | `eleven_turbo_v2_5` | Richer emotion than `flash`, still low-latency for streaming |
| `stability` | `0.4` | Lower = more emotional variation (default is ~0.5/flat) |
| `style` | `0.4` | Style exaggeration — the main "expressiveness" dial |
| `similarity_boost` | `0.85` | Keeps Morgan's voice identity strong |
| `use_speaker_boost` | `true` | More vocal presence |

These are env-tunable (`ELEVENLABS_MODEL_ID`, `ELEVENLABS_STABILITY`, `ELEVENLABS_STYLE`,
`ELEVENLABS_SIMILARITY_BOOST`, `ELEVENLABS_USE_SPEAKER_BOOST`, `ELEVENLABS_RATE`) and baked into
the app's desired-state (`getDesiredDidVoiceConfig`), so the `/api/avatar/did/session`
enforcement reinforces them instead of resetting to flat.

Apply / dial / revert the live agent voice with the helper:

```powershell
# apply the expressive profile (defaults, or .env values)
node scripts/did-set-voice-expressiveness.cjs
# dial it further (more emotion)
node scripts/did-set-voice-expressiveness.cjs --style 0.6 --stability 0.3
# slow her down slightly
node scripts/did-set-voice-expressiveness.cjs --rate 0.95
# back to the flat default
node scripts/did-set-voice-expressiveness.cjs --revert
```

> Note: this D-ID agent (`v2_agt_vXoxDzYG`) is shared with another Morgan deployment, so a voice
> change here applies to both. After changing, reload `/voice/did` and
> reconnect to hear the new delivery.

---

## 1. Current deployed state (verified 2026-06-13)

- **Hosted agent**: version **19**, image `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260612110227` (digest `sha256:46506783…`), protocol `responses/1.0.0`, model `gpt-5-mini`. Version 19 restores this known-good image after a transient platform-side Responses 500 affected v18 (image/model/protocol unchanged). P0 smoke: **all 4 prompts passed** via direct REST. Verified-minimal env (Azure OpenAI routing only; Graph/MCP/voice/storage intentionally not configured).
- **App Service**: **Basic B1** tier with **Always On enabled**, **healthy**, running the latest code (SDK upgrade + digital-worker capability port + LLM-driven Kanban work selection). `AUTONOMOUS_WORKDAY_ENABLED=true`, timezone **Europe/London**, window **09:00–17:00**.
- **D-ID humanoid avatar**: connected — the App Service domain is authorized on the D-ID client key, and the voice runs the expressive `eleven_turbo_v2_5` profile (see the two D-ID sections above). The D-ID agent is shared with another Morgan deployment.
- Plan `rg-morgan-finance-agent-plan` (Australia East, B1) is shared with one other web app; Always On is enabled only on the D-CFO app.
- Both built from the same repo. The hosted image's Dockerfile uses `npm install` (not `npm ci`) for cross-platform lockfile resilience.

---

## 2. How it runs every day (already configured — no action needed)

Because the App Service is on **B1 with Always On**, the app process stays alive permanently and the **in-process autonomous scheduler runs the CFO workday on its own**, every day, during **09:00–17:00 Europe/London** (a cycle every 25 min, with an end-of-day report after close). This was verified live: the scheduler reported `started:true`, `inWindow:true`, and an automatic `lastCycleAt` with no external trigger.

**What each cycle actually does:** Morgan advances ~2 concrete cards on the **autonomous CFO Kanban** through `queue → active → review → done` (HITL-gated cards like the board-P&L L2 and the $250k reforecast / vendor-payment L3 hold in **waiting** until approved), records the finance work (budget vs actuals, KPIs, anomaly scan, Microsoft IQ briefing), and **replenishes the queue** so there is always work. The work backlog (concrete CFO cards: board pack, month-end close, marketing overspend, cash/runway, anomaly, headcount, weekly digest, plus the HITL cards) persists to `$HOME/data/morgan-cfo-workcards.json` — on App Service `$HOME` is durable Azure Files, so **progress and history survive restarts and redeploys** (only `/home/site/wwwroot` is replaced on deploy). Each card keeps a timestamped state-transition history.

> Multi-instance / stronger durability is the one remaining production upgrade: wire **Cosmos DB** (`COSMOS_DB_*`; `agentStorage.ts` already supports it). It is not required for the single-instance B1 showcase because the `$HOME/data` file store is already durable there.

You do **not** need to do anything for the daily run — just open Mission Control and the fresh autonomous work (cards mid-flight across the board, with history) is there.

**Tuning (optional)** — App Service → Configuration → application settings:
- `AUTONOMOUS_WORKDAY_TIME_ZONE` (default `Europe/London`)
- `AUTONOMOUS_WORKDAY_START_HOUR` / `AUTONOMOUS_WORKDAY_END_HOUR` (default `9` / `17`)
- `AUTONOMOUS_WORKDAY_INTERVAL_MINUTES` (default `25`)
- `AUTONOMOUS_WORKDAY_ENABLED` (default `true`)

**Optional backup trigger** — `.github/workflows/morgan-daily-workday.yml` can force a run on a schedule or on demand regardless of the window. It's not required now that Always On runs the scheduler in-process, but it's handy to force fresh data right before a demo. To use it, add repo secrets `MORGAN_APP_URL` and `MORGAN_SCHEDULED_SECRET` (GitHub → Settings → Secrets and variables → Actions) and run it from the Actions tab.

---

## 3. Daily demo flow (App Service)

1. Open **https://morganfinanceagent-webapp.azurewebsites.net/mission-control** (sign in with the configured Entra account — Mission Control APIs are EasyAuth-gated).
2. Show the **job description, operating cadence, Kanban, blockers, cost line, audit** — the digital-worker cockpit.
3. Open **/voice** (Azure Voice Live avatar) and **/voice/did** (D-ID humanoid) — use the **avatar toggle** in Mission Control.
4. Open **/approvals** — the **HITL L2/L3** queue (board P&L send, $250k reforecast, variance post, vendor payment). Approve / edit / decline / cancel.
5. Show the **Governance** view (prompts, chain-of-thought summary, tool selection, HITL gates, audit ledger) and **Retrospectives**.
6. Trigger work live: in Teams/chat ask "What's the latest P&L?", "Any anomalies?", "Give me a Microsoft IQ briefing", "Run your autonomous workday".

Follow `docs/dragons-den-talk-track.md` for the timed video script.

---

## 4. Manually trigger / refresh the workday (anytime)

```powershell
# from the repo (reads SCHEDULED_SECRET from .env, does not print it)
$secret = (Get-Content .env | Where-Object { $_ -match '^\s*SCHEDULED_SECRET\s*=' }) -replace '^\s*SCHEDULED_SECRET\s*=\s*','' -replace '"',''
curl.exe -sS -X POST "https://morganfinanceagent-webapp.azurewebsites.net/api/mission-control/run-workday" `
  -H "x-scheduled-secret: $secret" -H "Content-Type: application/json" `
  -d '{"trigger":"manual-demo"}' -w "`nHTTP %{http_code}`n"
```

---

## 5. Invoke the hosted Foundry agent (vNext Responses)

```powershell
$tok = az account get-access-token --resource "https://ai.azure.com" --query accessToken -o tsv
$url = "https://ai-account-bdoregvn6di7y.services.ai.azure.com/api/projects/ai-project-morgan-hosted-ncus/agents/morgan-digital-cfo-hosted/endpoint/protocols/openai/responses?api-version=v1"
curl.exe -sS -X POST $url -H "Authorization: Bearer $tok" -H "Foundry-Features: HostedAgents=V1Preview" `
  -H "Content-Type: application/json" -d '{"input":"Give a concise Morgan Digital CFO status update."}'
```

---

## 6. Rebuild & redeploy (when code changes)

```powershell
# 1) validate
npm run build

# 2) hosted image (Linux AMD64) — tag = timestamp
$tag = Get-Date -Format 'yyyyMMddHHmmss'
az acr build --registry crbdoregvn6di7y --image "morgan-digital-cfo:$tag" --platform linux/amd64 --file Dockerfile .

# 3) update hosted agent: Foundry MCP agent_update with the new image + the known-good
#    minimal env (NODE_ENV, HOST, MORGAN_FOUNDRY_RESPONSES_ONLY, AUTONOMOUS_WORKDAY_*,
#    AZURE_CLIENT_ID=4f0bb8b4-4ebd-497b-bc7c-a20cb72a8663,
#    AZURE_OPENAI_ENDPOINT=https://ai-account-bdoregvn6di7y.cognitiveservices.azure.com/,
#    AZURE_OPENAI_DEPLOYMENT=gpt-5-mini, AZURE_OPENAI_API_VERSION=2025-04-01-preview)
#    then poll agent_get until status=active, then run the §5 smoke.

# 4) App Service (code-only; preserves settings/auth/roles)
node scripts/deploy-appservice-zip.cjs --skip-settings --skip-auth --skip-roles
```

> Do **not** pass `--source-acr-auth-id` for this registry. Do **not** run hosted `agent_update` against Flightdeck (`uksouth` — unsupported for hosted preview).

---

## 7. Honesty caveats (do not overclaim on camera)

- Financial figures are **deterministic Contoso demo data**; IQ pillars run on demo adapters. Methods/cadence/governance/cost economics are real. Point Morgan at a Fabric/Power BI model, GL/ERP, Agent 365 MCP, and Cosmos to run on live data (contracts are production-shaped).
- The hosted agent (v19) proves **reachability, Azure OpenAI routing, and bounded behavior** — not Graph/MCP, voice, observability, durable storage, or sub-agent production parity.
- App Service runs on **B1 with Always On**, so it stays warm (no cold-start) and the in-process scheduler runs daily. Note durable state is still process-local until Cosmos is wired, so an app restart/redeploy resets the in-memory task ledger.
