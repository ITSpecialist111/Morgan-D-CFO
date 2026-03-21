# Morgan — CFO's Digital Finance Analyst

> An autonomous AI agent that acts as a Digital Finance Analyst, built on Microsoft's Agents SDK with Azure OpenAI GPT-5, Azure Voice Live, and MCP (Model Context Protocol) integration.

![Morgan Architecture](docs/architecture.png)

## What is Morgan?

Morgan is a purpose-built AI agent for CFO-office workflows — not a general-purpose chatbot. She's designed as a **Digital Finance Analyst** who can autonomously execute multi-step financial workflows: pulling live data, running calculations, drafting board-ready reports, distributing them via email or Teams, and doing all of this on a schedule — without a human pressing a button.

### Key Capabilities

- **Budget vs Actuals Analysis** — Real-time budget variance analysis with anomaly detection
- **Financial KPIs** — Gross Margin, EBITDA, Cash Runway, Burn Rate, Revenue Growth
- **Anomaly Detection** — ML-style severity classification (critical / warning / info)
- **Trend Analysis** — Historical trend calculation with direction and % change
- **Proactive P&L Monitoring** — Automated 25-minute interval P&L alerts via Teams
- **Autonomous Briefings** — Scheduled weekly financial digests generated and distributed without human intervention
- **Voice Interface** — Real-time speech-to-speech via Azure Voice Live with HD Neural Voice
- **People Lookup** — Microsoft Graph integration to resolve names to email addresses
- **Cross-Channel Control** — Enable/disable voice interface from Teams chat

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Morgan Agent                                │
│                                                                      │
│  ┌────────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │ Teams Chat │   │  Agent Core  │   │      Tool Registry       │  │
│  │  (Agentic  │──▶│ (GPT-5 +     │──▶│  analyzeBudgetVsActuals  │  │
│  │   Auth)    │   │  ReAct loop) │   │  getFinancialKPIs        │  │
│  └────────────┘   │              │   │  detectAnomalies         │  │
│                   │  System      │   │  calculateTrend          │  │
│  ┌────────────┐   │  Prompt +    │   │  lookupPerson (Graph)    │  │
│  │ Voice Live │──▶│  Persona     │   │  sendEmail (MCP)         │  │
│  │ (Browser)  │   │              │   │  sendTeamsMessage (MCP)  │  │
│  └────────────┘   └──────────────┘   │  createWordDocument (MCP)│  │
│                          │           │  readSharePointData (MCP)│  │
│  ┌────────────┐          │           └──────────────────────────┘  │
│  │  Scheduler │──────────┘                                         │
│  │ (25-min    │                                                    │
│  │  interval) │                                                    │
│  └────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘
         │                    │                        │
         ▼                    ▼                        ▼
  ┌─────────────┐   ┌──────────────┐          ┌──────────────┐
  │ Azure OpenAI│   │  Voice Live  │          │  MCP Servers  │
  │   (GPT-5)  │   │  (HD Voice)  │          │ (Mail/Teams/  │
  └─────────────┘   └──────────────┘          │  SharePoint)  │
                                              └──────────────┘
```

## Tech Stack

| Component | Technology |
|---|---|
| Agent Runtime | Microsoft Agents SDK (`@microsoft/agents-hosting`) |
| LLM | Azure OpenAI GPT-5 |
| Voice | Azure Voice Live API + HD Neural Voice (Ava) |
| Hosting | Azure App Service (Node.js 20) |
| Auth | Azure Managed Identity + DefaultAzureCredential |
| Chat Channel | Microsoft Teams (Agentic Auth) |
| Voice Channel | Browser WebSocket → server-side Voice Live proxy |
| Proactive Alerts | In-process interval timer → Teams `continueConversation` |
| Tool Extension | MCP (Model Context Protocol) via Agent 365 |
| People Search | Microsoft Graph API (`User.Read.All`) |

## Project Structure

```
synth-finance-agent/
├── src/
│   ├── index.ts              # Express server, routes, HTTP/WS setup
│   ├── agent.ts              # Agent message handler, LLM agentic loop
│   ├── persona.ts            # Morgan's system prompt and briefing prompt
│   ├── tools/
│   │   ├── index.ts          # Tool registry, dispatcher, autonomous briefing
│   │   ├── financialTools.ts # Budget analysis, KPIs, anomalies, trends
│   │   ├── reportTools.ts    # Report formatting, Teams formatting
│   │   └── mcpToolSetup.ts   # MCP integration, email, people lookup (Graph)
│   ├── scheduler/
│   │   ├── proactiveMonitor.ts  # 25-min P&L monitoring via Teams
│   │   └── pnlMessages.ts      # Dynamic P&L message generation
│   └── voice/
│       ├── voiceProxy.ts     # WebSocket proxy to Azure Voice Live
│       ├── voiceTools.ts     # Voice-specific tool definitions
│       ├── voiceGate.ts      # Enable/disable voice via Teams commands
│       └── voice.html        # Browser voice UI (orb, transcript, mute)
├── azure-function-trigger/   # Azure Functions timer trigger (weekly briefing)
├── manifest/                 # Teams app manifest
├── publish/                  # Deployment package (pre-compiled)
├── .env.template             # Environment variable template
├── package.json
└── tsconfig.json
```

## Features in Detail

### Voice Interface (Azure Voice Live)

Morgan has a browser-based voice interface powered by Azure Voice Live API:

- **HD Neural Voice** — `en-US-Ava:DragonHDLatestNeural` for natural speech output
- **Semantic VAD** — Azure semantic voice activity detection for accurate turn-taking
- **Barge-in Support** — Interrupt Morgan mid-sentence; she stops immediately and responds to the new input
- **Noise Suppression** — Server-side `azure_deep_noise_suppression`
- **Echo Cancellation** — Server-side `server_echo_cancellation`
- **AudioWorklet Capture** — High-quality mic capture with linear interpolation resampling
- **Mute Button** — Disable mic during noisy environments

**Voice Gate**: Voice is disabled by default. Enable/disable from Teams:
- `"enable voice"` — Activates the voice page
- `"disable voice"` — Shows professional offline screen to visitors
- `"voice status"` — Check current state

### Proactive P&L Monitoring

Say `"start monitoring"` in Teams and Morgan sends financial updates every 25 minutes:
- Revenue, margin, and expense movements with trend indicators
- Anomaly alerts with severity classification
- Dynamic messages that vary each cycle (variance spotlights, margin analysis, expense breakdowns)

### People Lookup (Microsoft Graph)

Morgan can resolve names to email addresses using Microsoft Graph:
- Ask: *"Email Sarah the budget report"*
- Morgan calls `lookupPerson({ name: "Sarah" })` → resolves to full email address
- Then sends the email with the correct recipient

### MCP Integration (Agent 365)

Morgan connects to Microsoft 365 services via MCP servers:
- **Mail** — Send emails on behalf of the finance team
- **Teams** — Post messages to channels
- **SharePoint** — Read financial data from document libraries
- **Word** — Create formatted reports
- **OneDrive, Calendar, Planner, Excel** — Additional capabilities via MCP

## Tools Reference

| Tool | What It Does | Parameters |
|---|---|---|
| `analyzeBudgetVsActuals` | Budget vs actual spend comparison with variance flags | `period` (required), `category` (optional) |
| `getFinancialKPIs` | Gross Margin %, EBITDA, Cash Runway, Burn Rate, Revenue Growth % | `period` (required) |
| `detectAnomalies` | Scan for variance beyond threshold; severity-classified alerts | `period`, `threshold_percent` (both required) |
| `calculateTrend` | Historical trend for any metric over N months | `metric`, `periods` (both required) |
| `lookupPerson` | Search for a person by name via Microsoft Graph | `name` (required) |
| `sendEmail` | Send email via M365 Mail (MCP) | `to`, `subject`, `body` (required) |
| `sendTeamsMessage` | Post to a Teams channel (MCP) | `channel_id`, `message` (required) |
| `get_current_date` | Current date/time | — |
| `get_company_context` | Company metadata (Contoso Financial) | — |

## Getting Started

### Prerequisites

- Node.js 20+
- Azure subscription
- Azure OpenAI resource with a GPT model deployed
- Azure AI Services resource (for Voice Live)
- Microsoft Entra app registration (via Agent 365 setup)
- Microsoft Teams (for chat channel)

### Local Development

1. Clone the repository:
   ```bash
   git clone https://github.com/ITSpecialist111/Morgan-D-CFO.git
   cd Morgan-D-CFO/synth-finance-agent
   ```

2. Copy the environment template:
   ```bash
   cp .env.template .env
   ```

3. Fill in your Azure resource values in `.env`

4. Install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

5. Run locally:
   ```bash
   npm start
   ```

6. Morgan will be available at:
   - Health: `http://localhost:3978/api/health`
   - Voice: `http://localhost:3978/voice`
   - Messages: `http://localhost:3978/api/messages` (Teams webhook)

### Azure Deployment

1. Create an Azure App Service (B1 or higher, Node.js 20)
2. Configure app settings from `.env.template`
3. Deploy the `publish/` folder:
   ```bash
   cd publish
   zip -r ../deploy.zip .
   az webapp deploy --name <your-app> --resource-group <your-rg> --src-path ../deploy.zip --type zip
   ```
4. Enable WebSockets on the App Service
5. Configure the Teams app manifest with your bot's App ID and endpoint

### Voice Live Setup

1. Create an Azure AI Services resource (kind: AIServices, S0)
2. Set a custom domain on the resource
3. Assign `Cognitive Services User` + `Azure AI User` roles to the App Service managed identity
4. Set app settings:
   - `VOICELIVE_ENDPOINT` = `https://<your-resource>.cognitiveservices.azure.com/`
   - `VOICELIVE_MODEL` = `gpt-5` (or your deployed model)

## Sample Questions

### Budget & Actuals
- "How are we tracking against budget this quarter?"
- "Show me budget vs actuals for marketing"
- "Are there any departments over budget?"

### Financial KPIs
- "What are our key financial metrics?"
- "What's our gross margin looking like?"
- "How much cash runway do we have?"

### Anomaly Detection
- "Flag any financial anomalies above 10 percent"
- "Which categories are significantly over budget?"

### Trend Analysis
- "What's the revenue trend over the last 6 months?"
- "Is marketing spend going up or down?"

### Actions
- "Email Sarah the budget report for February"
- "Start monitoring" / "Stop monitoring"
- "Enable voice" / "Disable voice"

## Demo Notes

- All financial data is **deterministic mock data** for Contoso Financial (ticker: CFIN). The same question for the same period always returns consistent numbers.
- In production, each tool would make authenticated API calls to SAP, NetSuite, Power BI, Fabric, etc.
- The voice interface defaults to **disabled** — enable it from Teams before demoing.

## License

MIT
