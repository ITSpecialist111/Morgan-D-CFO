// ---------------------------------------------------------------------------
// Dynamic P&L message generator — simulates real-time financial monitoring
// Each call produces a unique message as if Morgan is watching the numbers live
// ---------------------------------------------------------------------------

interface PnlSnapshot {
  revenue: number;
  cogs: number;
  grossProfit: number;
  opex: number;
  ebitda: number;
  netIncome: number;
}

// Baseline figures (YTD in USD)
const BASELINE: PnlSnapshot = {
  revenue: 4_980_000,
  cogs: 1_960_000,
  grossProfit: 3_020_000,
  opex: 1_230_000,
  ebitda: 980_000,
  netIncome: 742_000,
};

// Running state — drifts throughout the session to feel realistic
let currentSnapshot: PnlSnapshot = { ...BASELINE };
let messageCount = 0;

function jitter(base: number, maxPct: number): number {
  const pct = (Math.random() * 2 - 1) * maxPct; // ±maxPct%
  return Math.round(base * (1 + pct / 100));
}

function usd(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toLocaleString()}`;
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function emoji(changePct: number, isExpense: boolean): string {
  // For expenses, going up is bad; for revenue, going up is good
  const effective = isExpense ? -changePct : changePct;
  if (effective > 2) return '🟢';
  if (effective > -2) return '🟡';
  return '🔴';
}

function evolveSnapshot(): { prev: PnlSnapshot; next: PnlSnapshot } {
  const prev = { ...currentSnapshot };
  currentSnapshot = {
    revenue: jitter(currentSnapshot.revenue, 1.5),
    cogs: jitter(currentSnapshot.cogs, 2.0),
    grossProfit: 0, // recalculated below
    opex: jitter(currentSnapshot.opex, 1.8),
    ebitda: 0,
    netIncome: 0,
  };
  currentSnapshot.grossProfit = currentSnapshot.revenue - currentSnapshot.cogs;
  currentSnapshot.ebitda = currentSnapshot.grossProfit - currentSnapshot.opex;
  currentSnapshot.netIncome = Math.round(currentSnapshot.ebitda * 0.76); // ~24% tax
  return { prev, next: { ...currentSnapshot } };
}

function changePct(prev: number, next: number): number {
  if (prev === 0) return 0;
  return ((next - prev) / Math.abs(prev)) * 100;
}

// ---------------------------------------------------------------------------
// Message templates — each produces a different style of update
// ---------------------------------------------------------------------------

type MessageGenerator = (prev: PnlSnapshot, next: PnlSnapshot) => string;

const TEMPLATES: MessageGenerator[] = [
  // 1. Quick P&L pulse
  (prev, next) => {
    const revChg = changePct(prev.revenue, next.revenue);
    const ebitdaChg = changePct(prev.ebitda, next.ebitda);
    return [
      `📊 **P&L Pulse** — ${new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`,
      ``,
      `**Revenue**: ${usd(next.revenue)} ${emoji(revChg, false)} (${pct(revChg)} since last check)`,
      `**EBITDA**: ${usd(next.ebitda)} ${emoji(ebitdaChg, false)} (${pct(ebitdaChg)})`,
      `**Gross Margin**: ${((next.grossProfit / next.revenue) * 100).toFixed(1)}%`,
      ``,
      `_Monitoring continues — next update in 25 min._`,
    ].join('\n');
  },

  // 2. Variance spotlight
  (prev, next) => {
    const cogsChg = changePct(prev.cogs, next.cogs);
    const opexChg = changePct(prev.opex, next.opex);
    const worst = Math.abs(cogsChg) > Math.abs(opexChg)
      ? { name: 'COGS', chg: cogsChg, val: next.cogs }
      : { name: 'OPEX', chg: opexChg, val: next.opex };
    return [
      `🔍 **Variance Spotlight**`,
      ``,
      `Biggest mover since last check: **${worst.name}** at ${usd(worst.val)} (${pct(worst.chg)}) ${emoji(worst.chg, true)}`,
      ``,
      `**COGS**: ${usd(next.cogs)} (${pct(cogsChg)}) ${emoji(cogsChg, true)}`,
      `**OPEX**: ${usd(next.opex)} (${pct(opexChg)}) ${emoji(opexChg, true)}`,
      ``,
      `I'm keeping an eye on these cost lines.`,
    ].join('\n');
  },

  // 3. Gross margin watch
  (prev, next) => {
    const prevGM = (prev.grossProfit / prev.revenue) * 100;
    const nextGM = (next.grossProfit / next.revenue) * 100;
    const gmDelta = nextGM - prevGM;
    const status = gmDelta > 0.3 ? 'improving' : gmDelta < -0.3 ? 'compressing' : 'stable';
    return [
      `📈 **Margin Watch**`,
      ``,
      `Gross margin is **${status}**: ${nextGM.toFixed(1)}% (was ${prevGM.toFixed(1)}%)`,
      ``,
      `**Revenue**: ${usd(next.revenue)}`,
      `**COGS**: ${usd(next.cogs)}`,
      `**Gross Profit**: ${usd(next.grossProfit)}`,
      ``,
      status === 'compressing'
        ? `⚠️ Margin compression detected — worth reviewing COGS drivers.`
        : `Looking healthy. I'll flag if this changes.`,
    ].join('\n');
  },

  // 4. Net income tracker
  (prev, next) => {
    const niChg = changePct(prev.netIncome, next.netIncome);
    return [
      `💰 **Net Income Update**`,
      ``,
      `**Net Income (YTD)**: ${usd(next.netIncome)} ${emoji(niChg, false)}`,
      `Change: ${pct(niChg)} since last check`,
      ``,
      `**EBITDA**: ${usd(next.ebitda)}`,
      `**Effective tax rate**: ~24%`,
      ``,
      `Bottom line is ${niChg > 0 ? 'trending up' : niChg < -1 ? 'under pressure' : 'holding steady'}. I'll keep watching.`,
    ].join('\n');
  },

  // 5. Anomaly alert (dramatic)
  (_prev, next) => {
    // Randomly pick a cost centre to flag
    const alerts = [
      { category: 'Marketing', amount: jitter(258_000, 8), budgeted: 220_000 },
      { category: 'Sales', amount: jitter(345_000, 6), budgeted: 310_000 },
      { category: 'OPEX', amount: jitter(next.opex, 3), budgeted: 750_000 },
    ];
    const alert = alerts[Math.floor(Math.random() * alerts.length)];
    const overPct = ((alert.amount - alert.budgeted) / alert.budgeted * 100);
    const severity = overPct > 15 ? '🔴 CRITICAL' : overPct > 8 ? '🟡 WARNING' : '🟢 WITHIN RANGE';
    return [
      `🚨 **Anomaly Detection Alert**`,
      ``,
      `**${alert.category}** spend flagged: ${usd(alert.amount)} vs ${usd(alert.budgeted)} budget`,
      `Variance: ${pct(overPct)} — **${severity}**`,
      ``,
      overPct > 10
        ? `I recommend reviewing ${alert.category} commitments before month-end close.`
        : `This is within tolerance but trending upward. Monitoring closely.`,
    ].join('\n');
  },

  // 6. Executive summary style
  (prev, next) => {
    const revChg = changePct(prev.revenue, next.revenue);
    const cogsChg = changePct(prev.cogs, next.cogs);
    const gmPct = ((next.grossProfit / next.revenue) * 100).toFixed(1);
    return [
      `📋 **Quick Brief for the CFO**`,
      ``,
      `Here's where we stand right now:`,
      `- **Revenue**: ${usd(next.revenue)} (${pct(revChg)}) ${emoji(revChg, false)}`,
      `- **COGS**: ${usd(next.cogs)} (${pct(cogsChg)}) ${emoji(cogsChg, true)}`,
      `- **Gross Margin**: ${gmPct}%`,
      `- **EBITDA**: ${usd(next.ebitda)}`,
      `- **Net Income**: ${usd(next.netIncome)}`,
      ``,
      `No action required right now — just keeping you in the loop.`,
    ].join('\n');
  },

  // 7. Cash flow focus
  (_prev, next) => {
    const cashOnHand = jitter(3_800_000, 4);
    const burnRate = Math.round(next.opex / 1);
    const runway = (cashOnHand / burnRate).toFixed(1);
    return [
      `🏦 **Cash Flow Check-in**`,
      ``,
      `**Cash on Hand**: ${usd(cashOnHand)}`,
      `**Monthly Burn Rate**: ${usd(burnRate)}`,
      `**Runway**: ~${runway} months`,
      ``,
      parseFloat(runway) < 15
        ? `⚠️ Runway is tightening — may want to review discretionary spend.`
        : `Runway looks comfortable. No immediate concerns.`,
    ].join('\n');
  },

  // 8. Revenue vs forecast
  (_prev, next) => {
    const forecast = jitter(5_200_000, 2);
    const gap = next.revenue - forecast;
    const gapPct = (gap / forecast) * 100;
    return [
      `🎯 **Revenue vs Forecast**`,
      ``,
      `**Actual (YTD)**: ${usd(next.revenue)}`,
      `**Forecast**: ${usd(forecast)}`,
      `**Gap**: ${usd(gap)} (${pct(gapPct)}) ${emoji(gapPct, false)}`,
      ``,
      gapPct < -3
        ? `We're tracking below forecast. Might need to accelerate pipeline conversion.`
        : gapPct > 2
        ? `Ahead of forecast — strong position going into month-end.`
        : `Tracking close to forecast. On plan.`,
    ].join('\n');
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generatePnlUpdate(): string {
  messageCount++;
  const { prev, next } = evolveSnapshot();

  // Rotate through templates, with some randomness
  const templateIndex = (messageCount + Math.floor(Math.random() * 3)) % TEMPLATES.length;
  return TEMPLATES[templateIndex](prev, next);
}

/** Reset state (useful for testing) */
export function resetPnlState(): void {
  currentSnapshot = { ...BASELINE };
  messageCount = 0;
}
