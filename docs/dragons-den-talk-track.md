# Morgan — The Digital CFO
## Dragon's Den Talk Track, Use Case & Q&A Battlecard

> A follow-along script to **record a video**. It is timed, with clear cues:
> **[SAY]** = words to speak · **[SHOW]** = what's on screen · **[DO]** = the action to take.
> Primary cut is **6 minutes**. A **3-minute** cut and a **90-second** cold-open are included.
> Every claim here is grounded in what is actually built. The **Honesty Discipline** section
> tells you exactly what is live vs. demo so you never overclaim on camera.

---

## 0. How to use this document

1. Read **Section 1 (Positioning)** and **Section 2 (The Use Case)** until you can say them from memory.
2. Do the **Section 3 pre-record checklist** so every demo prompt is pre-tested and the screens are ready.
3. Record to the **Section 4 six-minute script** (or the Section 5 short cuts).
4. Keep the **Section 6 battlecard** beside you for the Q&A / follow-up take.
5. Never say anything on the **Section 7 do-not-say list**.

---

## 1. Positioning — the one-liner and the frame

**One-liner:**
> *"Morgan is not a finance chatbot. Morgan is a **governed digital CFO worker** — a Microsoft 365 colleague with her own mailbox, a job description, a task board, finance tools, a phone, a cost line, and an audit trail — who runs the recurring finance-reporting cycle on your behalf and stops at a human approval before anything leaves the building."*

**The frame (memorise this contrast):**
- A **dashboard** *shows* the numbers.
- **Copilot** *helps a person* write the deck.
- **Morgan** *owns the work* — she runs the cycle end-to-end, on her own clock, and brings you a decision to approve.

**The category line:**
> *"This is the next workforce layer of the Microsoft cloud — not a smarter assistant, an accountable digital employee."*

---

## 2. The rock-solid use case (the part that makes organisations adopt)

**Headline use case:**
> **Morgan runs the recurring FP&A reporting & variance cycle for a mid-market finance team — as an Agent 365 colleague inside Microsoft 365.**

| | |
|---|---|
| **Who buys** | CFO / VP Finance / FP&A lead at a **200–2,000-employee** company already on Microsoft 365 + Teams. |
| **The pain** | 2–4 analysts burn **days every month** assembling budget-vs-actuals decks, variance commentary, the weekly finance digest, and answering *"how are we tracking?"* in Teams. Reporting is **manual, late, and inconsistent**; variances are caught **after** close; the CFO chases the same numbers every week. |
| **What Morgan does** | Has her **own mailbox & calendar** (cc her, invite her). Pulls budget/actuals from the connected model. Runs a **daily finance health-check and anomaly surveillance**. Drafts the **weekly briefing and a board-ready P&L**. **Delivers** via Word + Teams + email. Answers ad-hoc finance questions in Teams chat or voice **from governed data**. Routes any **external send or dollar-bearing action through an L2/L3 human approval**. Posts an **end-of-day / month-end summary** with completed work, blockers, and tomorrow's priorities — every action carrying a **correlation-ID evidence trail** in Mission Control. |
| **Replaces / augments** | **Augments** analysts (removes assembly toil), **replaces** the manual digest, and gives the CFO a **24/7 always-watching finance colleague** — *without* replacing the controller's sign-off or the auditor. |
| **Why now** | Enterprises don't need a faster answer; they need **accountable finance work that moves across systems** while the CFO sleeps — with governance and audit built in, on the cloud they already own. |

**The ROI logic (defensible, and already coded into the product):**
- Target the **repeatable 30–45%** of FP&A + reporting + decision-support hours.
- Morgan's **impact roadmap** quantifies those hours at a **$125 loaded rate**, confidence-adjusted, annualised.
- Morgan's **cost dashboard pulls her *actual* Azure run-rate** (live Azure Cost Management) and computes a benefit-cost ratio, cost-per-completed-task, and **break-even workstreams per month**.
- The pitch: *"Automate the repeatable reporting toil; break even on **less than one workstream**; keep your people on judgment and controls."*

**Why this use case is rock-solid:** it lands exactly where the built capability is **strongest and lowest-risk** — recurring, structured, well-bounded reporting and variance work, inside tools the customer already owns, with hard governance gates on anything that leaves Finance. We are **not** claiming autonomous treasury, payments, or live board sign-off.

---

## 3. Pre-record checklist (do this before you hit record)

**Screens to have open (in tab order):**
1. **Teams chat** with Morgan (or the web chat surface).
2. **Mission Control** — `/mission-control` (job description, Kanban, Beta Starfield, blockers).
3. **Cost dashboard** — `/mission-control/costs`.
4. **Approvals** — `/approvals` (the HITL queue).
5. **Avatar** — `/voice` (Voice Live) and/or `/voice/did` (D-ID humanoid).

**Pre-test these prompts** (they map to real tools — confirm each returns cleanly before recording):

| Prompt | Tool it exercises | What you'll show |
|---|---|---|
| "What's the latest P&L?" | `getLatestPnL` | Full income statement: Revenue → COGS → Gross Profit → OPEX → EBITDA → Net Income + commentary |
| "Show budget vs actuals this month." | `analyzeBudgetVsActuals` | Per-category variance $ and %, overruns flagged |
| "Any anomalies I should worry about?" | `detectAnomalies` | Severity-classified variance alerts |
| "Give me a Microsoft IQ briefing for the board." | `synthesizeMicrosoftIQBriefing` | WorkIQ + Foundry IQ + Fabric IQ → one exec update |
| "Run your autonomous workday." | `runAutonomousCfoWorkday` | The full day loop: plan → analyse → anomalies → IQ → digest |
| "Send the board P&L to the distribution list." | HITL **L2** | Morgan **stops** and raises an approval card |
| "Approve the $250k budget reforecast." | HITL **L3** | Dollar-bearing gate; approve/edit/decline/cancel |
| "Ring me back in 5 minutes." | `scheduleAutonomousCallback` | She commits to an outbound Teams call on her own clock |
| "What would you do differently next quarter?" | retrospective / insights | Data → recommendation, grounded in the period |

**Environment note for the take:** if you're demoing on the deterministic dataset, that's fine and honest — just use the demo-data line in Section 7. If you've connected a tenant (Fabric/Graph/ACS), even better; show the live source.

---

## 4. THE 6-MINUTE TALK TRACK (primary)

### 0:00–0:40 — Cold open: the problem (camera)
**[DO]** Talk straight to camera. No slides yet.
**[SAY]**
> "Every finance team I've met has the same problem. It isn't that nobody can answer *'how are we tracking?'* — it's that **nobody owns the follow-through**. The budget-versus-actuals deck, the variance commentary, the weekly digest, the board P&L, chasing the same numbers in Teams — it's manual, it's late, and your best analysts are stuck assembling spreadsheets instead of doing analysis.
> So I built Morgan. Morgan is a **digital CFO worker** — and I want to show you she actually does the job, not just talk about it."

### 0:40–1:15 — Define Morgan (camera → share Mission Control)
**[DO]** Share screen → **Mission Control**.
**[SAY]**
> "This is Mission Control — Morgan's cockpit. Notice what's here before there's any chat box: a **job description**, an **operating cadence**, a **task board**, **blockers**, a **cost line**, and an **audit trail**. If you hired a human CFO's analyst, you'd expect exactly these. Morgan is **not a chatbot managing a spreadsheet — she's a governed digital worker with a contract.**"

### 1:15–2:05 — She knows the numbers (Teams chat)
**[DO]** Switch to Teams chat. Type: **"What's the latest P&L?"**
**[SAY]**
> "Most finance AI demos *summarise a document*. Morgan returns a **board-ready P&L on demand** — Revenue, gross margin, EBITDA, net income, with commentary — because she has **actual finance tools**, not just retrieval."
**[DO]** Type: **"Any anomalies I should worry about?"**
**[SAY]**
> "And she flags variances by severity **before** you ask. That's the difference between a search box and a finance worker."

### 2:05–3:00 — She runs on her own clock (Teams chat → Mission Control)
**[DO]** Type: **"Run your autonomous workday."** Then flip to Mission Control's Kanban/board.
**[SAY]**
> "Here's the part that matters. Morgan doesn't wait for me. Her workday runs **nine to five, seven days a week**: she builds an operating plan, runs the health-check, scans for anomalies, synthesises an executive briefing, and drafts the digest — and logs every step here with a **correlation ID**. *She is not waiting for me to come back to her. She is operating on her own clock. That is the difference between an assistant and a digital worker.*"

### 3:00–3:45 — Governance: she stops before money or messages move (Teams → Approvals)
**[DO]** Type: **"Send the board P&L to the external distribution list."** Morgan raises an approval. Flip to **/approvals**.
**[SAY]**
> "Now watch the most important thing. I asked her to **send something externally** — and she **stopped**. Anything that leaves Finance is a **Level-2 approval**; anything that moves money — like this **$250k budget reforecast** — is a **Level-3 approval**. I can approve, edit, decline, or cancel, and the decision is recorded with rationale and evidence.
> **Morgan is autonomous *internally*, and gated *externally and financially*.** Humans keep judgment; Morgan removes the coordination drag."

### 3:45–4:30 — Microsoft IQ: grounded, not guessed (Teams chat)
**[DO]** Type: **"Give me a Microsoft IQ briefing for the board."**
**[SAY]**
> "When Morgan gives the CFO an answer, she pulls three graphs together. **WorkIQ** — the *work* graph: meetings, finance threads, approvals. **Foundry IQ** — the *model* graph: is this insight grounded and evaluated? **Fabric IQ** — the *business* graph: revenue, margin, cash runway, NRR. **Three IQs, one executive update** — so the number comes with its context and its evidence."

### 4:30–5:10 — She has a voice and a face (Avatar)
**[DO]** Open **/voice** (and/or **/voice/did**). Optionally ask one spoken question.
**[SAY]**
> "And because she's a colleague, she has a presence. Same Morgan, same tools, same governance — she can brief you by **voice**, as a live **avatar**, or even **ring you in Teams** when something's urgent. *Same worker, different surface.*"

### 5:10–5:35 — The cost line and the chassis (Cost dashboard)
**[DO]** Flip to **/mission-control/costs**.
**[SAY]**
> "Morgan doesn't hide the price of autonomy. This pulls her **real Azure run-rate** and shows the **break-even** — she pays for herself on **less than one workstream**. And the governance chassis is reusable: **the rules are fixed, the persona is swappable** — CFO today, the next role tomorrow."

### 5:35–6:00 — The close + the ask (camera)
**[DO]** Back to camera.
**[SAY]**
> "So you didn't just see an AI demo. You saw a **digital employee** with a job, a Microsoft 365 identity, a task board, finance tools, a phone, a cost line, and an audit trail. Today she runs on a safe demo dataset; **point her at your ledger, your Fabric model, and your Microsoft 365 tenant and the exact same workflow runs on your live numbers.**
> My ask is simple: a **bounded pilot** on one finance team's reporting cycle, with the approval gates on. Let Morgan take the toil. Keep your people on the judgment."

---

## 5. Short cuts

### 5a. The 3-minute cut (beats + time budget)
- **0:00–0:30 Problem** (camera): nobody owns the follow-through.
- **0:30–1:00 Define Morgan** (Mission Control): job description before a chat box.
- **1:00–1:40 Knows the numbers** (chat): P&L + anomalies on demand.
- **1:40–2:15 Owns the work + governance** (workday + the HITL stop): autonomous internally, gated externally/financially.
- **2:15–2:40 Microsoft IQ + presence**: grounded answer; voice/avatar/Teams call.
- **2:40–3:00 Close + ask**: digital employee; point her at your tenant; pilot one reporting cycle.

### 5b. The 90-second cold open (if you only get one shot)
**[SAY]**
> "Finance reporting doesn't fail because nobody can answer the question — it fails because **nobody owns the follow-through**. Meet Morgan, a **digital CFO worker** inside Microsoft 365. She has her own mailbox, a job description, finance tools, and a task board. She runs the **budget-versus-actuals, variance, and board-P&L cycle** on her own clock — and **stops at a human approval** before anything leaves Finance or moves money. *A dashboard shows the work; Copilot helps you do the work; **Morgan owns the work.*** Point her at your ledger and your Microsoft 365 tenant, and she runs your live reporting cycle — with an audit trail on every step."

---

## 6. Q&A battlecard (toughest questions → crisp answers)

> Keep answers to ~20 seconds. Lead with the number or the bounded claim.

| # | Question | Answer |
|---|---|---|
| 1 | **What are your numbers / the ROI?** | "Target the repeatable **30–45%** of FP&A and reporting hours. We value them at a **$125 loaded rate**, confidence-adjusted, and we show Morgan's **actual Azure run-rate** against it — she breaks even on **under one workstream per month**." |
| 2 | **What's the unit economic?** | "Per workstream: analyst hours avoided, plus faster/earlier variance catch, **minus** Morgan's run cost and the human review time. The cost dashboard computes it live." |
| 3 | **Who's the real competitor?** | "Not another chatbot — it's the **current fragmented process**: Teams threads, spreadsheets, email, manual chasing. Morgan replaces the coordination, not the controller." |
| 4 | **How is this different from Copilot?** | "**Copilot helps a person complete a task. Morgan owns a cycle.** She has a job description before she has a chat box, and she runs while you're asleep." |
| 5 | **Different from Microsoft's own agents?** | "We **compose, not compete**. Where Microsoft's agent executes a step, Morgan owns the end-to-end accountability and **calls it as a tool**. Mission Control, the approval gates, the evidence ledger, and the cost line are *additive*." |
| 6 | **Can judges touch a prototype?** | "Yes — **Mission Control** is live: job contract, board, blockers, cost, audit. Plus one live action, a real approval stop, and a Teams call." |
| 7 | **What if Morgan is wrong?** | "She **recommends before she acts.** You approve, edit, decline, or override. Every recommendation carries rationale, evidence, a timestamp, and an audit entry." |
| 8 | **Unauthorised sends / sensitive data?** | "External send is a **Level-2** gate; dollar-bearing is **Level-3**. She runs inside your Microsoft 365 and Azure control plane, on Entra identity, with scoped permissions and audit. **Permission-aware retrieval — not tenant scraping.**" |
| 9 | **Is it production-ready?** | "The app, Mission Control, the tools, the approval surface, the audit and cost views, voice and calling are **live**. Today the **finance data is a safe deterministic demo set**; the pilot is where we connect your ledger and Fabric model behind the same contracts." |
| 10 | **What proves success in a pilot?** | "Reporting cycle time **down**, variance caught **earlier**, digest **on time every week**, human review time **down**, and a **visible cost-per-task** — all on the existing dashboards." |
| 11 | **Biggest risk?** | "**Overclaiming autonomy.** So I'm precise: Morgan is autonomous in **monitoring, drafting, analysing, and escalating** — and **gated** on external commitments and money." |
| 12 | **Why not just build a dashboard or a workflow?** | "A dashboard shows work. A workflow routes work. **Morgan owns work** — she initiates it, governs it, and accounts for it." |
| 13 | **Which model is it?** | "It runs on **the Azure OpenAI deployment you configure** — our verified hosted instance routes to a GPT-class model. The reasoning is Azure OpenAI; the finance rigor is in the tools." |
| 14 | **Why you?** | "I built the **working proof**, not just the slide. It compiles, it boots, and every route you saw is real." |

---

## 7. Honesty discipline — say this, never that

**The honest framing line (use it once, proactively):**
> *"To be straight with you: today Morgan runs on a **deterministic Contoso demo dataset** so the numbers are consistent on stage. The **methods, the cadence, the governance, the identity, and the cost economics are all real and running** — point her at your GL, your Fabric or Power BI model, your Agent 365 tools, and a durable store, and the **exact same workflow** runs on your live enterprise numbers."*

**✅ Say (accurate):**
- "Autonomous internally, gated externally and financially."
- "The methods are real; today the data is a safe demo set."
- "She recommends before she acts; a human approves."
- "Permission-aware retrieval inside your tenant."
- "The cost side is **live Azure** data; the value side is a directional model."

**🚫 Never say (overclaim — these are the traps):**
- ❌ "It replaces the finance team." → *(it augments; the controller still signs off.)*
- ❌ "It reads everything in your Microsoft 365." → *(scoped, permission-aware.)*
- ❌ "These are your live numbers." *(unless you've actually connected a tenant source.)*
- ❌ "It's fully autonomous." *(always immediately state what's gated.)*
- ❌ "All integrations are production-ready." *(MCP/Graph/Fabric/ACS/Cosmos are tenant-configured.)*
- ❌ "The model explains its true chain-of-thought." *(you show reasoning summaries and an evidence trail, not raw CoT.)*
- ❌ "It catches every anomaly / eliminates missed deadlines."

---

## 8. Production path — "point her at your stack"

When a buyer asks *"what does it take to run this for real?"*, the contracts are already production-shaped — you swap the data source, not the workflow:

| Capability | Today (demo) | Production swap |
|---|---|---|
| Financial data | Deterministic Contoso (`financialTools`, IQ pillars) | Read-only **Fabric / Power BI semantic model** or **GL/ERP** (SAP S/4HANA, Oracle NetSuite, Dynamics 365 Finance) behind the same `analyzeBudgetVsActuals` / `getLatestPnL` / `queryFabricIQFinancials` contracts |
| Durable state | Process-local task ledger & memory | **Azure Cosmos DB** (`COSMOS_DB_*`) for records, memory, evaluations |
| M365 actions | MCP → Graph → honest fallback | Provision **Agent 365 MCP** + **Microsoft Graph** app credentials (Mail, Calendar, Teams, SharePoint, Planner) |
| Approvals | Surface + prompt-level gating | Add a **dispatcher-level interceptor** that blocks gated tools until an approval record exists |
| Voice / calling | Voice Live + D-ID + ACS (config-gated) | **ACS** connection + Teams federation policy + public host |
| Evaluation & audit | Heuristic scoring; in-memory audit | **Foundry** eval datasets + **Purview / App Insights** export |
| Model | Azure OpenAI deployment you configure | Pin the deployment + region your governance requires |

---

## 9. Proof points & metrics (label them honestly on camera)

**Live / real (state as fact):** the deployed app and Mission Control; the finance tool registry (60 tools) with correctly-computed variance, margin, EBITDA, runway, P&L and trend math; Agent 365 **identity** config; **Teams/ACS calling** path; **Voice Live + D-ID** avatar; **audit events with correlation IDs**; **live Azure cost** data and break-even economics; the **L2/L3 approval** surface with real Adaptive Cards.

**Illustrative / modelled (label as such):**
- ~**30–45%** of FP&A/reporting hours are repeatable assembly — *(target, varies by org)*.
- **$125** loaded analyst hour — *(adjust to the customer)*.
- **Break-even on < 1 workstream/month** — *(from the live cost model + directional value model)*.

**Demo / deterministic (disclose when probed):** all financial figures are Contoso (consistent per period); the 25-minute P&L pulse is a simulated stream; Foundry/Fabric IQ run on demo adapters with a documented production-swap path.

---

## 10. Closing-line bank (pick one to end the video)

1. *"A dashboard shows the work. Copilot helps you do the work. **Morgan owns the work.**"*
2. *"You didn't see an AI demo. You saw a **digital CFO colleague** — with a job, an identity, a phone, a cost line, and an audit trail."*
3. *"**Autonomous on the toil, gated on the judgment.** That's how a finance team actually adopts AI."*
4. *"Point her at your ledger and your tenant — the same workflow runs on your live numbers, tomorrow."*
5. *"This is the **next workforce layer** of the Microsoft cloud."*
