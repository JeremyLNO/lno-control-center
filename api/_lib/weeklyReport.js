// Weekly review — portfolio-wide and per bot.
//
// The daily report answers "what happened yesterday". This one answers the question a desk
// actually asks on a Monday: is the last week normal, and what needs a human to look at it?
// That means three things the daily report cannot give:
//
//   1. Comparison. A week's PnL means nothing alone — it is read against the week before and
//      against the recent average, which is what separates a bad week from a decline.
//   2. Attribution. Which bots carried the result, and which single trades did the damage.
//   3. Escalation. Anomalies opened, technical incidents, and the specific items that a
//      person has to decide on. Stated as observations with their numbers, never as advice.
import { query } from './db.js';
import { computeKpis } from './analytics.js';
import { evaluateExpectations } from './strategies.js';

const WEEK_MS = 7 * 86400000;
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

async function tradesBetween(from, to) {
  const { rows } = await query(
    `SELECT exchange, symbol, direction, net_pnl, gross_pnl, commission, funding, closed_at,
            opened_at, duration_s, strategy_id, qty, entry_price, exit_price, open_trade_id
     FROM trades WHERE closed_at >= $1 AND closed_at < $2 ORDER BY closed_at ASC`, [from, to]
  );
  return rows.map(t => ({
    ...t, net_pnl: Number(t.net_pnl), gross_pnl: Number(t.gross_pnl),
    commission: Number(t.commission), funding: Number(t.funding),
    duration_s: t.duration_s == null ? null : Number(t.duration_s),
  }));
}

// Percentage change guarded against a zero baseline: "up 100% from nothing" is not a fact,
// so it is reported as null and rendered as "no comparable week" rather than as a number.
const changePct = (cur, prev) => (prev && Math.abs(prev) > 1e-9 ? ((cur - prev) / Math.abs(prev)) * 100 : null);

export async function buildWeeklyReview({ now = Date.now() } = {}) {
  const end = new Date(now);
  const start = new Date(now - WEEK_MS);
  const prevStart = new Date(now - 2 * WEEK_MS);
  // Four weeks BEFORE the previous one, so the average is a genuine baseline and does not
  // include either of the two weeks being compared.
  const baseStart = new Date(now - 6 * WEEK_MS);

  const [cur, prev, base] = await Promise.all([
    tradesBetween(start, end),
    tradesBetween(prevStart, start),
    tradesBetween(baseStart, prevStart),
  ]);

  const k = computeKpis(cur), kPrev = computeKpis(prev), kBase = computeKpis(base);
  // The baseline covers four weeks; divide so it compares like-for-like against one.
  const baseWeekly = { netPnl: kBase.netPnl / 4, trades: kBase.trades / 4 };

  // Per bot, current week against the previous one. Bots that traded in EITHER week are
  // listed: one that stopped entirely is exactly what this report should surface.
  const ids = [...new Set([...cur, ...prev].map(t => `${t.exchange}:${t.symbol}`))];
  const bots = ids.map(id => {
    const mine = (arr) => arr.filter(t => `${t.exchange}:${t.symbol}` === id);
    const a = computeKpis(mine(cur)), b = computeKpis(mine(prev));
    return {
      id, symbol: id.split(':')[1],
      trades: a.trades, netPnl: r2(a.netPnl), winRate: r2(a.winRate),
      profitFactor: r2(a.profitFactor), fees: r2(a.fees), funding: r2(a.funding),
      prevNetPnl: r2(b.netPnl), prevTrades: b.trades, changePct: r2(changePct(a.netPnl, b.netPnl)),
    };
  }).sort((x, y) => y.netPnl - x.netPnl);

  // Individual trades that moved the week. Reported as trades, not as a total, because a
  // single -400 is a different problem from forty -10s.
  const worst = [...cur].sort((a, b) => a.net_pnl - b.net_pnl).slice(0, 5)
    .filter(t => t.net_pnl < 0)
    .map(t => ({ symbol: t.symbol, direction: t.direction, netPnl: r2(t.net_pnl), closedAt: t.closed_at, durationS: t.duration_s }));

  const { rows: anomalyRows } = await query(
    `SELECT code, scope, severity, summary, evidence, detected_at, acked_at, resolved_at
     FROM anomalies WHERE detected_at >= $1 ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, detected_at DESC`, [start]
  );
  const { rows: incidentRows } = await query(
    `SELECT code, summary, created_at, acked_at FROM alerts
     WHERE type='api_error' AND created_at >= $1 ORDER BY created_at DESC`, [start]
  );

  // Items a person has to decide on. Every entry is an observation with its own numbers —
  // never a recommendation, because nothing here knows the desk's intent.
  const review = [];
  for (const a of anomalyRows) {
    if (a.severity === 'critical' && !a.resolved_at) {
      review.push({ kind: 'critical_anomaly', scope: a.scope, detail: a.summary, code: a.code });
    }
  }
  const { rows: strategies } = await query('SELECT * FROM strategies');
  for (const s of strategies) {
    const mine = cur.filter(t => t.strategy_id === s.id);
    if (!mine.length) continue;
    const missed = evaluateExpectations(s.expected_kpis || {}, computeKpis(mine)).filter(e => e.status === 'missed');
    if (missed.length) {
      review.push({ kind: 'expectation_missed', scope: `strategy:${s.id}`, detail: s.name,
        metrics: missed.map(m => ({ metric: m.key, target: m.target, actual: r2(m.value) })) });
    }
  }
  // A bot trading without a declared strategy is a governance gap, not a performance one:
  // there is nothing to judge its results against and no versioned record of what it does.
  const { rows: covered } = await query('SELECT bot_id FROM strategies WHERE bot_id IS NOT NULL');
  const coveredIds = new Set(covered.map(c => c.bot_id));
  for (const b of bots) {
    if (b.trades > 0 && !coveredIds.has(b.id)) {
      review.push({ kind: 'undocumented_bot', scope: `bot:${b.id}`, detail: b.symbol, trades: b.trades });
    }
  }
  // Costs eating the edge: only worth raising when the week was gross-positive, otherwise
  // the loss is the story and the fee share is noise on top of it.
  if (k.grossPnl > 0 && k.fees > 0 && k.fees / k.grossPnl > 0.4) {
    review.push({ kind: 'fee_drag', scope: 'portfolio', detail: null,
      feeShare: r2((k.fees / k.grossPnl) * 100), fees: r2(k.fees), gross: r2(k.grossPnl) });
  }

  return {
    weekLabel: `${start.toISOString().slice(0, 10)} → ${new Date(now - 1).toISOString().slice(0, 10)}`,
    from: start.toISOString(), to: end.toISOString(),
    portfolio: {
      trades: k.trades, netPnl: r2(k.netPnl), grossPnl: r2(k.grossPnl), fees: r2(k.fees), funding: r2(k.funding),
      winRate: r2(k.winRate), profitFactor: r2(k.profitFactor), expectancy: r2(k.expectancy),
      maxDrawdown: r2(k.maxDrawdown), tradesPerDay: r2(k.tradesPerDay),
      prevNetPnl: r2(kPrev.netPnl), prevTrades: kPrev.trades, prevWinRate: r2(kPrev.winRate),
      vsPrevPct: r2(changePct(k.netPnl, kPrev.netPnl)),
      avgWeeklyNetPnl: r2(baseWeekly.netPnl), vsAvgPct: r2(changePct(k.netPnl, baseWeekly.netPnl)),
    },
    bots,
    contributors: bots.filter(b => b.netPnl > 0).slice(0, 5),
    detractors: bots.filter(b => b.netPnl < 0).slice(-5).reverse(),
    significantLosses: worst,
    anomalies: anomalyRows.map(a => ({ code: a.code, scope: a.scope, severity: a.severity, summary: a.summary, detectedAt: a.detected_at, resolved: !!a.resolved_at })),
    incidents: incidentRows.map(i => ({ code: i.code, summary: i.summary, createdAt: i.created_at, resolved: !!i.acked_at })),
    review,
  };
}
