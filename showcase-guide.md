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
