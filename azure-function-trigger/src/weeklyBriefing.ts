import { app, InvocationContext, Timer } from '@azure/functions';
import axios from 'axios';
import 'dotenv/config';

const MORGAN_AGENT_URL = process.env.MORGAN_AGENT_URL ?? '';
const SCHEDULED_SECRET = process.env.SCHEDULED_SECRET ?? '';

function morganBaseUrl(): string {
    return MORGAN_AGENT_URL.replace(/\/$/, '');
}

function scheduledHeaders(): Record<string, string> {
    if (!SCHEDULED_SECRET) {
        throw new Error('SCHEDULED_SECRET environment variable is not set');
    }
    return {
        Authorization: `Bearer ${SCHEDULED_SECRET}`,
        'x-scheduled-secret': SCHEDULED_SECRET,
        'Content-Type': 'application/json',
    };
}

async function postMorganScheduledEndpoint(
    path: string,
    triggerType: string,
    description: string,
    context: InvocationContext,
): Promise<void> {
    if (!MORGAN_AGENT_URL) {
        context.error('MORGAN_AGENT_URL environment variable is not set');
        return;
    }

    const response = await axios.post(
        `${morganBaseUrl()}${path}`,
        {
            triggerType,
            scheduledFor: new Date().toISOString(),
            description,
        },
        {
            headers: scheduledHeaders(),
            timeout: 30_000,
        },
    );

    context.log(`${triggerType} completed successfully. Status: ${response.status}`);
}

// Every Sunday at 22:00 UTC = Monday 08:00 AEST (UTC+10)
export async function weeklyBriefing(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('weeklyBriefing trigger fired — initiating Monday morning briefing for Morgan');

    try {
        await postMorganScheduledEndpoint(
            '/api/scheduled',
            'weeklyBriefing',
            'Monday morning CFO briefing — portfolio snapshot, anomalies, and week-ahead priorities',
            context,
        );
    } catch (err) {
        context.error('weeklyBriefing failed to reach Morgan agent', err);
        throw err; // re-throw so Azure Functions marks this invocation as failed
    }
}

// Every day at 09:00 in the Function App schedule timezone.
// Set WEBSITE_TIME_ZONE on the Function App if this should be local business time instead of UTC.
export async function dailyAnomalyCheck(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('dailyAnomalyCheck trigger fired — scanning for financial anomalies');

    try {
        await postMorganScheduledEndpoint(
            '/api/scheduled',
            'dailyAnomalyCheck',
            'Daily anomaly scan — variance alerts, budget overruns, and cash-flow flags',
            context,
        );
    } catch (err) {
        context.error('dailyAnomalyCheck failed to reach Morgan agent', err);
        throw err;
    }
}

export async function autonomousWorkdayCycle(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('autonomousWorkdayCycle trigger fired — running Morgan CFO execution cycle');

    try {
        await postMorganScheduledEndpoint(
            '/api/mission-control/run-workday',
            'autonomousWorkdayCycle',
            '09:00-17:00 seven-day Morgan CFO execution cycle — plan, IQ synthesis, tool checks, sub-agent handoffs, and proof recording',
            context,
        );
    } catch (err) {
        context.error('autonomousWorkdayCycle failed to reach Morgan agent', err);
        throw err;
    }
}

export async function endOfDayReport(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('endOfDayReport trigger fired — initiating Morgan day-end CFO report');

    try {
        await postMorganScheduledEndpoint(
            '/api/scheduled/end-of-day',
            'endOfDayReport',
            '17:00 Morgan CFO day-end report — completed work, blocked work, Microsoft IQ findings, lessons, and next priorities',
            context,
        );
    } catch (err) {
        context.error('endOfDayReport failed to reach Morgan agent', err);
        throw err;
    }
}

// ── Function registrations ────────────────────────────────────────────────────

app.timer('weeklyBriefing', {
    // Every Sunday 22:00 UTC  →  Monday 08:00 AEST
    schedule: '0 0 22 * * 0',
    handler: weeklyBriefing,
});

app.timer('dailyAnomalyCheck', {
    // Daily 09:00 in the Function App schedule timezone.
    schedule: '0 0 9 * * *',
    handler: dailyAnomalyCheck,
});

app.timer('autonomousWorkdayCycle', {
    // Daily 09:00-16:50 in the Function App schedule timezone, every 25 minutes.
    schedule: '0 0,25,50 9-16 * * *',
    handler: autonomousWorkdayCycle,
});

app.timer('endOfDayReport', {
    // Daily 17:00 in the Function App schedule timezone.
    schedule: '0 0 17 * * *',
    handler: endOfDayReport,
});
