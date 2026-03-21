# Morgan — Tools, Integrations & Sample Questions

> Quick reference for demo conversations with Morgan via Teams chat or Voice Live.

---

## Voice Interface

**URL:** `https://<your-app-name>.azurewebsites.net/voice`

---

## Sample Questions to Ask Morgan

### Budget & Actuals
- "How are we tracking against budget this quarter?"
- "Show me budget vs actuals for marketing"
- "Are there any departments over budget?"
- "What's our total variance for March 2026?"
- "Break down the R&D spend against what was budgeted"

### Financial KPIs
- "What are our key financial metrics?"
- "Give me a summary of our KPIs for Q1"
- "What's our gross margin looking like?"
- "How much cash runway do we have?"
- "What's our monthly burn rate?"

### Anomaly Detection
- "Are there any unusual spending patterns?"
- "Flag any financial anomalies above 10 percent"
- "Which categories are significantly over budget?"
- "Run an anomaly scan on this month's numbers"

### Trend Analysis
- "What's the revenue trend over the last 6 months?"
- "How has our burn rate trended?"
- "Show me the EBITDA trend"
- "Is marketing spend going up or down?"
- "What direction is our cash runway heading?"

### General Context
- "Tell me about the company"
- "What date is it today?"

### Conversational Follow-ups
- "Why is that category over budget?"
- "What should we do about the variance in OPEX?"
- "Can you compare this month to last month?"
- "Summarise the financial health in one sentence"

---

## Morgan's Tools

| Tool | What It Does | Parameters |
|---|---|---|
| **`analyzeBudgetVsActuals`** | Compares budget vs actual spend by category, flags overruns and calculates variance in dollars and percentages | `period` (required), `category` (optional) |
| **`getFinancialKPIs`** | Returns Gross Margin %, EBITDA, Cash Runway (months), Monthly Burn Rate, and Revenue Growth % | `period` (required) |
| **`detectAnomalies`** | Scans all expense and revenue categories for items exceeding a variance threshold; returns severity-classified alerts (critical / warning / info) | `period` (required), `threshold_percent` (required) |
| **`calculateTrend`** | Calculates a historical trend for a financial metric over N months; returns trend direction and overall change | `metric` (required), `periods` (required) |
| **`get_current_date`** | Returns the current date and time | — |
| **`get_company_context`** | Returns company info: name, ticker, industry, fiscal year end, currency | — |

---

## Production Integration Map

Each tool currently returns deterministic mock data for consistent demos. In production, each tool would make an authenticated API call to the corresponding system.

### Tool → Data Source Mapping

| Tool | Production Data Source | Integration Method |
|---|---|---|
| **`analyzeBudgetVsActuals`** | **SAP S/4HANA** or **Oracle NetSuite** GL module | REST API — pulls real-time budget allocations and posted actuals from the ERP general ledger |
| **`getFinancialKPIs`** | **Power BI Dataflows** or **Microsoft Fabric Lakehouse** | Semantic Link / REST API — queries the aggregated KPI layer sitting on top of the enterprise data warehouse |
| **`detectAnomalies`** | **Azure Anomaly Detector** + **Dataverse** | Azure AI Services — ML-based anomaly scoring against historical GL posting patterns and seasonal baselines |
| **`calculateTrend`** | **Azure Data Explorer (Kusto)** | KQL queries — time-series analysis against financial telemetry stored in ADX clusters |
| **`get_company_context`** | **Microsoft Graph** + **Dataverse** | Graph API — org profile, tenant metadata, fiscal calendar from the company's M365/Dynamics tenant |

### Platform & Channel Integrations

| System | How Morgan Uses It | Status |
|---|---|---|
| **Microsoft Teams** | Chat interface + proactive P&L alerts posted to the Finance channel on a 25-minute monitoring cycle | ✅ Live |
| **Azure Voice Live** | Real-time speech-to-speech via browser — HD neural voice (Ava), server-side VAD, noise suppression, echo cancellation | ✅ Live |
| **Azure OpenAI (GPT-5)** | Primary LLM for reasoning, tool selection, and response generation (East US 2, 100K TPM) | ✅ Live |
| **MCP (Model Context Protocol)** | Runtime tool extensibility — add new tools without redeploying the agent | ✅ Live |
| **SharePoint / OneDrive** | Pull board decks, quarterly reports, and budget spreadsheets as grounding data for RAG | 🔜 Production |
| **Dynamics 365 Finance** | AP/AR aging, cash flow forecasting, intercompany reconciliation, journal entries | 🔜 Production |
| **Bloomberg / Refinitiv API** | Market data feeds, peer benchmarking, FX rates for multi-currency reporting | 🔜 Production |
| **Azure Data Explorer** | Time-series financial telemetry, real-time dashboarding, ad hoc KQL queries | 🔜 Production |
| **Microsoft Fabric** | Unified analytics — lakehouse, data pipelines, Power BI semantic models as a single source of truth | 🔜 Production |

---

## Architecture Summary

| Component | Technology |
|---|---|
| Agent Runtime | Microsoft Agents SDK (`@microsoft/agents-hosting` v1.2.2) |
| LLM | Azure OpenAI GPT-5 (East US 2, 100K TPM) |
| Voice | Azure Voice Live API + HD Neural Voice (en-US-Ava:DragonHDLatestNeural) |
| Hosting | Azure App Service (B1, Node.js 20, Australia East) |
| Auth | Azure Managed Identity + DefaultAzureCredential |
| Chat Channel | Microsoft Teams (Agentic Auth) |
| Voice Channel | Browser WebSocket → server-side Voice Live proxy |
| Proactive Alerts | 25-min interval P&L monitoring → Teams channel |
| Tool Extension | MCP (Model Context Protocol) for runtime tool registration |
