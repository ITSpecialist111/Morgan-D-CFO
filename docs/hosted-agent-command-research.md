# Hosted Agent Command Research

Date: 2026-05-07

This note records the command surfaces available for moving Morgan D-CFO and Morgan Agent Blueprint toward Microsoft Foundry hosted agents. It is intentionally research-first: do not run deploy commands until the prerequisite gates are satisfied.

## What Microsoft Foundry Requires

Official Foundry hosted-agent guidance says the deployment lifecycle is:

1. Build and push a linux/amd64 container image to Azure Container Registry.
2. Create or update a hosted agent version from that image.
3. Wait for the version/container to become ready.
4. Invoke the agent through the Responses protocol.
5. Run agent evaluations after successful deployment.

Important constraints from the current docs:

- Hosted-agent containers serve traffic locally on port `8088`.
- The Responses protocol uses `/responses`.
- Hosted-agent definitions require `kind`, `image`, `cpu`, `memory`, and `container_protocol_versions`.
- Use unique image tags; do not use `latest`.
- Environment variables are per-version and effectively immutable after version creation.
- The ACR image must be reachable by the Foundry project identity.
- Evaluation requires a deployed/running agent plus a GPT deployment that can act as judge model.

## Integrated Browser Verification

The integrated browser was used to inspect these Microsoft Learn pages directly:

- `https://learn.microsoft.com/azure/foundry/agents/how-to/deploy-hosted-agent`
- `https://learn.microsoft.com/azure/foundry/agents/quickstarts/quickstart-hosted-agent?pivots=azd`
- `https://learn.microsoft.com/azure/container-registry/container-registry-quickstart-task-cli`

The browser-visible hosted-agent deploy page confirms:

- Deployment lifecycle: build and push, create agent version, poll for `active`, invoke.
- Prerequisites: Foundry project, supported agent code, Docker for local dev, Azure CLI 2.80+.
- Required permission: Azure AI Project Manager at project scope.
- ACR must be reachable over its public endpoint.
- Container requirement: x86_64 / linux/amd64.
- Responses endpoint: `/responses`.
- Local container port: `8088`.
- Local Responses test: `POST http://localhost:8088/responses`.
- Hosted REST create body uses `kind: hosted`, `image`, `cpu`, `memory`, `container_protocol_versions`, and `environment_variables`.

The browser-visible azd quickstart adds these commands:

```bash
azd ext install azure.ai.agents
azd ext list
azd ai agent init
azd provision
azd ai agent run
azd ai agent invoke --local "What is Microsoft Foundry?"
azd deploy
azd ai agent show
azd ai agent show --output table
azd ai agent show <agent-name>
azd ai agent invoke <payload>
azd ai agent monitor
azd ai agent monitor --tail 20
azd ai agent monitor --type system
azd ai agent monitor --session <session-id> --follow
azd ai agent monitor <agent-name> --follow
azd down
```

The same quickstart notes that `azd deploy` builds the agent container remotely, so Docker Desktop is not required for that path. It also says deployment RBAC may require Owner or User Access Administrator permissions in addition to Contributor.

The browser-visible ACR quickstart confirms ACR Tasks can build and push remotely:

```bash
az acr build --image sample/hello-world:v1 --registry mycontainerregistry008 --file Dockerfile .
```

It also confirms `--source-acr-auth-id [caller]` is required for ABAC-enabled registries, and that `az acr run` can run a pushed image through ACR Tasks:

```bash
az acr run --registry mycontainerregistry008 --cmd '$Registry/sample/hello-world:v1' /dev/null
```

For Morgan, this makes the safest non-local-Docker image command still:

```powershell
$tag = Get-Date -Format yyyyMMddHHmmss
az acr build --registry crflightdeck --image "morgan-digital-cfo:$tag" --platform linux/amd64 --file Dockerfile .
```

## Integrated Cloud Shell Try-Out

The integrated browser was used to launch Azure Cloud Shell from `https://shell.azure.com`. The session signed in as the lab admin account and selected subscription `ME-ABSx02771022-ghosking-1` / `260948a4-1d5e-42c8-b095-33a6641ad189`.

Readiness checks that succeeded:

```powershell
az account show --query "{name:name,id:id,tenantId:tenantId}" -o json
az version --query '"azure-cli"' -o tsv
azd version
azd extension show azure.ai.agents
azd extension install azure.ai.agents
az acr show --name crflightdeck --query "{name:name,loginServer:loginServer,resourceGroup:resourceGroup,sku:sku.name}" -o json
azd ai agent --help
azd ai agent show --help
azd ai agent invoke --help
azd ai agent monitor --help
```

Observed results:

- Azure CLI is available at `2.85.0`.
- Azure Developer CLI is available at `1.23.14`.
- The Foundry hosted-agent quickstart requires `azd` `1.24.0` or later, so this Cloud Shell `azd` is below the documented minimum.
- The `azure.ai.agents` extension installed successfully at `0.1.30-preview`.
- The extension exposes the `azd ai agent` command group after install.
- `crflightdeck` exists in `rg-flightdeck`, login server `crflightdeck.azurecr.io`, SKU `Basic`.
- Cloud Shell warned that `Microsoft.CloudShell` is not registered for the subscription and the no-storage session is ephemeral.
- The GitHub repo cloned successfully in Cloud Shell at commit `ec04683`.
- `npm install --no-audit --no-fund` completed in Cloud Shell.
- `npm run build` completed in Cloud Shell and copied Morgan static assets into `dist`.
- ACR build with `--source-acr-auth-id "[caller]"` failed immediately in this registry with `when specifying push, at least one credential is required`.
- Retrying `az acr build` without `--source-acr-auth-id` succeeded.
- Real pushed image: `crflightdeck.azurecr.io/morgan-digital-cfo:20260507180211`.
- ACR digest: `sha256:78ee1d27c9111afa7201cc5d5cbc8d1d3ab24f85967e6e4dbfcf63fd1487558c`.
- ACR run ID: `dbh`, successful after `1m42s`.

Commands intentionally not run during the first try-out:

- `az acr build`, because Cloud Shell does not have the local Morgan workspace source tree, and building from the remote GitHub URL would not include local hosted-agent prep changes.
- `azd deploy`, because the Cloud Shell `azd` version is below the documented minimum and there is no initialized `azd` project in Cloud Shell for this Morgan repo.
- `agent_update` / `agent_container_control`, because no real Morgan ACR image tag exists yet.

Later in the same session, the Cloud Shell fallback path was used: clone the GitHub repo, patch the Dockerfile fallback in the ephemeral clone, run npm install/build, then build and push the ACR image above. This proves the container build path but does not replace the need to merge/push local repo changes.

Foundry hosted-agent create attempts:

- Attempt 1 used the real image but included `PORT`, `AGENT_NAME`, and `AGENT_ROLE` in `environment_variables`; Foundry rejected these as reserved platform variables.
- The local payload generator was corrected to exclude `FOUNDRY_*`, `PORT`, and `AGENT_*` environment variables.
- Attempt 2 used only non-secret, non-reserved env vars and reached service validation, but Foundry rejected the create because `rg-flightdeck` / `ai-flightdeck` is in `uksouth`, which is not in the current hosted-agent preview region list.
- Current region blocker: `Unsupported region for Foundry Hosted Agents.`

Payload correction made after browser verification:

- `FOUNDRY_PROJECT_ENDPOINT` is no longer written into the hosted-agent `environment_variables` payload by `scripts/prepare-foundry-hosted-agent-definition.cjs`; the hosted-agent docs identify `FOUNDRY_*` runtime values as platform-injected. The project endpoint remains in the top-level payload and MCP call parameters.
- `PORT`, `AGENT_NAME`, and `AGENT_ROLE` are also no longer written into `environment_variables`; Foundry rejects `PORT` and all `AGENT_*` variables as reserved per container-image-spec.

## Supported-Region Hosted Deployment Try-Out

Because Flightdeck is in unsupported `uksouth`, a supported-region project was provisioned in North Central US through Cloud Shell and `azd`:

- Subscription: `ME-ABSx02771022-ghosking-1` / `260948a4-1d5e-42c8-b095-33a6641ad189`.
- Resource group: `rg-morgan-hosted-ncus`.
- Foundry account: `ai-account-bdoregvn6di7y`.
- Project: `ai-project-morgan-hosted-ncus`.
- Project endpoint: `https://ai-account-bdoregvn6di7y.services.ai.azure.com/api/projects/ai-project-morgan-hosted-ncus`.
- ACR: `crbdoregvn6di7y.azurecr.io`.
- ACR connection name: `acr-xosh6klb5pqcy`.

Three initial hosted versions proved the agent record path but failed at session readiness:

- Version 1 image: `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260507185825`, digest `sha256:75e4acbd0801428391853c17c707018fcaa64f99a75a7c8bf77639a0807f60143`, run ID `cp1`.
- Version 2 image: `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260507190303`, digest `sha256:cc9a7d558d7abcd5bddf5585098f744e97ebb0a7e7f8dd7c5c4d84d14919eee3`, run ID `cp2`.
- Version 3 image: `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260507191511`, digest `sha256:c47e3a1f7141d1505076e45feb68d2af49ac5b7889b99050cd30f98b4b706065`, run ID `cp3`.
- Invocation failure for version 3: `424 FailedDependency`, code `session_not_ready`, request ID `c582514e96422e63d9f619b06175d744`.

The root cause was reproduced locally in Cloud Shell by running `node dist/index.js` with `NODE_ENV=production` and `PORT=8088`: startup exited before listening because `@microsoft/agents-hosting` required `ClientId` when the Teams/Bot adapter was constructed. The fix was to add a dedicated Foundry entry point, `src/foundryHost.ts`, and change the Docker image command to `node dist/foundryHost.js`. That host exposes only the Foundry HTTP surface and does not require Teams/Bot credentials for readiness.

The successful version is:

- Agent: `morgan-digital-cfo-hosted`.
- Version: `4`.
- Status: `active`.
- Image: `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260507193551`.
- Digest: `sha256:3653667703aeca618b74984bb6dde277b1943abfb4b7fd85822af97bcab02002`.
- ACR run ID: `cp4`, successful after `1m43s`.
- Local Cloud Shell probe before push: `GET /readiness` returned `status: ready`; `POST /responses` returned Morgan's setup-verification response.
- Foundry invoke succeeded with session ID `morganhostedv4smoke000001` and request ID `a3e93a531857d3293afb0a72b1147247`.

The hosted version 4 payload intentionally uses smoke-mode environment values only:

```json
{
  "NODE_ENV": "production",
  "HOST": "0.0.0.0",
  "MORGAN_FOUNDRY_RESPONSES_ONLY": "true",
  "AUTONOMOUS_WORKDAY_ENABLED": "false"
}
```

This proves Foundry hosting, readiness, and Responses routing. It does not yet prove live Azure OpenAI, Graph/MCP, ACS/Teams voice, or durable storage inside the hosted sandbox; those require reviewed environment values and a new immutable hosted-agent version.

## Live Model Hosted Deployment Try-Out

After version 4 smoke succeeded, the North Central US Foundry account was wired to a live model deployment:

- Account resource ID: `/subscriptions/260948a4-1d5e-42c8-b095-33a6641ad189/resourceGroups/rg-morgan-hosted-ncus/providers/Microsoft.CognitiveServices/accounts/ai-account-bdoregvn6di7y`.
- Azure OpenAI endpoint: `https://ai-account-bdoregvn6di7y.cognitiveservices.azure.com/`.
- Deployment: `gpt-5-mini`.
- Model version: `2025-08-07`.
- SKU: `GlobalStandard`, capacity `1`.
- Deployment state: `Succeeded`.

The first model deploy attempt failed because the payload included deprecated `scale` settings. Retrying with only `skuName: GlobalStandard` and `skuCapacity: 1` succeeded.

Live hosted-agent version attempts:

- Version 5 added `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, and `AZURE_OPENAI_API_VERSION`; MCP `agent_invoke` failed with internal server error correlation ID `6ac551ad597271addf4371edccf5ec26`.
- Local Cloud Shell reproduction with the same image and Azure OpenAI env succeeded against `POST http://127.0.0.1:8088/responses`, proving the container code and model settings worked.
- The hosted instance identity `4f0bb8b4-4ebd-497b-bc7c-a20cb72a8663` was assigned `Cognitive Services OpenAI User` and `Azure AI User` at the account scope.
- The managed identity blueprint principal `e2eb1b6d-705e-42ee-9272-ffaa7428a23f` was also assigned `Cognitive Services OpenAI User` and `Azure AI User` at the account scope.
- Version 6 restarted the live model config after RBAC assignment; MCP `agent_invoke` still failed with correlation ID `b4c36c0192360ac1e28af57c2849e80c`.
- Microsoft Learn keyless Azure OpenAI guidance confirmed that user-assigned managed identity auth requires `AZURE_CLIENT_ID` or an explicit managed identity client id.
- Version 7 added `AZURE_CLIENT_ID=4f0bb8b4-4ebd-497b-bc7c-a20cb72a8663`; MCP `agent_invoke` still failed with correlation ID `7b8952ae6f51f8862dcb2181b7b7f811`.
- Direct REST to the Foundry hosted Responses endpoint succeeded for version 7 with session ID `morganhostedv7rest000001x`, response ID `resp_1778184291367`, correlation ID `26661326-b246-4d31-b296-ea6f3e815d91`, model `gpt-5-mini`, and status `completed`.

Important interpretation: version 7 proves hosted Morgan can reach Azure OpenAI through the real Foundry Responses endpoint. It does not prove Graph/MCP, ACS/Teams voice, observability, or durable storage, because those values were intentionally not included. The MCP `agent_invoke` helper appears unreliable for this vNext hosted Responses route; use direct REST or `azd ai agent invoke` for hosted proof until that helper path is fixed.

## P0 Smoke Behavior Hardening

The hosted P0 smoke dataset was run through the direct Foundry Responses endpoint after live model proof. Version 7 completed all HTTP calls, but the `integration-settings` prompt returned the deterministic Microsoft IQ business briefing instead of listing required settings. Root cause: the generic showcase shortcut saw `Microsoft IQ`, `WorkIQ`, and `Fabric` before the hosted readiness/configuration path had a chance to answer.

Fix iterations:

- Version 8 image `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260507202901`, digest `sha256:e877b10b8e0666ebc83f571fd78ad7c7a4cac1468d21681109b599c72ae69102`, run ID `cp5`: added a deterministic hosted readiness/configuration guard and evidence-boundary instructions. Result: still failed the settings prompt because the showcase shortcut intercepted first.
- Version 9 image `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260507203601`, digest `sha256:b65b8af73260ca2c913fa197bdf1728391a7388ca5228117699ca25dd5b361c4`, run ID `cp6`: moved the readiness/configuration guard before showcase shortcuts. Result: the settings prompt passed; the end-of-day demo prompt completed but did not explicitly label demo/deterministic context.
- Version 10 image `crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:20260507204912`, digest `sha256:675d09bee0e7880d927a7f810f3e1c0f6ecb613eb3c35ad3e991e17937ae6b04`, run ID `cp7`: added explicit demo/deterministic labeling to the end-of-day shortcut. Result: all four P0 smoke prompts passed.

Version 10 direct REST P0 smoke evidence:

| Case | Response ID | Status | Content gate |
|------|-------------|--------|--------------|
| status | `resp_1778187198884` | completed | passed |
| cfo-brief | `resp_1778187274037` | completed | passed |
| integration-settings | `resp_1778187350105` | completed | passed |
| eod-demo | `resp_1778187425350` | completed | passed |

Full local evidence is stored in `.foundry/results/morgan-hosted-p0-smoke-v10.json`. The Cloud Shell result file was `~/morgan-v10-p0-smoke.json`.

## Live Flightdeck State Found

Read-only checks confirm these Flightdeck resources exist:

- Foundry account: `ai-flightdeck`
- Foundry project: `flightdeck-project`
- Project endpoint: `https://ai-flightdeck.services.ai.azure.com/api/projects/flightdeck-project`
- ACR: `crflightdeck`
- ACR login server: `crflightdeck.azurecr.io`
- App Insights, Log Analytics, Key Vault, managed identity, and Container Apps resources are present in `rg-flightdeck`.
- Model deployments exist:
  - `gpt-5`, model `gpt-5.1`, supports chat completions and responses.
  - `gpt-5-mini`, supports chat completions, responses, agentsV2, and assistants.

Read-only agent listing confirms the Rowen prompt proof agents exist, but `morgan-digital-cfo-hosted` does not exist in Flightdeck. A create attempt failed because Flightdeck is in `uksouth`, which is not supported for hosted agents preview.

## Morgan-D-CFO NPM Commands

Available in this repo:

```bash
npm run build
npm run start
npm run dev
npm run clean
npm run foundry:diagnose-hosted
npm run foundry:prepare-hosted
npm run env:from-cassidy
npm run env:from-azure
npm run azure:deploy
```

Hosted-agent relevant commands:

```bash
npm run foundry:diagnose-hosted
npm run foundry:prepare-hosted
```

The current hosted payload template is:

```text
.deploy/morgan-foundry-hosted-agent-definition.json
```

It is a template only until the placeholder image and environment values are replaced.

## Morgan-D-CFO VS Code Tasks

Available task labels include:

```text
func: host start
npm build (functions)
npm watch (functions)
npm install (functions)
npm prune (functions)
check workspace output
deploy updated Morgan avatar UI
deploy avatar UI script
build Morgan after mission starfield
deploy mission starfield update
build Morgan D-CFO Kanban
verify D-CFO Kanban generator
deploy Morgan D-CFO Kanban
build Morgan Teams federation
verify Teams federation status function
deploy Morgan Teams federation
verify production workday handoff
install Rowen blueprint dependencies
rowen blueprint npm install
run Rowen blueprint cloud setup
```

These tasks are useful for App Service, avatar UI, function trigger, and Rowen setup handoff. They do not by themselves create the Morgan Foundry hosted agent.

## Morgan-Agent-Blueprint NPM Commands

Available in the sibling blueprint repo:

```bash
npm run build
npm run typecheck
npm run test
npm run validate
npm run wizard
npm run server
npm run cli
npm run check:m365
npm run configure:foundry
npm run configure:rowen-ecif
npm run configure:rowen-ecif:noninteractive
npm run configure:rowen-ecif:greenfield
npm run setup:rowen-cloud
npm run provision:rowen-foundry
npm run deploy:rowen-model
npm run build:rowen-image
npm run prepare:rowen-hosted-definition
npm run seed:rowen-evals
npm run prepare:rowen-foundry-deploy
npm run diagnose:morgan-hosted
npm run prepare:morgan-hosted
npm run inventory:morgan
npm run matrix:morgan
npm run plan:coo
npm run plan:cfo
npm run plan:ceo
npm run plan:rowen-ecif
npm run generate:coo
npm run generate:cfo
npm run generate:ceo
npm run generate:rowen-ecif
npm run verify:workspace
npm run verify:generated
npm run verify:generated:rowen
npm run diagnose:rowen-cloud
npm run prepare:rowen-source
npm run prepare:rowen-ecif
npm run verify:e2e
```

Most useful research/validation commands before any cloud mutation:

```bash
npm run verify:workspace
npm run diagnose:morgan-hosted
npm run verify:e2e
```

Most useful Rowen cloud command when terminal execution is restored:

```bash
npm run setup:rowen-cloud
```

## Foundry MCP Commands Available

These are tool calls rather than shell commands:

```text
agent_definition_schema_get
agent_get
agent_update
agent_container_control
agent_container_status_get
agent_invoke
evaluation_get
evaluation_dataset_get
evaluation_dataset_batch_eval_create
evaluation_comparison_create
model_deployment_get
model_monitoring_metrics_get
model_quota_list
```

Safe read-only MCP calls:

```text
agent_get
agent_definition_schema_get
evaluation_get
evaluation_dataset_get
model_deployment_get
model_quota_list
```

Mutation calls that require gates:

```text
agent_update
agent_container_control
evaluation_dataset_batch_eval_create
evaluation_comparison_create
```

## Azure CLI Commands Found In The Plan

ACR cloud build is the preferred image build path because it does not require local Docker:

```powershell
$tag = Get-Date -Format yyyyMMddHHmmss
az acr build --registry crbdoregvn6di7y --image "morgan-digital-cfo:$tag" --platform linux/amd64 --file Dockerfile .
```

For these registries, do not include `--source-acr-auth-id "[caller]"`; the 2026-05-07 Cloud Shell run failed with that flag and succeeded without it.

Prepare the hosted-agent payload only after the image exists and environment values have been reviewed:

```powershell
npm run foundry:prepare-hosted -- --image "crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:$tag" --project-endpoint "https://ai-account-bdoregvn6di7y.services.ai.azure.com/api/projects/ai-project-morgan-hosted-ncus" --confirm-env-payload yes
```

## Safe Order For Morgan

Do not skip earlier gates.

1. Static readiness:

```powershell
cd C:\Users\graham\Documents\GitHub\Morgan-D-CFO
npm run foundry:diagnose-hosted
```

2. Build locally:

```powershell
npm install
npm run build
```

3. Build and push cloud image:

```powershell
$tag = Get-Date -Format yyyyMMddHHmmss
az acr build --registry crbdoregvn6di7y --image "morgan-digital-cfo:$tag" --platform linux/amd64 --file Dockerfile .
```

4. Generate confirmed payload:

```powershell
npm run foundry:prepare-hosted -- --image "crbdoregvn6di7y.azurecr.io/morgan-digital-cfo:$tag" --project-endpoint "https://ai-account-bdoregvn6di7y.services.ai.azure.com/api/projects/ai-project-morgan-hosted-ncus" --confirm-env-payload yes
```

5. Use Foundry MCP for schema/update/status, then direct REST for vNext Responses invocation:

```text
agent_definition_schema_get(schemaType=hosted)
agent_update(projectEndpoint, agentName=morgan-digital-cfo-hosted, agentDefinition, creationOptions)
agent_get(projectEndpoint, agentName=morgan-digital-cfo-hosted)
```

```powershell
$base = 'https://ai-account-bdoregvn6di7y.services.ai.azure.com/api/projects/ai-project-morgan-hosted-ncus'
$body = '{ "input":"Return one sentence starting Morgan direct REST check.", "stream":false, "agent_session_id":"<unique-session-id>" }'
az rest --method POST --url "$base/agents/morgan-digital-cfo-hosted/endpoint/protocols/openai/responses?api-version=v1" --resource "https://ai.azure.com" --headers "Foundry-Features=HostedAgents=V1Preview" "Content-Type=application/json" --body $body -o json
```

6. Run P0 evaluation only after invocation succeeds.

## Do Not Run Casually

- Do not run `agent_update` for Morgan against Flightdeck; that project is in unsupported `uksouth` for hosted agents preview.
- Do not place live Azure OpenAI, Graph/MCP, ACS/Teams, observability, storage, or scheduled secrets into a hosted-agent payload without explicit review, because hosted env vars are captured in immutable versions.
- Do not claim production parity from version 4 alone; version 4 is a hosted smoke proving readiness and `/responses` routing without live integration values.
- Do not treat version 7 or version 10 model text as Graph/MCP proof; the hosted payload intentionally lacks Graph/MCP connector settings.
- Do not treat the version 10 local P0 smoke as managed Foundry batch evaluation; it proves direct REST smoke behavior, not production connector parity.
- Do not run Rowen hosted deployment from these Morgan notes; Rowen still needs its own generated source and environment review.

## Current Execution Status

This VS Code agent session still does not expose a working terminal execution command. Previous command attempts returned:

```text
Unable to run commands because no run_in_terminal tool or active terminal IDs are available in this session.
```

Cloud Shell can run Azure and npm commands, and was used to build the `cp4`, `cp5`, `cp6`, and `cp7` images. Morgan is now active as `morgan-digital-cfo-hosted:10` in the North Central US project. Version 10 is live-model invokable through the direct hosted Responses endpoint with `gpt-5-mini` and passed the four-prompt P0 smoke dataset through direct REST. The MCP `agent_invoke` helper previously returned an internal error on this vNext route, so direct REST remains the verified proof path. The next real deployment step is reviewing and adding Graph/MCP, voice, observability, durable storage, scheduler, and sub-agent values, followed by managed Foundry batch evaluation.
