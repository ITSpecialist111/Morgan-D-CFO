# Morgan ECIF Director — Dragon's Den Submission

---

## Problem Statement

ECIF cases span 6 stages, 10+ stakeholders, and 14–24 weeks — but no single system owns the lifecycle. Sellers spend 12+ hours per case manually chasing approvers, gathering evidence at deadline crunch, and tracking artefacts scattered across Teams, Outlook, SharePoint, and OneAsk. The result: missed POE deadlines forfeit $100K–$500K claims, nominations stall without follow-up, and evidence packs are assembled in panic rather than captured continuously.

Morgan, the ECIF Director, is an autonomous AI agent that owns the entire case lifecycle — from intake to closeout — reducing 12 hours of manual work to under 1 hour, with zero missed deadlines and zero unauthorized external communications.

---

## What's Different About the ECIF Agent?

Morgan isn't a chatbot — she's a **digital worker** with her own Microsoft Entra identity, mailbox, and Teams account.

- **She owns cases, not conversations.** Morgan runs daily monitoring across all open cases, chases approvers on escalating cadences, continuously captures evidence, and assembles nomination and POE packs — autonomously.
- **Humans stay in command.** A three-tier HITL (Human-in-the-Loop) framework gates every external send (L2) and every dollar-bearing action (L3). Nothing leaves the tenant without sponsor approval.
- **Three-layer intelligence.** Work IQ (Microsoft 365 context), Foundry IQ (ECIF criteria knowledge), and Fabric IQ (ACR consumption data) give Morgan grounded, evidence-backed recommendations — not guesswork.
- **7 specialist sub-agents.** Vehicle Picker, Nominator, Approver Chaser, POE Collector, Closeout Reporter, Comms Specialist, and Evidence Librarian — each purpose-built for their lifecycle stage.

---

## Repeatable Case — The Sellable Blueprint

Morgan's architecture separates the **role-agnostic harness** (identity, autonomy, HITL gates, audit trail, IQ grounding) from **role-specific configuration** (persona, tools, lifecycle stages). Swap the persona and tools — the harness stays identical.

This means the same construct that runs an ECIF Director can run a **CFO** (month-end close, board packs), a **Procurement Director** (contract lifecycle), an **HR Business Partner** (offer management), or an **IT Service Manager** (incident lifecycle) — for any organisation, in any Microsoft 365 tenant.

The first agent took months to build. The second takes weeks. That's the sellable item: a **repeatable digital worker blueprint** built entirely on Microsoft's platform.

---

## Responsible AI & Data Confidentiality

- All data stays within the customer's Microsoft 365 tenant — no external storage, no cross-tenant leakage
- Morgan operates under her own Entra identity with scoped permissions, not a service account with broad access
- Every external send is gated by human approval and checked by Purview DLP before delivery
- Every artefact is SHA-256 hashed with timestamps — tamper-evident by design
- Full audit trail through Application Insights, Purview audit logs, and Foundry traces — independently reconcilable
- Morgan operates under the same enterprise security controls as any human employee — Conditional Access, Defender, Information Protection — not around them

---

## Category Answers

**Problem & Value:**
Sellers lose 12+ hours per case and forfeit six-figure claims because no system owns the ECIF lifecycle — Morgan reduces that to under 1 hour with zero missed deadlines.

**Impact & Outcomes:**
At scale (100–300 cases/year across EMEA), Morgan saves 1,100–3,300 hours and protects $10–50M in investment claims annually — every metric visible in real-time through Mission Control.

**Innovation & Creativity:**
Morgan combines a persistent Entra identity, GPT-5 reasoning, 7 specialist sub-agents, three-layer Microsoft IQ grounding, and an autonomous work harness with HITL gates — a composable blueprint that was reframed from a generic CFO to a fully-specified ECIF Director in a single weekend.

**User Experience:**
A seller messages "@Morgan, new case for Contoso on Azure AI" in Teams — Morgan handles everything, surfacing decisions as Adaptive Cards with Approve/Edit/Cancel, and exposing all work through an interactive Mission Control dashboard.

**Feasibility & Scalability:**
Built entirely on GA Microsoft infrastructure (Agent Framework, Foundry, Azure OpenAI, Entra, Teams, Purview) — the second agent deployment takes weeks not months, and scales to any role in any M365 tenant.

**Responsible & Trusted AI:**
Every external send is human-approved, all data stays in-tenant, every artefact is hash-verified, and the full reasoning chain is auditable through three independent log sources.

**Clarity of Pitch:**
Morgan is a digital worker that owns a job, not a chatbot that answers questions — demonstrated live through Mission Control showing 14 active cases, a 7-stage pipeline, evidence health tracking, and real-time value metrics.
