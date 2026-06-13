import * as fs from 'fs';
import * as path from 'path';
import type { ChatCompletionTool } from 'openai/resources/chat';
import type { MissionTaskRecord } from '../mission/missionControl';

export interface CfoRetrospective {
  date: string;
  period: string;
  generatedAt: string;
  recommendations: string[];
  groundedIn: {
    completedCount: number;
    blockedCount: number;
    failedCount: number;
    patterns: string[];
  };
}

const RETRO_PATH = path.resolve(process.cwd(), '.data/morgan-cfo-retrospectives.json');
const MAX_ENTRIES = 12;

function loadRetroFile(): CfoRetrospective[] {
  try {
    if (!fs.existsSync(RETRO_PATH)) return [];
    return JSON.parse(fs.readFileSync(RETRO_PATH, 'utf-8')) as CfoRetrospective[];
  } catch {
    return [];
  }
}

function saveRetroFile(entries: CfoRetrospective[]): void {
  try {
    fs.mkdirSync(path.dirname(RETRO_PATH), { recursive: true });
    fs.writeFileSync(RETRO_PATH, JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2), 'utf-8');
  } catch {
    // non-fatal
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function periodKey(): string {
  return new Date().toISOString().slice(0, 7);
}

export function deriveRecommendations(records: MissionTaskRecord[]): { recommendations: string[]; patterns: string[] } {
  const recommendations: string[] = [];
  const patterns: string[] = [];

  const blockedOrFailed = records.filter((r) => r.status === 'blocked' || r.status === 'failed');

  const closeLate = blockedOrFailed.filter((r) => r.taskId?.includes('close') || r.taskId?.includes('reconcil'));
  if (closeLate.length > 0) {
    patterns.push('close-late');
    recommendations.push(
      `Move month-end close prep to T-5 — ${closeLate.length} reconciliation task(s) hit gaps too close to the board reporting deadline this cycle.`,
    );
  }

  const approvalSla = blockedOrFailed.filter(
    (r) => r.taskId?.includes('approval') || r.taskId?.includes('signoff') || r.taskId?.includes('board') || r.taskId?.includes('report'),
  );
  if (approvalSla.length > 0) {
    patterns.push('approval-sla');
    recommendations.push(
      `Add 24h/48h/72h SLA nudges for board reporting sign-offs — ${approvalSla.length} approval item(s) stalled without a structured chase cadence.`,
    );
  }

  const forecastLate = blockedOrFailed.filter((r) => r.taskId?.includes('budget') || r.taskId?.includes('forecast') || r.taskId?.includes('variance'));
  if (forecastLate.length > 0) {
    patterns.push('forecast-late');
    recommendations.push(
      `Run budget-vs-forecast and no-double-count checks at intake — ${forecastLate.length} item(s) required rework after the variance pack was already started.`,
    );
  }

  const anomalyGap = blockedOrFailed.filter(
    (r) => !r.taskId?.includes('close') && (r.summary?.toLowerCase().includes('anomaly') || r.summary?.toLowerCase().includes('variance')),
  );
  if (anomalyGap.length > 0 && !patterns.includes('close-late')) {
    patterns.push('anomaly-gap');
    recommendations.push(
      `Ground anomaly detection in WorkIQ/FabricIQ signals earlier — ${anomalyGap.length} item(s) had variance gaps that surfaced late in the cycle.`,
    );
  }

  // Always-on process improvement
  recommendations.push(
    'Expand the Closeout Reporter cadence so lessons from each completed month-end close feed directly into the next reporting cycle.',
  );

  if (records.filter((r) => r.status === 'completed').length > 0) {
    recommendations.push(
      'Use WorkIQ stakeholder signals and FabricIQ cash-flow forecast to prioritise which finance workstreams get autonomous monitoring bandwidth next cycle.',
    );
  }

  return { recommendations, patterns };
}

export function generateAndSaveRetrospective(records: MissionTaskRecord[]): CfoRetrospective {
  const completedCount = records.filter((r) => r.status === 'completed').length;
  const blockedCount = records.filter((r) => r.status === 'blocked').length;
  const failedCount = records.filter((r) => r.status === 'failed').length;

  const { recommendations, patterns } = deriveRecommendations(records);

  const retro: CfoRetrospective = {
    date: todayKey(),
    period: periodKey(),
    generatedAt: new Date().toISOString(),
    recommendations,
    groundedIn: { completedCount, blockedCount, failedCount, patterns },
  };

  const existing = loadRetroFile();
  // Replace if same date, otherwise append
  const others = existing.filter((e) => e.date !== retro.date);
  saveRetroFile([...others, retro]);
  return retro;
}

export function getRetrospectiveHistory(): CfoRetrospective[] {
  return loadRetroFile().slice().reverse().slice(0, 6);
}

export function getLatestRetrospective(): CfoRetrospective | null {
  const history = getRetrospectiveHistory();
  return history[0] ?? null;
}

export const RETROSPECTIVE_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'generateCfoRetrospective',
      description: 'Generate and persist a Digital CFO operational retrospectivederived from today\'s task records. Returns what Morgan would do differently next cycle, grounded in blocked/failed finance workstream patterns (budget variance, forecast, month-end close, board reporting).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getRetrospectiveHistory',
      description: 'Return the last 6 Digital CFO retrospectives showing how Morgan\'s operational recommendations have evolved over time. Use to demonstrate learning across finance close and reporting cycles.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];
