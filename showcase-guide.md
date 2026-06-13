# Morgan - CorpGen Digital CFO: Enterprise Showcase Guide

## What This Showcases

Morgan is a purpose-built Digital CFO for finance teams — not a general-purpose chat assistant bolted onto existing productivity tools. Unlike M365 Copilot, which surfaces information from within your Microsoft tenant, Morgan can autonomously execute multi-step financial workflows: pulling live data from ERP and treasury systems, running calculations, drafting board-ready reports, distributing them via email or Teams, calling stakeholders through Teams federation, presenting through an avatar, recording proof, and doing all of this on a schedule without a human pressing a button. This makes Morgan compelling not just as a productivity tool, but as a genuine digital employee capable of owning repeatable CFO-office deliverables end-to-end.

The enterprise version is mapped to the CorpGen paper: Morgan is shown as a Multi-Objective Multi-Horizon digital employee rather than a one-shot assistant. Mission Control exposes the paper alignment directly: hierarchical planning, isolated sub-agents, tiered memory, adaptive summarization, cognitive tools, experiential learning posture, emergent collaboration through Teams/email, artifact-based evaluation, and transparent safety rails.

Morgan also includes the Microsoft IQ layer for the CorpGen story: WorkIQ for Microsoft 365 work context, Foundry IQ for model/agent/knowledge/evaluation intelligence, and Fabric IQ for financial figures plus cross-functional business insight. The demo uses deterministic Contoso data when tenant systems are not connected, so it remains fully working without implying live enterprise data.

---

## Demo Environment Setup

### Pre-requisites Checklist

- [ ] Morgan agent is deployed and reachable (local `http://localhost:3000` or Azure endpoint)
- [ ] At least one data tool is connected (e.g. mock ERP, SharePoint Finance folder, or live system)
- [ ] Email / Teams distribution tool is configured (or mock mode enabled)
- [ ] `.env` contains valid `MORGAN_AGENT_URL` and `SCHEDULED_SECRET`
- [ ] Browser open to the Morgan chat UI (or Teams channel where Morgan is installed)
- [ ] Slide deck or screen share ready for talking points

### Verify Morgan Is Running

```bash
# Confirm the agent responds
curl http://localhost:3000/api/health

# Expected response
{ "status": "ok", "agent": "morgan", "version": "1.0.0" }
```

If running in Azure, replace `localhost:3000` with the Azure Function / Container App URL.

---

## Demo Scenario 1: Reactive Finance Q&A (2 minutes)

**Goal:** Show that Morgan answers complex finance questions instantly, with sourced data — not hallucinated summaries.

### Step-by-Step

| # | Presenter Action | Morgan Response | Talking Point |
|---|---|---|---|
| 1 | Type: *"What was our operating cash flow last quarter vs the same quarter last year?"* | Pulls figures from connected ERP, presents a formatted comparison table with % variance | "Notice Morgan cited the source — it didn't just guess. Every number is traceable." |
| 2 | Type: *"Which cost centres are over budget this month?"* | Lists top offenders with dollar amounts and % over | "This used to take a finance analyst 30 minutes pulling from multiple spreadsheets." |
| 3 | Ask a follow-up: *"Drill into the IT cost centre — what's driving the overspend?"* | Breaks down line items, highlights the largest contributors | "Morgan maintains conversation context — it remembered what we were looking at." |

**Audience Takeaway:** Morgan gives finance teams instant, accurate, sourced answers to the questions they ask dozens of times a week.

---

## Demo Scenario 2: Agentic Multi-Step Work (5 minutes)

**Goal:** Show Morgan orchestrating multiple tools autonomously to complete a complex task — not just answering a question.

### Prompt to Type

> *"Create the monthly board report for October, attach last month's P&L and cash flow statement, and email it to the CFO distribution list."*

### What Happens (walk the audience through each tool call as it appears)

| Step | Tool Called | What Audience Sees | Talking Point |
|---|---|---|---|
| 1 | `get_financial_data` | Morgan fetches October P&L and cash flow from ERP | "It's going to source data — no copy-paste." |
| 2 | `calculate_variances` | Morgan runs budget vs actuals, YoY comparisons | "It's doing the analysis, not just retrieving." |
| 3 | `generate_document` | Board report draft appears in chat as formatted markdown / Word doc | "That's a complete first draft. Structured, formatted, ready to review." |
| 4 | `send_email` | Morgan emails the report to the CFO distribution list | "And it sent it. One instruction — five steps — done." |

**Pause here and ask the audience:** *"How long would this normally take your team?"* (Typical answer: 2–3 hours.)

**Audience Takeaway:** Morgan doesn't just answer questions — it does work. Agentic AI means the model plans and executes a sequence of actions to achieve a goal.

---

## Demo Scenario 3: Autonomous Monday Briefing (pre-recorded or trigger manually)

**Goal:** Show that Morgan can operate autonomously on a schedule — the CFO receives a briefing without asking for one.

### Option A — Trigger Manually (Live Demo)

Use the Azure Function HTTP admin endpoint or run the timer directly:

```bash
# Manually invoke the weeklyBriefing timer function for demo purposes
curl -X POST http://localhost:7071/admin/functions/weeklyBriefing \
  -H "Content-Type: application/json" \
  -d "{}"
```

Then switch to the CFO's email inbox (or Teams channel) and show the briefing arriving.

### Option B — Play Pre-Recorded Screen Capture

If live triggers are unreliable in the demo environment, show a 60-second screen recording of the briefing email arriving in Outlook — narrate over it.

### What the Briefing Contains

- Portfolio / P&L snapshot vs prior week
- Top 3 budget anomalies requiring CFO attention
- Cash position and forecast vs plan
- Key finance events for the week ahead (payments due, reporting deadlines)

**Audience Takeaway:** Morgan is always on. The CFO starts every Monday already informed — without anyone spending Sunday night preparing slides.

---

## Demo Scenario 3B: CorpGen Paper Match in Mission Control (3 minutes)

**Goal:** Show that Morgan is not just visually impressive; the operating model maps to the CorpGen autonomous digital employee architecture.

1. Open `/mission-control` and scroll to **Beta Starfield**.
2. Switch modes: **Autonomy**, **Workflow**, **Tools**, **Governance**, **Memory**, and **Live Run**.
3. Click a node in each mode and show the proof chips: instruction, tool, sub-agent, evidence, escalation, or completed task.
4. Scroll to **Paper Match Matrix** and point out which items are implemented now versus which require production hardening.

**Talking Point:** "This is the difference between a chatbot demo and an enterprise digital worker: customers can inspect the job contract, operating cadence, evidence path, safety boundaries, and where the research architecture has been implemented."

---

## Demo Scenario 3C: Next-Gen CorpGen Enterprise Runtime (4 minutes)

**Goal:** Show that Morgan has moved beyond a static paper checklist into an inspectable operating system for a digital CFO worker.

1. Open `/mission-control` and scroll through **Enterprise Readiness**, **Cognitive Toolchain**, **Adaptive Memory**, **Experiential Learning**, **CFO Operating Plan**, and **Artifact Judge**.
2. Ask Morgan: *"Generate your CFO operating plan and list the next runnable autonomous task."*
3. Ask Morgan: *"Show your enterprise readiness checks for Agent 365, MCP, observability, Purview, avatar, sub-agents, storage, and scheduler safety."*
4. Ask Morgan: *"Evaluate this CFO briefing artifact for evidence, actionability, governance, and readiness."* Paste a short briefing draft and show the score.

---

## Demo Scenario 3D: Microsoft IQ Command Layer (4 minutes)

**Goal:** Show how a CorpGen autonomous CFO worker uses Microsoft IQ sources rather than only a static finance dataset.

1. Open `/mission-control` and scroll to **Microsoft IQ Command Layer**.
2. Point out the three live pillars: **WorkIQ** for meetings/approvals/work graph, **Foundry IQ** for model/evaluation/knowledge readiness, and **Fabric IQ** for semantic-model business figures.
3. Ask Morgan: *"Combine WorkIQ, Foundry IQ, and Fabric IQ into an executive CFO update."*
4. Open **Agent Mind** and show the called Microsoft IQ tool and result event.
5. Show the Fabric IQ metrics and cross-functional signals, then explain that production swaps the deterministic demo adapters for tenant Graph, Foundry, and Fabric sources behind the same contracts.

**Talking Point:** "Morgan works from 09:00 to 17:00, seven days a week. During each autonomous cycle it can refresh work context, governed business figures, and model/evaluation evidence before briefing the CFO."
5. Return to **Beta Starfield** and point out that the toolchain and readiness checks also appear as operating graph nodes.

**Talking Point:** "Morgan is not asking the audience to trust invisible reasoning. The planning loop, memory compression, experiential playbook, enterprise controls, and artifact judge are callable tools with visible outputs. That is the path from research demo to enterprise pilot."

---

## Demo Scenario 3E: Cost and Value of Morgan (3 minutes)

**Goal:** Show that the project is transparent about run cost, especially the realtime avatar and voice path.

1. Open `/mission-control` and scroll to **Cost of Morgan**.
2. Point out daily run-rate, weekly run-rate, avatar share, Azure actuals, and value-to-cost ratio.
3. Open `/mission-control/costs` for the detailed dashboard.
4. Show the split between Azure Cost Management actuals and showback estimates for avatar, Agent 365, Microsoft IQ, Foundry/AI, Fabric IQ, compute, tools, storage, and observability.
5. Explain that the model is configurable through `MORGAN_COST_*` and `MORGAN_VALUE_*` app settings so each customer can tune pilot chargeback and value assumptions.

**Talking Point:** "Morgan does not hide the price of autonomy. Customers can see the cost of the avatar, platform services, tools, and projected finance value before a pilot scales."

---

## New Demo Surfaces (Feature-Parity Additions)

The scenarios below cover surfaces added in the recent feature-parity work: the human-in-the-loop approval queue, governance observability, end-of-cycle retrospectives, the live finance Kanban, and the dual avatar platforms. They keep the same persona and honesty discipline as the rest of this guide — finance figures are deterministic Contoso demo data when tenant systems are not connected.

For a timed, follow-along recording script see [docs/dragons-den-talk-track.md](docs/dragons-den-talk-track.md); for the repeatable daily run order see [docs/daily-showcase-runbook.md](docs/daily-showcase-runbook.md).

---

## Demo Scenario 3F: Human-in-the-Loop Approvals (4 minutes)

**Goal:** Show that Morgan acts autonomously inside the finance desk but stops at a human gate before anything leaves the building or commits money.

### Step-by-Step

| # | Presenter Action | Morgan Response | Talking Point |
|---|---|---|---|
| 1 | Open `/approvals` (also reachable at `/hitl-approvals`) | The HITL approval queue loads with four seeded finance decisions waiting | "This is Morgan's governance gate. She's autonomous inside the desk, but she pauses here before acting outside it." |
| 2 | Type to Morgan: *"Send the board-ready P&L to the external distribution list."* | Morgan does **not** send — she raises (or points to) an **L2** approval because the report is leaving Finance to an external list | "L2 is the external-send gate. Nothing leaves the tenant on Morgan's word alone." |
| 3 | Type: *"Approve the $250k budget reforecast."* | Morgan routes it to an **L3** gate — a material, dollar-bearing commitment | "L3 is the money gate. Any dollar-bearing action needs a human decision first." |
| 4 | On a queued item choose **Approve**, **Approve with edits**, **Decline**, or **Cancel** | Morgan records the decision (decision only — no external send happens from the card itself) and writes it to the audit ledger | "Approve, edit, decline, or cancel — and every decision is captured with who decided and why." |

**Optional:** Ask Morgan *"send the L2 approval card to the finance approver"* to push a Microsoft Teams Adaptive Card carrying the same Approve / Approve with edits / Decline / Cancel actions.

**Audience Takeaway:** Morgan is **autonomous internally, gated externally and financially.** Four seeded scenarios — two L2 external sends (board P&L, Q3 variance summary to a Teams channel) and two L3 dollar-bearing actions ($250k reforecast, vendor payment memo) — make the safety model concrete in every demo.

---

## Demo Scenario 3G: Governance Observability (3 minutes)

**Goal:** Show the audit-grade view of *how* Morgan reached a decision — the additional governance layer beyond the Beta Starfield.

1. Open `/mission-control` and switch to the **Governance Observability** view (backed by `/api/mission-control/governance`).
2. Pick a recent run. For that `correlationId`, show the joined trace: the **prompt**, the **chain-of-thought summary**, the **tools Morgan selected**, any **HITL gate** that fired, and the matching **audit ledger** entries.
3. Point out the run stats: reasoning turns, tool calls, governance gates, warnings, and errors.
4. Contrast with Beta Starfield: Starfield shows the operating model; this view shows the receipts for a specific decision, joined end-to-end by correlation ID.

**Talking Point:** "When a customer's risk or audit team asks 'why did the agent do that?', Morgan answers with the prompt, the reasoning summary, the tools chosen, the human gate, and the audit entry — all tied together by one correlation ID."

---

## Demo Scenario 3H: Retrospectives & Experiential Learning (3 minutes)

**Goal:** Show that Morgan reflects at the end of a cycle and carries lessons forward, rather than repeating the same gaps.

1. Run an autonomous workday (see Scenario 3C) or ask Morgan: *"Generate your CFO retrospective."* (tool: `generateCfoRetrospective`).
2. Ask: *"What would you do differently next cycle?"* Morgan returns recommendations grounded in this cycle's blocked/failed patterns — month-end close timing, approval SLA chasing, budget-vs-forecast checks, and anomaly grounding.
3. Open `/api/mission-control/retrospectives` to show the learning history — the most recent retrospectives on record and how the recommendations have evolved.
4. Point out that each recommendation is tied to real task counts (completed / blocked / failed) for the period, not generic advice.

**Talking Point:** "Morgan doesn't just finish the work — she reviews it. Each cycle's lessons are persisted so the next cycle starts smarter."

**Honesty note:** Retrospectives are grounded in Morgan's Mission Control task ledger for the period (deterministic demo data when tenant systems are not connected).

---

## Demo Scenario 3I: Agentic Kanban — Live Finance Work Board (2 minutes)

**Goal:** Show Morgan's workload as a live, inspectable board rather than a black box.

1. In `/mission-control`, find the **Live Finance Kanban** card and click **Open live board** (route `/agentic-kanban`).
2. `/agentic-kanban` redirects to the configured board — Power Platform / FlightDeck when configured, an internal fallback otherwise.
3. Walk the columns — finance work items moving through the cycle — and tie a card back to a Mission Control task record.
4. Note the same link is surfaced from the avatar/voice experience, so the board is one click away during a spoken demo.

**Talking Point:** "Morgan's backlog isn't hidden. The Live Finance Kanban is the same work you see in Mission Control, presented as a board a finance manager would recognise."

---

## Demo Scenario 3J: Dual Avatar Platforms (3 minutes)

**Goal:** Show Morgan as a present, on-screen colleague — with a choice of avatar platform.

1. From `/mission-control`, use the **Avatar** toggle in the header. It offers two platforms: **Morgan (Standard)** → `/voice` (Azure Voice Live avatar) and **Mia Elegant (D-ID)** → `/voice/did` (D-ID humanoid avatar).
2. Open `/voice` and show the Azure Voice Live avatar speaking Morgan's finance points.
3. Switch to `/voice/did` for the D-ID humanoid variant — same UI shell, different avatar engine. The toggle checks `/api/avatar/did/status` first and, if D-ID isn't configured on the deployment, alerts and stays on the standard avatar.
4. Ask the avatar a finance question (e.g. *"What's the latest P&L?"*) and let it answer out loud. The D-ID voice runs an expressive ElevenLabs profile (`eleven_turbo_v2_5` with tuned style/stability), so Mia delivers with emotional range rather than a flat read.

**Talking Point:** "Morgan can show up as a face and a voice, not just a chat box — and the platform is swappable, so customers can pick the avatar experience that fits their brand."

**Honesty note:** The D-ID humanoid platform is optional and configured per deployment; when it isn't configured the experience falls back to the standard Azure Voice Live avatar.

---

## Demo Scenario 4: Multi-Agent Collaboration (advanced, 3 minutes)

**Goal:** Show how Morgan fits into a broader agent ecosystem — not a standalone tool.

### Scenario

> The market signals agent detects a significant FX movement overnight. It notifies Morgan. Morgan assesses the impact on the company's USD-denominated payables and prepares a hedging options brief for the CFO — all before the 8 AM briefing.

### Architecture Flow (draw or show diagram)

```
Market Signals Agent
  │  detects: AUD/USD -2.3% overnight
  │  emits:   { event: "fx_movement", pair: "AUD/USD", delta: -0.023 }
  ▼
Morgan (Finance Agent)
  │  tool: get_fx_exposure()          → pulls USD payables from ERP
  │  tool: calculate_hedge_impact()   → models cost of hedging vs unhedged
  │  tool: generate_brief()           → drafts CFO options memo
  │  tool: send_to_cfo()              → delivers via email + Teams
  ▼
CFO receives hedging options memo at 7:55 AM
```

### Talking Points

- Agents can publish and subscribe to each other's events — this is the architecture of an autonomous finance office.
- Morgan doesn't need to know how the market signals agent works; it just receives a structured event and acts.
- This is the **Agent 365 platform** vision: a constellation of specialist agents, each owning a domain, collaborating to run business processes end-to-end.

---

## Key Talking Points vs M365 Copilot

| Feature | M365 Copilot | Morgan (Agent 365) |
|---|---|---|
| **Data sources** | Microsoft 365 tenant only | Any API, ERP, database, or file system |
| **Actions** | Summarise, draft, search | Execute multi-step workflows, send, calculate, report |
| **Autonomy** | Reactive only (responds to prompts) | Proactive + scheduled (runs without being asked) |
| **Finance domain knowledge** | Generic | Purpose-built for CFO-office workflows |
| **Tool use** | Limited (Graph API) | Extensible — any tool the business needs |
| **Multi-agent** | No native agent-to-agent collaboration | Designed for multi-agent event-driven architecture |
| **Customisation** | Prompt tuning, SharePoint grounding | Full system prompt, tool registry, and agent logic control |
| **Deployment** | Microsoft-managed cloud | Customer-controlled Azure deployment |
| **Audit trail** | Basic activity logs | Full tool call trace per conversation turn |
| **Human-in-the-loop** | No native approval gates | L2 external-send and L3 dollar-bearing approval queue, every decision audited |
| **Decision transparency** | Basic activity logs | Governance Observability: prompt, reasoning summary, tool selection, HITL gate, and audit ledger joined by correlation ID |
| **Self-improvement** | No | End-of-cycle retrospectives grounded in the task ledger |
| **Agent presence** | Text only | Dual avatar platforms — Azure Voice Live and D-ID humanoid — plus voice |
| **Scheduling** | No | Yes — Azure Functions timer triggers |

---

## Technical Architecture (for technical audiences)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Morgan Agent                             │
│                                                                 │
│  ┌──────────────┐   ┌───────────────┐   ┌──────────────────┐  │
│  │  Chat UI /   │   │  Agent Core   │   │   Tool Registry  │  │
│  │  Teams Bot   │──▶│  (LLM + loop) │──▶│  get_financials  │  │
│  └──────────────┘   │               │   │  send_email      │  │
│                     │  System Prompt│   │  generate_doc    │  │
│  ┌──────────────┐   │  + Memory     │   │  calc_variance   │  │
│  │ Azure Timer  │──▶│               │   └──────────────────┘  │
│  │  Functions   │   └───────────────┘                         │
│  └──────────────┘           │                                  │
│   weeklyBriefing             │                                  │
│   dailyAnomalyCheck          ▼                                  │
│                     ┌───────────────┐                          │
│                     │  /api/chat    │                          │
│                     │  /api/scheduled│                         │
│                     └───────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
         │                                      │
         ▼                                      ▼
  ┌─────────────┐                     ┌──────────────────┐
  │  ERP / TMS  │                     │  Email / Teams   │
  │  SharePoint │                     │  Distribution    │
  │  Data Lake  │                     └──────────────────┘
  └─────────────┘
```

**Key components:**

- **Agent Core** — LLM (GPT-4o or equivalent) running a ReAct-style tool-use loop. Decides which tools to call and in what order to fulfil the user's intent.
- **Tool Registry** — TypeScript functions exposed to the LLM. Each tool has a name, description, and JSON schema for parameters. The LLM selects and invokes tools; results feed back into the context.
- **Azure Functions Triggers** — Two timer functions (`weeklyBriefing`, `dailyAnomalyCheck`) POST to `/api/scheduled` on a cron schedule, initiating autonomous runs without human interaction.
- **System Prompt** — Defines Morgan's persona, finance domain expertise, output formatting rules, and escalation behaviour.
- **Memory** — Conversation history per session; optionally extended with a vector store for long-term recall across sessions.
