import { getEndOfDayReport, runAutonomousCfoWorkday } from '../mission/missionControl';
import { recordAuditEvent } from '../observability/agentAudit';

interface SchedulerState {
  enabled: boolean;
  timeZone: string;
  windowStartHour: number;
  windowEndHour: number;
  intervalMinutes: number;
  pollMs: number;
  started: boolean;
  running: boolean;
  lastCycleAt?: string;
  lastCycleDate?: string;
  lastEndOfDayDate?: string;
  lastError?: string;
}

let intervalHandle: NodeJS.Timeout | null = null;
const state: SchedulerState = {
  enabled: process.env.AUTONOMOUS_WORKDAY_ENABLED === 'true',
  timeZone: process.env.AUTONOMOUS_WORKDAY_TIME_ZONE || 'Australia/Sydney',
  windowStartHour: Number(process.env.AUTONOMOUS_WORKDAY_START_HOUR || 9),
  windowEndHour: Number(process.env.AUTONOMOUS_WORKDAY_END_HOUR || 17),
  intervalMinutes: Number(process.env.AUTONOMOUS_WORKDAY_INTERVAL_MINUTES || 25),
  pollMs: Number(process.env.AUTONOMOUS_WORKDAY_POLL_MS || 60_000),
  started: false,
  running: false,
};

function zonedParts(date = new Date()): { dateKey: string; hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: state.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date).reduce<Record<string, string>>((output, part) => {
      if (part.type !== 'literal') output[part.type] = part.value;
      return output;
    }, {});
    return {
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    };
  } catch {
    return {
      dateKey: date.toISOString().slice(0, 10),
      hour: date.getHours(),
      minute: date.getMinutes(),
    };
  }
}

function insideWorkWindow(parts = zonedParts()): boolean {
  return parts.hour >= state.windowStartHour && parts.hour < state.windowEndHour;
}

function dueForCycle(now = Date.now()): boolean {
  if (!state.lastCycleAt) return true;
  return now - new Date(state.lastCycleAt).getTime() >= state.intervalMinutes * 60_000;
}

async function runSchedulerTick(): Promise<void> {
  if (!state.enabled || state.running) return;
  const now = Date.now();
  const parts = zonedParts(new Date(now));

  if (!insideWorkWindow(parts)) {
    if (parts.hour >= state.windowEndHour && state.lastEndOfDayDate !== parts.dateKey) {
      const report = getEndOfDayReport({ date: parts.dateKey });
      state.lastEndOfDayDate = parts.dateKey;
      recordAuditEvent({
        kind: 'autonomous.scheduler.end-of-day',
        label: 'Autonomous workday end-of-day report prepared',
        data: {
          date: parts.dateKey,
          completedTasks: report.completedTasks.length,
          blockedTasks: report.blockedTasks.length,
          failedTasks: report.failedTasks.length,
        },
      });
    }
    return;
  }

  if (!dueForCycle(now)) return;

  state.running = true;
  try {
    const result = await runAutonomousCfoWorkday({ source: 'autonomous_cycle' });
    state.lastCycleAt = new Date(now).toISOString();
    state.lastCycleDate = parts.dateKey;
    state.lastError = undefined;
    recordAuditEvent({
      kind: 'autonomous.scheduler.cycle',
      label: 'Autonomous CFO workday cycle completed',
      data: {
        period: result.period,
        records: result.records.length,
        subAgentHandoffs: result.subAgentHandoffs.map((handoff) => `${handoff.agentId}:${handoff.status}`),
      },
    });
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    recordAuditEvent({
      kind: 'autonomous.scheduler.failed',
      label: 'Autonomous CFO workday cycle failed',
      severity: 'error',
      data: { error: state.lastError },
    });
  } finally {
    state.running = false;
  }
}

export function startAutonomousWorkdayScheduler(): void {
  if (state.started) return;
  state.started = true;

  if (!state.enabled) {
    console.log('[autonomous-scheduler] Disabled. Set AUTONOMOUS_WORKDAY_ENABLED=true to run the 09:00-17:00 CFO workday loop.');
    recordAuditEvent({
      kind: 'autonomous.scheduler.disabled',
      label: 'Autonomous workday scheduler disabled by configuration',
      data: { enabled: false },
    });
    return;
  }

  console.log(`[autonomous-scheduler] Enabled for ${state.windowStartHour}:00-${state.windowEndHour}:00 ${state.timeZone}, every ${state.intervalMinutes} minutes.`);
  recordAuditEvent({
    kind: 'autonomous.scheduler.started',
    label: 'Autonomous workday scheduler started',
    data: {
      timeZone: state.timeZone,
      windowStartHour: state.windowStartHour,
      windowEndHour: state.windowEndHour,
      intervalMinutes: state.intervalMinutes,
    },
  });

  void runSchedulerTick();
  intervalHandle = setInterval(() => void runSchedulerTick(), state.pollMs);
}

export function stopAutonomousWorkdayScheduler(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  state.started = false;
}

export function getAutonomousWorkdaySchedulerStatus(): SchedulerState & { inWindow: boolean; localDate: string; localHour: number; localMinute: number } {
  const parts = zonedParts();
  return {
    ...state,
    inWindow: insideWorkWindow(parts),
    localDate: parts.dateKey,
    localHour: parts.hour,
    localMinute: parts.minute,
  };
}
