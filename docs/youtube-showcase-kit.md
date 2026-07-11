# Morgan Digital CFO — YouTube Showcase Kit

## Recommended video

**Title:** I Built a Governed AI Teammate That Works Like a Digital CFO

**Subtitle:** Autonomous work, visible tools, server-side approvals, and a glass-box audit trail

**Target length:** 9–11 minutes

## Thumbnail concepts

1. Morgan avatar on the left, Mission Control on the right, large text: **AI TEAMMATE — NOT A CHATBOT**
2. Approval gate in the centre, red blocked arrow changing to green after approval, text: **HUMANS STAY IN CONTROL**
3. Trust Center trace with request → policy → approval → outcome, text: **EVERY ACTION EXPLAINED**

Avoid placing customer names, tenant IDs, email addresses, subscription IDs, secrets, or unredacted prompts in the thumbnail or video.

## One-sentence pitch

Morgan is a governed Digital CFO teammate that plans and performs finance work, shows its evidence, stops at server-side human approval gates, and gives operators a complete decision-and-outcome trace.

## Chapters and presenter script

### 0:00 — Hook

**Screen:** Morgan Trust Center at the top of Mission Control.

**Say:**

> Most AI demos show a chatbot answering a question. Morgan is different. She has a job, a working day, a backlog, tools, memory, cost visibility, policy gates, and an audit trail. More importantly, she cannot approve her own high-impact actions.

### 0:35 — What is live, verified, and demo

**Screen:** Trust Center evidence cards.

**Say:**

> Before the demo, here is the evidence boundary. Mission Control and the policy gateway are live application features. The finance and Microsoft IQ figures are deterministic Contoso demo data. Agent 365 connectors are labelled configured-only until a successful tenant action proves them. The Foundry hosted baseline proves reachability and model routing—not full connector parity.

Pause long enough for viewers to read the labels.

### 1:20 — The job contract

**Screen:** Job Description and operating cadence.

**Say:**

> Morgan operates as a Digital CFO teammate. Her contract defines the outcomes she owns, when she works, what evidence she needs, and when she must stop for a human.

Show the 09:00–17:00 work window, key tasks, and escalation rules.

### 2:10 — Autonomous work selection

**Screen:** D-CFO Kanban and LLM/deterministic reason label.

**Say:**

> Every cycle, Morgan examines the board and selects a small amount of runnable work. The UI records whether the model selected it or the deterministic fallback did. Waiting approval cards are not eligible unless a matching human approval exists.

Open one active card and point to its tools, evidence, owner, and transition history.

### 3:10 — Data provenance

**Screen:** Microsoft IQ cards with DEMO badges and production paths.

**Say:**

> These numbers look realistic because they are stable demo fixtures, but Morgan does not pretend they are customer data. Every data card names its current source and the production path: Graph and Agent 365 for WorkIQ, Foundry assets for evaluation intelligence, and Fabric or Power BI for governed business figures.

### 4:05 — Trigger a governed action

**Screen:** Chat or controlled demo prompt: “Send the board P&L externally.”

**Expected outcome:** `approval_required`; no external send.

**Say:**

> The model can propose the send, but the server decides whether execution is allowed. This is an L2 external-communication action, so Morgan creates an action-bound approval request and stops. A prompt cannot bypass this check.

Show the approval ID and action digest. Do not show the complete report body.

### 5:10 — Prove unauthorized approval fails

**Screen:** Use a prepared test capture or a safe non-authorized test account.

**Say:**

> Authentication is not the same as authorization. A signed-in user who is not on the finance approver allowlist receives a forbidden response. Chat text such as “I am the CFO” is never treated as authority.

Do not deliberately attack a production tenant on camera. A local/test capture is preferable.

### 5:55 — Authorized human decision

**Screen:** Approval queue with the authorized operator signed in.

**Say:**

> The authorized approver sees the recipient, rationale, evidence, expiry, version, and digest. The decision is bound to exactly what was reviewed. Changing the recipient or content changes the digest and requires a new approval.

Approve a safe demo request. If no live email/Teams connector is configured, stop after approval and explain that execution would be simulated or unavailable—never claim delivery.

### 6:55 — One-attempt execution and replay protection

**Screen:** Approval state transition: pending → approved → executing → executed/failed.

**Say:**

> Before the tool runs, Morgan reserves the approval for one execution attempt. Reusing yesterday’s approval, replaying a card, or trying to execute twice is rejected. This is the difference between an approval-looking UI and an enforceable control.

### 7:35 — Glass-box trace

**Screen:** Governance Observability timeline in Morgan Trust Center.

**Say:**

> One correlation ID joins the request, safe decision summary, policy verdict, tool, provenance, human gate, and outcome. Private model chain-of-thought is not exposed. Auditors get the decision evidence they need without leaking hidden reasoning or secrets.

Open policy and provenance details. Show redacted email identity and parameter names, not raw sensitive content.

### 8:35 — Foundry and Agent 365 boundary

**Screen:** Trust Center Foundry card, then the Agent 365 identity/manifest slide or UI.

**Say:**

> Morgan has two separate cloud stories. The Agent 365 blueprint instance provides the Microsoft 365 identity and Works-across experience. The Foundry hosted container is a Responses-protocol deployment proof. They are related, but they are not the same deployment and I do not use one as evidence for the other.

### 9:20 — Cost, value, and close

**Screen:** Cost dashboard, then return to Mission Control.

**Say:**

> Morgan exposes her operating cost and the assumptions behind estimated value. The goal is not to hide AI behind a friendly face. The goal is to make an AI teammate inspectable, governable, and economically measurable.

**Close:**

> If you want a deeper video on the policy gateway, Foundry deployment, Agent 365 identity, or Fabric integration path, leave a comment and subscribe.

## Description template

> Morgan is a governed Digital CFO AI teammate built with TypeScript, Microsoft Agent 365 patterns, Azure OpenAI, Microsoft Foundry hosted-agent Responses, Mission Control, and human-in-the-loop controls.
>
> This demonstration clearly separates live application behavior, verified deployment evidence, configured-only connectors, deterministic Contoso demo data, and unavailable integrations. No customer financial data is shown.
>
> Highlights:
> - Autonomous CFO workday and visible Kanban
> - Server-side L2/L3 policy enforcement
> - Entra-authorized human approvals
> - Action digests, expiry, version checks, and replay protection
> - Data provenance and safe decision summaries
> - Correlation-ID Trust Center trace
> - Agent 365 blueprint vs Foundry hosted-container boundary
> - Cost and value transparency
>
> The verified Foundry baseline demonstrates hosted reachability, Azure OpenAI routing, and bounded response behavior only. It does not prove Graph/MCP, Fabric, Teams voice, Purview, durable distributed storage, scheduler, or sub-agent production parity.

## Suggested tags

`AI agents`, `Microsoft Foundry`, `Azure OpenAI`, `Agent 365`, `AI governance`, `human in the loop`, `Digital CFO`, `enterprise AI`, `AI security`, `Microsoft Fabric`, `TypeScript`

## Recording checklist

### Before recording

- Run `npm test` and preserve the passing output.
- Run `npm run audit:prod`; confirm no high or critical findings.
- Confirm the signed-in recording identity is authorized for the intended demo only.
- Use demo recipients and a non-production Teams channel/mailbox.
- Confirm finance and IQ panels visibly say DEMO.
- Confirm Trust Center says Foundry verified baseline, not full parity.
- Hide browser bookmarks, Azure portal IDs, terminal history, notification banners, and personal email.
- Disable desktop notifications and incoming calls.
- Prepare a fallback recording of the approval flow and hosted response.

### During recording

- Start on the Trust Center evidence boundary.
- Never open local `.env`, Agent 365 local config, tokens, app settings, or raw HTTP authorization headers.
- Do not show private chain-of-thought; call the visible field a decision summary.
- Say “approval required,” “executed,” “simulated,” “configured only,” or “unavailable” precisely.
- Keep the Agent 365 and Foundry deployment explanations separate.

### After recording

- Review every frame containing terminal, browser address bar, Azure portal, approval details, or audit data.
- Blur any tenant, subscription, object, session, email, phone, message, or correlation identifiers that are not intentionally public.
- Add chapter timestamps, captions, and the evidence-boundary disclaimer to the description.
- Do not publish until the final video has been reviewed once as a security/audit reviewer rather than as the presenter.

## Safe fallback shots

- Static Mission Control mockup with the “Static Preview” banner
- Pre-recorded local policy tests
- Trust Center trace using synthetic correlation IDs
- Foundry P0 result JSON with resource identifiers cropped
- Diagram from the governance documentation

## Demo acceptance criteria

The recording is ready when viewers can answer all five questions:

1. What work did Morgan select and why?
2. Which data is real, verified, configured-only, or demo?
3. Which policy allowed or blocked the action?
4. Which human approved the exact action, and was replay prevented?
5. What evidence proves the final outcome?
