import { app, InvocationContext, Timer } from '@azure/functions';
import axios from 'axios';
import 'dotenv/config';

const MORGAN_AGENT_URL = process.env.MORGAN_AGENT_URL ?? '';
const SCHEDULED_SECRET = process.env.SCHEDULED_SECRET ?? '';

// Every Sunday at 22:00 UTC = Monday 08:00 AEST (UTC+10)
export async function weeklyBriefing(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('weeklyBriefing trigger fired — initiating Monday morning briefing for Morgan');

    if (!MORGAN_AGENT_URL) {
        context.error('MORGAN_AGENT_URL environment variable is not set');
        return;
    }

    try {
        const response = await axios.post(
            `${MORGAN_AGENT_URL}/api/scheduled`,
            {
                triggerType: 'weeklyBriefing',
                scheduledFor: new Date().toISOString(),
                description: 'Monday morning CFO briefing — portfolio snapshot, anomalies, and week-ahead priorities',
            },
            {
                headers: {
                    Authorization: `Bearer ${SCHEDULED_SECRET}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30_000,
            }
        );

        context.log(`weeklyBriefing completed successfully. Status: ${response.status}`);
    } catch (err) {
        context.error('weeklyBriefing failed to reach Morgan agent', err);
        throw err; // re-throw so Azure Functions marks this invocation as failed
    }
}

// Every Monday–Friday at 23:00 UTC = Tuesday–Saturday 09:00 AEST (UTC+10)
// Runs Mon–Fri UTC which covers the Tue–Sat AEST window; adjust if needed for your timezone policy
export async function dailyAnomalyCheck(myTimer: Timer, context: InvocationContext): Promise<void> {
    context.log('dailyAnomalyCheck trigger fired — scanning for financial anomalies');

    if (!MORGAN_AGENT_URL) {
        context.error('MORGAN_AGENT_URL environment variable is not set');
        return;
    }

    try {
        const response = await axios.post(
            `${MORGAN_AGENT_URL}/api/scheduled`,
            {
                triggerType: 'dailyAnomalyCheck',
                scheduledFor: new Date().toISOString(),
                description: 'Daily anomaly scan — variance alerts, budget overruns, and cash-flow flags',
            },
            {
                headers: {
                    Authorization: `Bearer ${SCHEDULED_SECRET}`,
                    'Content-Type': 'application/json',
                },
                timeout: 30_000,
            }
        );

        context.log(`dailyAnomalyCheck completed successfully. Status: ${response.status}`);
    } catch (err) {
        context.error('dailyAnomalyCheck failed to reach Morgan agent', err);
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
    // Monday–Friday 23:00 UTC  →  09:00 AEST next day
    schedule: '0 0 23 * * 1-5',
    handler: dailyAnomalyCheck,
});
