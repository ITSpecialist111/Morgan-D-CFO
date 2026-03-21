"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.weeklyBriefing = weeklyBriefing;
exports.dailyAnomalyCheck = dailyAnomalyCheck;
const functions_1 = require("@azure/functions");
const axios_1 = __importDefault(require("axios"));
require("dotenv/config");
const MORGAN_AGENT_URL = process.env.MORGAN_AGENT_URL ?? '';
const SCHEDULED_SECRET = process.env.SCHEDULED_SECRET ?? '';
// Every Sunday at 22:00 UTC = Monday 08:00 AEST (UTC+10)
async function weeklyBriefing(myTimer, context) {
    context.log('weeklyBriefing trigger fired — initiating Monday morning briefing for Morgan');
    if (!MORGAN_AGENT_URL) {
        context.error('MORGAN_AGENT_URL environment variable is not set');
        return;
    }
    try {
        const response = await axios_1.default.post(`${MORGAN_AGENT_URL}/api/scheduled`, {
            triggerType: 'weeklyBriefing',
            scheduledFor: new Date().toISOString(),
            description: 'Monday morning CFO briefing — portfolio snapshot, anomalies, and week-ahead priorities',
        }, {
            headers: {
                Authorization: `Bearer ${SCHEDULED_SECRET}`,
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        });
        context.log(`weeklyBriefing completed successfully. Status: ${response.status}`);
    }
    catch (err) {
        context.error('weeklyBriefing failed to reach Morgan agent', err);
        throw err; // re-throw so Azure Functions marks this invocation as failed
    }
}
// Every Monday–Friday at 23:00 UTC = Tuesday–Saturday 09:00 AEST (UTC+10)
// Runs Mon–Fri UTC which covers the Tue–Sat AEST window; adjust if needed for your timezone policy
async function dailyAnomalyCheck(myTimer, context) {
    context.log('dailyAnomalyCheck trigger fired — scanning for financial anomalies');
    if (!MORGAN_AGENT_URL) {
        context.error('MORGAN_AGENT_URL environment variable is not set');
        return;
    }
    try {
        const response = await axios_1.default.post(`${MORGAN_AGENT_URL}/api/scheduled`, {
            triggerType: 'dailyAnomalyCheck',
            scheduledFor: new Date().toISOString(),
            description: 'Daily anomaly scan — variance alerts, budget overruns, and cash-flow flags',
        }, {
            headers: {
                Authorization: `Bearer ${SCHEDULED_SECRET}`,
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        });
        context.log(`dailyAnomalyCheck completed successfully. Status: ${response.status}`);
    }
    catch (err) {
        context.error('dailyAnomalyCheck failed to reach Morgan agent', err);
        throw err;
    }
}
// ── Function registrations ────────────────────────────────────────────────────
functions_1.app.timer('weeklyBriefing', {
    // Every Sunday 22:00 UTC  →  Monday 08:00 AEST
    schedule: '0 0 22 * * 0',
    handler: weeklyBriefing,
});
functions_1.app.timer('dailyAnomalyCheck', {
    // Monday–Friday 23:00 UTC  →  09:00 AEST next day
    schedule: '0 0 23 * * 1-5',
    handler: dailyAnomalyCheck,
});
