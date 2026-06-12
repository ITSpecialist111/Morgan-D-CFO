# Morgan Foundry Hosted Agent

Date: 2026-05-07

Morgan D-CFO should be represented in Microsoft Foundry as a hosted agent, not only as an App Service web app.

Command inventory and run gates are tracked in [hosted-agent-command-research.md](hosted-agent-command-research.md).

The App Service deployment remains useful for Mission Control, avatar, voice, browser auth, and public showcase surfaces. The Foundry hosted agent is the cloud agent record that runs Morgan's actual TypeScript runtime through the `/responses` protocol.

## Current State

Morgan already has the important hosted-agent pieces:

- `Dockerfile` builds the Node.js 20 runtime and exposes `8088`.
- `src/foundryHost.ts` starts a dedicated Foundry Responses host without requiring Teams/Bot credentials.
- `src/foundry/responsesAdapter.ts` implements `GET /readiness`, `GET /responses/health`, and `POST /responses`.
- `agent.yaml` declares hosted intent and responses/a2a protocols.
- `package.json` builds TypeScript and static assets with `npm run build`.
- `.foundry/agent-metadata.yaml` now has a concrete `flightdeckHostedCandidate` environment.
- `.foundry/datasets/morgan-digital-cfo-hosted-smoke-v1.jsonl` contains the P0 hosted-agent smoke dataset.
- `.foundry/evaluators/morgan-hosted-p0-smoke.yaml` defines the local evaluator cache.

The Dockerfile now handles both lockfile and no-lockfile cases, because this repository currently does not include `package-lock.json`; using `npm ci` unconditionally would fail in ACR. The Docker command starts `dist/foundryHost.js` for Foundry rather than the full App Service/Teams entry point.

## Working Hosted Environment

Morgan is now created and invokable as a Microsoft Foundry hosted agent in North Central US:

- Project endpoint: `https://ai-account-bdoregvn6di7y.services.ai.azure.com/api/projects/ai-project-morgan-hosted-ncus`
- Resource group: `rg-morgan-hosted-ncus`
- Foundry account: `ai-account-bdoregvn6di7y`
- Project: `ai-project-morgan-hosted-ncus`
- ACR: `crbdoregvn6di7y.azurecr.io`
- Hosted agent name: `morgan-digital-cfo-hosted`
- Active version: `10`
- Container protocol: `responses/1.0.0`
- Image: `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260507204912`
- Image digest: `sha256:675d09bee0e7880d927a7f810f3e1c0f6ecb613eb3c35ad3e991e17937ae6b04`
- ACR run ID: `cp7`
- Model deployment: `gpt-5-mini` (`2025-08-07`)
- Azure OpenAI endpoint: `https://ai-account-bdoregvn6di7y.cognitiveservices.azure.com/`
- Hosted runtime identity: `4f0bb8b4-4ebd-497b-bc7c-a20cb72a8663`

Version 4 proved smoke-mode hosting with no Azure OpenAI endpoint configured. Version 7 proved live model routing through the real Foundry Responses endpoint. Version 10 is the current active version and passed the four-prompt hosted P0 smoke set through direct REST.

Version 4 smoke response:

```text
Morgan is running as a hosted-agent container, but AZURE_OPENAI_ENDPOINT is not configured. Mission Control, health, and audit endpoints are available for setup verification.
```

Version 7 direct REST invocation evidence:

- Route: `POST /agents/morgan-digital-cfo-hosted/endpoint/protocols/openai/responses?api-version=v1`
- Session ID: `morganhostedv7rest000001x`
- Response ID: `resp_1778184291367`
- Correlation ID: `26661326-b246-4d31-b296-ea6f3e815d91`
- Model: `gpt-5-mini`
- Status: `completed`

The direct REST response proves the hosted container reached Azure OpenAI. The MCP `agent_invoke` helper still returned hosted-runtime internal errors for versions 5-7, so use the documented REST endpoint or `azd ai agent invoke` path for vNext Responses proof until that helper path is corrected.

Graph/MCP, ACS/Teams voice, observability, and durable storage values were intentionally not included in the hosted payload. The model text from the direct REST check must not be treated as proof that those connectors are configured.

Version 10 P0 smoke evidence:

- Result artifact: `.foundry/results/morgan-hosted-p0-smoke-v10.json`
- Cloud Shell result path: `~/morgan-v10-p0-smoke.json`
- Status prompt: `resp_1778187198884`, completed, content gate passed.
- CFO brief prompt: `resp_1778187274037`, completed, content gate passed.
- Integration/settings prompt: `resp_1778187350105`, completed, content gate passed; it now lists required settings and readiness signals instead of drifting into the Microsoft IQ demo briefing.
- End-of-day demo digest prompt: `resp_1778187425350`, completed, content gate passed; it explicitly labels demo/deterministic context and avoids claiming emails, Teams messages, or tenant queries were sent or read.

Two behavior-hardening iterations happened between the v7 live proof and v10 smoke pass:

- Version 8 added a hosted readiness/configuration guard, but the existing showcase shortcut still intercepted Microsoft IQ settings prompts first.
- Version 9 moved the readiness/configuration guard before showcase shortcuts; the integration/settings prompt passed, but the deterministic end-of-day shortcut still needed an explicit demo label.

## Target Foundry Environment

Legacy Flightdeck candidate target:

- Project endpoint: `https://ai-flightdeck.services.ai.azure.com/api/projects/flightdeck-project`
- Resource group: `rg-flightdeck`
- Foundry account: `ai-flightdeck`
- Project: `flightdeck-project`
- ACR: `crflightdeck.azurecr.io`
- Hosted agent name: `morgan-digital-cfo-hosted`
- Container protocol: `responses/1.0.0`
- CPU / memory: `1` / `2Gi`
- Latest built image: `crflightdeck.azurecr.io/morgan-digital-cfo:20260507180211`
- Latest built digest: `sha256:78ee1d27c9111afa7201cc5d5cbc8d1d3ab24f85967e6e4dbfcf63fd1487558c`

Important: Flightdeck is in `uksouth`. Microsoft Foundry rejected hosted-agent creation there on 2026-05-07 with `Unsupported region for Foundry Hosted Agents`. Keep the Flightdeck image as build evidence, but use a supported hosted-agent region such as the North Central US project above for hosted runtime smoke and future live deployment.

## Hosted Build Flow

Run this when terminal execution is available:

```powershell
cd C:\Users\graham\Documents\GitHub\Morgan-D-CFO
npm install
npm run build
```

Build and push a timestamped Linux AMD64 image with ACR cloud build:

```powershell
$tag = Get-Date -Format yyyyMMddHHmmss
az acr build --registry crbdoregvn6di7y --image "morgan-digital-cfo:$tag" --platform linux/amd64 --file Dockerfile .
```

The Cloud Shell run on 2026-05-07 failed when `--source-acr-auth-id "[caller]"` was included and succeeded without it.

Prepare the Foundry hosted-agent payload with the real image and confirmed environment values:

```powershell
npm run foundry:prepare-hosted -- --image "crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:$tag" --project-endpoint "https://ai-account-bdoregvn6di7y.services.ai.azure.com/api/projects/ai-project-morgan-hosted-ncus" --confirm-env-payload yes
```

Then create/update the hosted agent through the Foundry MCP `agent_update` workflow using `.deploy/morgan-foundry-hosted-agent-definition.json`, poll the latest immutable version until `active`, and invoke it with a vNext sticky `sessionId`.

## Environment Payload Gate

Foundry hosted-agent environment variables are included in the agent payload and are difficult to change casually. The generator intentionally writes placeholders unless one of these is supplied:

```text
--confirm-env-payload yes
CONFIRM_FOUNDRY_HOSTED_ENV_PAYLOAD=yes
```

Before confirming, review these classes of settings:

- `AZURE_CLIENT_ID` for the hosted agent's user-assigned runtime identity.
- Azure OpenAI text endpoint/deployment.
- Realtime endpoint/deployment for voice.
- Microsoft App / Agent 365 auth settings.
- MCP platform endpoint and auth headers.
- Application Insights connection string.
- Scheduled secret.
- Cosmos or durable storage settings.
- ACS/Teams federation settings.
- Fabric/Power BI and finance telemetry settings.

## Verification Flow

After the hosted agent exists:

1. Poll `agent_get` until the latest hosted version is `active`.
2. Invoke `morgan-digital-cfo-hosted` through the direct hosted Responses endpoint with a unique `agent_session_id`.
3. Verify `output_text` reaches Morgan's `/responses` handler.
4. Run the P0 smoke dataset from `.foundry/datasets/morgan-digital-cfo-hosted-smoke-v1.jsonl`.
5. Preserve results under `.foundry/results/`.

For Responses protocol vNext hosted agents, the direct REST route is:

```powershell
$base = 'https://ai-account-bdoregvn6di7y.services.ai.azure.com/api/projects/ai-project-morgan-hosted-ncus'
$body = '{ "input":"Return one sentence starting Morgan direct REST check.", "stream":false, "agent_session_id":"morganhostedv7rest000001x" }'
az rest --method POST --url "$base/agents/morgan-digital-cfo-hosted/endpoint/protocols/openai/responses?api-version=v1" --resource "https://ai.azure.com" --headers "Foundry-Features=HostedAgents=V1Preview" "Content-Type=application/json" --body $body -o json
```

## Current Gate

Morgan hosted version 10 is active in North Central US and passed the local P0 smoke dataset through the direct Foundry Responses endpoint with `gpt-5-mini`. This proves hosted reachability, Azure OpenAI routing, and bounded smoke behavior.

The remaining gates are live Graph/MCP, ACS/Teams voice, observability, durable storage, scheduler secret, sub-agent endpoints, and a managed Foundry batch evaluation run. Do not claim full production parity with the App Service Morgan until those surfaces are configured and verified.
