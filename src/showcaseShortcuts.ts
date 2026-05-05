import type { TurnContext } from '@microsoft/agents-hosting';
import { executeTool } from './tools';

export interface ShowcaseShortcutOptions {
  allowVoiceActions?: boolean;
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9&%$\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function money(value: number | undefined): string {
  return (Number(value) || 0).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function parseResult<T = any>(raw: string): T {
  return JSON.parse(raw) as T;
}

function extractDelaySeconds(text: string): number {
  const minutes = text.match(/(?:in|after|give me)?\s*(\d+)\s*(?:minute|minutes|min|mins)\b/);
  if (minutes) return Math.max(5, Math.min(3600, Number(minutes[1]) * 60));
  const seconds = text.match(/(?:in|after)?\s*(\d+)\s*(?:second|seconds|sec|secs)\b/);
  if (seconds) return Math.max(5, Math.min(3600, Number(seconds[1])));
  return 300;
}

function formatDelay(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? '' : 's'}`;
  return `${seconds} seconds`;
}

function formatLatestPnl(pnl: any): string {
  return [
    `Here is the latest P&L for ${pnl.period}.`,
    `**Revenue**: ${money(pnl.totals?.revenue)}`,
    `**Gross margin**: ${Number(pnl.totals?.grossMarginPct || 0).toFixed(1)}%`,
    `**EBITDA**: ${money(pnl.totals?.ebitda)} (${Number(pnl.totals?.ebitdaMarginPct || 0).toFixed(1)}%)`,
    `**Estimated tax**: ${money(pnl.totals?.estimatedTax)}`,
    `**Net income**: ${money(pnl.totals?.netIncome)} (${Number(pnl.totals?.netMarginPct || 0).toFixed(1)}%)`,
    '',
    ...(Array.isArray(pnl.commentary) ? pnl.commentary.slice(0, 3).map((item: string) => `- ${item}`) : []),
  ].join('\n');
}

function formatMicrosoftIQ(briefing: any): string {
  const workIQ = briefing.pillars?.workIQ || {};
  const foundryIQ = briefing.pillars?.foundryIQ || {};
  const fabricIQ = briefing.pillars?.fabricIQ || {};
  return [
    `**Microsoft IQ briefing**: ${briefing.headline}`,
    '',
    `**WorkIQ**: ${workIQ.meetingLoad ?? 0} finance meeting(s), ${workIQ.financeThreads ?? 0} finance thread(s), ${workIQ.pendingApprovals ?? 0} approval item(s).`,
    `**FabricIQ**: ${money(fabricIQ.metrics?.revenue)} revenue, ${fabricIQ.metrics?.grossMarginPct ?? 'n/a'}% gross margin, ${fabricIQ.metrics?.pipelineCoverage ?? 'n/a'}x pipeline coverage.`,
    `**FoundryIQ**: ${(foundryIQ.modelInsights || []).slice(0, 2).join(' ')}`,
    '',
    '**Autonomous actions**:',
    ...(briefing.autonomousActions || []).slice(0, 4).map((item: string) => `- ${item}`),
  ].join('\n');
}

function formatIdentity(identity: any): string {
  return [
    `Morgan's Microsoft 365 identity is **${identity.displayName}** (${identity.agentRole}).`,
    `**Mailbox UPN**: ${identity.mailboxUpn || 'not configured'}`,
    `**Meeting invite address**: ${identity.meetingInviteAddress || 'not configured'}`,
    `**Calendar owner**: ${identity.calendarOwner || 'not configured'}`,
    `**Agentic auth connection**: ${identity.authConnection}`,
  ].join('\n');
}

function formatWorkIQ(status: any): string {
  return [
    `Morgan WorkIQ MCP coverage: **${status.available ? 'available' : 'not available'}**.`,
    `**Servers discovered**: ${status.serverCount ?? 0}`,
    `**Tools discovered**: ${status.toolCount ?? 0}`,
    `**Matched Cassidy-parity pillars**: ${(status.cassidyParity?.matched || []).join(', ') || 'none'}`,
    `**Missing expected pillars**: ${(status.cassidyParity?.missing || []).join(', ') || 'none'}`,
    ...((status.notes || []).slice(0, 2).map((note: string) => `- ${note}`)),
  ].join('\n');
}

function formatEnterpriseReadiness(checks: any[]): string {
  const ready = checks.filter((check) => ['ready', 'configured'].includes(check.status));
  const hardening = checks.filter((check) => !['ready', 'configured'].includes(check.status));
  return [
    `Enterprise readiness: **${ready.length}/${checks.length} controls ready or configured**.`,
    '',
    '**Ready/configured evidence**:',
    ...ready.slice(0, 5).map((check) => `- ${check.area}: ${check.signal}`),
    '',
    '**Production hardening / partial items**:',
    ...hardening.slice(0, 4).map((check) => `- ${check.area}: ${check.signal}`),
  ].join('\n');
}

function formatWorkday(result: any): string {
  const records = Array.isArray(result.records) ? result.records : [];
  return [
    `Autonomous CFO workday completed for **${result.period || 'current period'}**.`,
    `**Headline**: ${result.headline || 'Morgan completed the autonomous workday loop.'}`,
    `**Records created**: ${records.length}`,
    `**Sub-agent handoffs**: ${Array.isArray(result.subAgentHandoffs) ? result.subAgentHandoffs.length : 0}`,
    ...records.slice(0, 4).map((record: any) => `- ${record.title || record.taskId || 'CFO task'}: ${record.status || 'recorded'}`),
  ].join('\n');
}

function recordTime(record: any): number {
  const time = Date.parse(record?.startedAt || record?.completedAt || '');
  return Number.isFinite(time) ? time : 0;
}

function latestWorkdayBatch(completed: any[], blockedOrFailed: any[]): { completed: any[]; blockedOrFailed: any[] } | null {
  const latestAuditIndex = completed.map((record) => record?.taskId).lastIndexOf('working-day-audit');
  if (latestAuditIndex < 0) return null;

  const previousAuditIndex = completed.slice(0, latestAuditIndex).map((record) => record?.taskId).lastIndexOf('working-day-audit');
  const batch = completed.slice(previousAuditIndex + 1, latestAuditIndex + 1);
  if (!batch.length) return null;

  const startedAt = Math.min(...batch.map(recordTime).filter(Boolean));
  const completedAt = Math.max(...batch.map(recordTime).filter(Boolean));
  const relatedBlockedOrFailed = blockedOrFailed.filter((record) => {
    const time = recordTime(record);
    return startedAt && completedAt && time >= startedAt && time <= completedAt;
  });

  return { completed: batch, blockedOrFailed: relatedBlockedOrFailed };
}

function formatEndOfDay(report: any): string {
  const completed = Array.isArray(report.completed) ? report.completed : Array.isArray(report.completedTasks) ? report.completedTasks : [];
  const blocked = Array.isArray(report.blocked) ? report.blocked : Array.isArray(report.blockedTasks) ? report.blockedTasks : [];
  const failed = Array.isArray(report.failed) ? report.failed : Array.isArray(report.failedTasks) ? report.failedTasks : [];
  const blockedOrFailed = [...blocked, ...failed];
  const latestBatch = latestWorkdayBatch(completed, blockedOrFailed);
  const next = Array.isArray(report.nextDayPriorities)
    ? report.nextDayPriorities
    : Array.isArray(report.nextWorkingDayPriorities)
      ? report.nextWorkingDayPriorities
      : [];
  const leadItems = latestBatch?.completed.length ? latestBatch.completed : completed;
  return [
    `End-of-day CFO report for **${report.date || 'today'}**.`,
    latestBatch
      ? `**Latest autonomous workday**: ${latestBatch.completed.length} completed, ${latestBatch.blockedOrFailed.length} blocked/failed.`
      : `**Completed**: ${completed.length}`,
    `**Today's Mission Control ledger**: ${completed.length} completed, ${blockedOrFailed.length} blocked/failed.`,
    `**Next-day priorities**: ${next.length}`,
    ...leadItems.slice(0, 4).map((item: any) => `- ${item.title || item.taskId || String(item)}`),
    ...next.slice(0, 3).map((item: string) => `- Next: ${item}`),
  ].join('\n');
}

function formatEscalation(board: any): string {
  const columns = board.columns || {};
  const blocked = Array.isArray(columns.blocked) ? columns.blocked : [];
  const escalated = Array.isArray(columns.escalated) ? columns.escalated : [];
  const candidates = [...escalated, ...blocked].slice(0, 4);
  return [
    `I would escalate **${candidates.length || 1} item(s)** right now.`,
    `**Next best action**: ${board.nextBestAction || 'Review blocked finance work and assign a human owner.'}`,
    ...candidates.map((item: any) => `- ${item.title || item.taskId || 'Escalation item'}: ${item.blocker || item.reason || item.status || 'needs human review'}`),
  ].join('\n');
}

export async function tryHandleShowcaseShortcut(
  inputText: string,
  context?: TurnContext,
  options: ShowcaseShortcutOptions = {},
): Promise<string | null> {
  const text = normalize(inputText);
  if (!text) return null;

  if (/\b(email address|mailbox|meeting invite|invite morgan|morgan.*email)\b/.test(text)) {
    return formatIdentity(parseResult(await executeTool('getMorganIdentity', {}, context)));
  }

  if (/\b(microsoft iq|workiq.*fabriciq|fabriciq.*foundryiq|foundryiq.*fabriciq)\b/.test(text)) {
    return formatMicrosoftIQ(parseResult(await executeTool('synthesizeMicrosoftIQBriefing', {
      audience: 'CFO, executive operators, and Dragon Den judges',
      focus: 'Digital CFO autonomous worker demo',
    }, context)));
  }

  if (/\b(workiq|mcp coverage|mcp tools|cassidy parity|microsoft 365 servers)\b/.test(text)) {
    return formatWorkIQ(parseResult(await executeTool('getWorkIQStatus', {}, context)));
  }

  if (/\b(p&l|pnl|profit and loss|income statement|bottom line|business tracking financially|latest p l)\b/.test(text)) {
    return formatLatestPnl(parseResult(await executeTool('getLatestPnL', {}, context)));
  }

  if (/\b(enterprise readiness|prove.*ready|prove.*readiness|production ready|governance evidence)\b/.test(text)) {
    return formatEnterpriseReadiness(parseResult(await executeTool('getEnterpriseReadiness', {}, context)));
  }

  if (/\b(run autonomous|autonomous cfo workday|run.*workday)\b/.test(text)) {
    return formatWorkday(parseResult(await executeTool('runAutonomousCfoWorkday', {}, context)));
  }

  if (/\b(end of day|end-of-day|day end|day-end)\b/.test(text)) {
    return formatEndOfDay(parseResult(await executeTool('getEndOfDayReport', {}, context)));
  }

  if (/\b(escalate|escalation|to whom)\b/.test(text)) {
    return formatEscalation(parseResult(await executeTool('getAutonomousKanbanBoard', {}, context)));
  }

  if (/\b(next quarter|differently next quarter|cfo do differently)\b/.test(text)) {
    const pnl = parseResult(await executeTool('getLatestPnL', {}, context));
    const briefing = parseResult(await executeTool('synthesizeMicrosoftIQBriefing', {
      audience: 'CFO and executive operators',
      focus: 'next-quarter CFO operating decisions',
    }, context));
    return [
      formatLatestPnl(pnl),
      '',
      '**Next-quarter recommendation**:',
      '- Protect gross margin by reviewing COGS drivers before the next close cycle.',
      '- Tighten OPEX, Sales, and Marketing pacing where variance signals are above threshold.',
      `- Use Microsoft IQ evidence before committing board actions: ${briefing.headline}`,
    ].join('\n');
  }

  if (options.allowVoiceActions && /\b(call|ring)\b.*\b(back|later|minute|minutes|second|seconds)\b/.test(text)) {
    const delaySeconds = extractDelaySeconds(text);
    const result = parseResult(await executeTool('scheduleAutonomousCallback', {
      delaySeconds,
      reason: 'walk through the priority finance points after the requested delay',
      requested_by: 'Morgan',
      target_display_name: 'CFO/operator',
    }, context));
    if (!result.success) return `I could not schedule the callback: ${result.error || 'unknown error'}.`;
    return `I will call you back in ${formatDelay(delaySeconds)} to walk through the priority finance points.`;
  }

  if (options.allowVoiceActions && /\b(call me|ring me|phone me)\b/.test(text)) {
    const result = parseResult(await executeTool('initiateTeamsCallToCfo', {
      reason: 'priority finance points requested by the CFO/operator',
      requested_by: 'Morgan',
      instructions: 'You are Morgan, the Digital CFO. Greet the user, give the headline priority finance points, ask for any human-in-the-loop decision needed, and keep it concise.',
    }, context));
    if (!result.success) return `I could not place the Teams call: ${result.error || 'unknown error'}.`;
    return `I am ringing you now with the priority finance points. Call connection: ${result.callConnectionId || 'started'}.`;
  }

  return null;
}