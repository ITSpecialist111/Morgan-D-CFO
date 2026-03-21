# Morgan - CFO's Digital Analyst: Enterprise Showcase Guide

## What This Showcases

Morgan is a purpose-built AI analyst for finance teams — not a general-purpose chat assistant bolted onto existing productivity tools. Unlike M365 Copilot, which surfaces information from within your Microsoft tenant, Morgan can autonomously execute multi-step financial workflows: pulling live data from ERP and treasury systems, running calculations, drafting board-ready reports, distributing them via email or Teams, and doing all of this on a schedule — without a human pressing a button. This makes Morgan compelling not just as a productivity tool, but as a genuine digital employee capable of owning repeatable CFO-office deliverables end-to-end.

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
