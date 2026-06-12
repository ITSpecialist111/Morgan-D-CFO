# Morgan Digital CFO — Daily Showcase Runbook

A working, repeatable daily showcase. Two surfaces are live:

| Surface | URL / how to invoke | What it's for |
|---|---|---|
| **Hosted Foundry agent** | Foundry project `ai-project-morgan-hosted-ncus`, agent `morgan-digital-cfo-hosted` (version **17**, `gpt-5-mini`) | "Invoke Morgan as a governed hosted agent" — vNext Responses |
| **App Service (rich UI)** | https://morganfinanceagent-webapp.azurewebsites.net | Mission Control, voice, D-ID avatar, HITL approvals, governance view |

---

## 1. Current deployed state (verified 2026-06-12)

- **Hosted agent**: version **17**, image `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260612110227` (digest `sha256:46506783…`), protocol `responses/1.0.0`, model `gpt-5-mini`. P0 smoke: **all 4 prompts passed** via direct REST. Verified-minimal env (Azure OpenAI routing only; Graph/MCP/voice/storage intentionally not configured).
- **App Service**: F1 (Free) tier, **healthy**, running the latest code (SDK upgrade + ECIF→CFO feature-parity port). `AUTONOMOUS_WORKDAY_ENABLED=true`.
- Both built from the same repo. The hosted image's Dockerfile uses `npm install` (not `npm ci`) for cross-platform lockfile resilience.

---

## 2. Make it run every day (one-time setup)

The App Service is on the **Free tier** (idles after ~20 min, no "Always On"), so a daily external trigger is used. A free GitHub Actions cron is included: `.github/workflows/morgan-daily-workday.yml` (daily 08:00 UTC).

**One-time step** — add two repo secrets (GitHub → repo → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `MORGAN_APP_URL` | `https://morganfinanceagent-webapp.azurewebsites.net` |
| `MORGAN_SCHEDULED_SECRET` | the `SCHEDULED_SECRET` value configured on the App Service (in `.env` / App Service settings) |

Then commit/push the workflow. It will wake the app and run Morgan's autonomous CFO workday daily, populating Mission Control with fresh work. You can also run it on demand from the **Actions** tab → *Run workflow*.

> Optional (paid) alternative: upgrade the App Service plan to **B1** and enable **Always On** + keep `AUTONOMOUS_WORKDAY_ENABLED=true`; the in-process 09:00–17:00 scheduler then runs without an external trigger (~$13/mo).

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
- The hosted agent (v17) proves **reachability, Azure OpenAI routing, and bounded behavior** — not Graph/MCP, voice, observability, durable storage, or sub-agent production parity.
- App Service is **Free tier** — first request after idle cold-starts (~30–90s); the daily cron warms it.
