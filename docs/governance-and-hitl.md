# Morgan Governance and Human-in-the-Loop Controls

## Purpose

Morgan separates model reasoning from execution authority. The model may propose work and call approved read-only tools, but server-side policy decides whether an action is allowed, denied, or held for human approval.

This document describes the implementation in this repository. It does not claim that every tenant connector is configured.

## Control flow

1. A request receives a correlation ID, origin, runtime, and actor context.
2. The model sees only statically classified tools and explicitly allowlisted discovered MCP tools.
3. Every invocation is checked again by the policy gateway immediately before execution.
4. Effectful inputs are schema-validated, size/depth bounded, and reject unknown fields before policy hashing.
5. Read-only and approved internal actions proceed.
6. External communications and mutable Microsoft 365 actions create an L2 request. The narrow exception is the EasyAuth-protected Mission Control Teams-call button: an allowlisted finance operator's explicit click is the human authorization for that one call.
7. Dollar-bearing commitments require L3 approval.
8. Approval decisions require an authorized Entra identity.
9. The request version, expiry, action digest, and signed Adaptive Card token are checked.
10. An approved action is reserved for one execution attempt and then marked executed or failed.
11. Policy, approval, execution, provenance, and outcome events join on correlation ID in Morgan Trust Center.

## Policy classes

| Class | Default behavior | Examples |
|---|---|---|
| Read-only | Allow and audit | P&L fixture, KPIs, anomaly scan, readiness, Mission Control |
| Internal write | Allow and audit | Local report artifact, mission task record, retrospective |
| External communication | L2 approval | Email, Teams post, calendar event, Planner mutation, model/scheduler outbound call |
| Explicit operator call | Allow and audit | Mission Control Teams-call button after EasyAuth, finance-operator authorization, same-origin validation, and rate limiting |
| Financial commitment | L3 approval | Payment release, budget commitment, irreversible finance action |
| Human-only decision | Never model-callable | Approve, decline, cancel, approve with edits |
| Unknown | Deny | Unclassified static or discovered tool |

Discovered MCP tools are hidden unless their exact names appear in `MORGAN_MCP_TOOL_ALLOWLIST`. Morgan's reviewed static WorkIQ wrappers remain available and are independently classified.

## Approval integrity

Each request records:

- Approval ID and monotonically increasing version
- L2 or L3 level
- Immutable SHA-256 action digest
- Redacted action metadata
- Creation and expiry times
- Approver Entra object ID and tenant ID
- Decision rationale and edit record
- Full state-transition history
- One-attempt reservation and final execution status

Full message and report bodies are not persisted in approval records. Their size and content hash are recorded instead.

### Authorization settings

Configure these as App Service settings or Key Vault references:

- `MORGAN_HITL_APPROVER_OIDS` — preferred comma-separated Entra object IDs
- `MORGAN_HITL_APPROVER_EMAILS` — optional fallback allowlist
- `MORGAN_HITL_APPROVER_TENANT_ID` — authorized tenant
- `MORGAN_HITL_SIGNING_SECRET` — dedicated signing key; do not reuse an app client secret
- `MORGAN_HITL_REQUIRE_EXPLICIT_APPROVERS=true`
- `MORGAN_HITL_APPROVAL_FILE` — single-instance durable file path

Without an explicit approver allowlist, production decisions fail closed.

## Storage boundary

The current approval repository uses atomic same-directory file replacement on durable App Service storage. It is appropriate for the current single-instance showcase. It is explicitly labelled `singleInstanceOnly` in the API and Trust Center.

Before horizontal scale, replace it with Cosmos DB transactional storage using ETag conditional writes or transactional batches. Conversation state already has an optional Cosmos adapter, but that adapter is not sufficient for approval compare-and-swap semantics.

## Scheduler safety

The autonomous scheduler uses a shared-file lease. A second App Service instance cannot start the same cycle while the lease is active. Stale leases are recoverable after a bounded timeout. Cosmos or Service Bus should replace this lease for larger deployments.

## Data and evidence vocabulary

Use only these terms in demonstrations:

- **Executed** — a real tool returned a successful outcome
- **Simulated** — deterministic demo behavior; no external action occurred
- **Approval required** — policy blocked execution and created a request
- **Denied** — policy or authorization rejected the operation
- **Configured only** — settings are present, but successful use has not been proved
- **Verified** — a preserved test artifact proves the stated narrow boundary
- **Unavailable** — the integration is absent or failed

Never describe deterministic Contoso finance or Microsoft IQ fixtures as live customer data.

## Deployment surfaces

Keep these paths separate:

- **Agent 365 blueprint instance** — Microsoft 365 identity and Works-across experience created from the published blueprint/template manifest.
- **App Service** — Mission Control, Trust Center, avatar, operator controls, scheduler, and rich browser showcase.
- **Foundry hosted container** — Responses-protocol container proof. The verified baseline proves hosted reachability, Azure OpenAI routing, and bounded response behavior only.

The hosted smoke does not prove Graph/MCP, Fabric, Teams voice, Application Insights, Purview, durable storage, scheduler, or sub-agent parity.

## Verification

Run:

- `npm test` — policy, identity, expiry, digest, stale/replay, forged-card, redaction, provenance, and route-boundary tests
- `npm run audit:prod` — fails on high or critical production dependency advisories
- `.github/workflows/morgan-governance-ci.yml` — runs both gates on pushes and pull requests
- Foundry dataset: `.foundry/datasets/morgan-governance-security-v1.jsonl`
- Foundry evaluator config: `.foundry/evaluators/morgan-governance-p0.yaml`

Model evaluations measure behavior and truthfulness; they do not replace deterministic authorization tests.

## Known production upgrades

- Cosmos transactional approval/task ledger
- Distributed scheduler lease
- Verified tenant MCP allowlist and per-tool schemas
- Long-term immutable audit retention and Sentinel alerts
- Rate limiting backed by a distributed store
- Formal data-classification and DLP policy integration
- Managed Foundry evaluation result for the governance P0 dataset
- Azure Monitor uses the current `@azure/monitor-opentelemetry` distribution with custom audit events emitted through the OpenTelemetry logs API. The verified production dependency audit reports zero vulnerabilities.
