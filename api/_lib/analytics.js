// Single source of truth for KPI definitions and analysis dimensions.
//
// Every page that shows a win rate, a profit factor or a drawdown reads it from here, so the
// same trade set can never produce two different numbers on two different screens. Adding a
// KPI or a dimension means editing this file only — the API and the UI both enumerate what
// this module exports rather than hard-coding their own lists.
//
// KPIs are computed in JS over the filtered trade rows rather than in SQL. The dataset is one
// trading desk's own history (thousands of rows, not millions), and keeping the maths in one
// place beats spreading equivalent-but-subtly-different aggregate expressions across every
// query that needs them.
import { query } from './db.js';

// ---------------------------------------------------------------------------------------
// Dimensions — the axes a trade set can be sliced by.
//
// `of(t)` returns the bucket key for a trade; `label` is an i18n key the UI resolves. A
// dimension whose value isn't instrumented yet (see UNAVAILABLE below) still appears, so the
// UI can show it as explicitly missing rather than silently omitting it.
// ---------------------------------------------------------------------------------------
const DUR_BUCKETS = [
  [300, '<5m'], [1800, '5-30m'], [7200, '30m-2h'], [28800, '2-8h'],
  [86400, '8-24h'], [259200, '1-3d'],
];
function durationBucket(s) {
  if (s == null) return 'open';
  for (const [max, label] of DUR_BUCKETS) if (s < max) return label;
  return '>3d';
}
const LEV_BUCKETS = [[1, '≤1x'], [3, '2-3x'], [5, '4-5x'], [10, '6-10x'], [20, '11-20x']];
function leverageBucket(l) {
  if (l == null || !(l > 0)) return 'unknown';
  for (const [max, label] of LEV_BUCKETS) if (l <= max) return label;
  return '>20x';
}
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// `order` is the dimension's canonical sequence. Buckets like weekdays, duration bands and
// leverage bands are ORDINAL: sorting them by value (or alphabetically) makes a matrix
// unreadable — "fri, mon, sat, sun, thu, tue, wed" tells you nothing about a weekly pattern.
// Dimensions without a natural order (assets, funds) omit it and stay sorted by PnL.
export const DIMENSIONS = {
  symbol:    { label: 'dim.symbol',    of: t => t.symbol },
  direction: { label: 'dim.direction', of: t => t.direction, order: ['LONG', 'SHORT'] },
  fund:      { label: 'dim.fund',      of: t => t.fund_id || 'unassigned' },
  exchange:  { label: 'dim.exchange',  of: t => t.exchange },
  // Week starts Monday: the trading week's shape is what's being read here, and a
  // Sunday-first axis splits the weekend across both ends of the grid.
  dow:       { label: 'dim.dow',       of: t => DOW[t.entry_dow] || 'unknown', order: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
  hour:      { label: 'dim.hour',      of: t => String(t.entry_hour).padStart(2, '0') + 'h',
               order: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + 'h') },
  duration:  { label: 'dim.duration',  of: t => durationBucket(t.duration_s),
               order: [...DUR_BUCKETS.map(b => b[1]), '>3d', 'open'] },
  leverage:  { label: 'dim.leverage',  of: t => leverageBucket(t.leverage),
               order: [...LEV_BUCKETS.map(b => b[1]), '>20x', 'unknown'] },
  // Populated by the strategy playbook (each trade is attributed to the version that was live
  // when it opened) and by the market-regime classifier. Both fall back to a distinct bucket
  // rather than dropping the trade, so totals always reconcile with the unsliced set.
  version:   { label: 'dim.version',   of: t => t.version_label || 'unversioned' },
  regime:    { label: 'dim.regime',    of: t => t.regime || 'unclassified' },
};

// Metrics the spec asks for that no data source in this system currently feeds. They are
// declared here — rather than quietly omitted — so the UI can render them as "not
// instrumented" instead of showing a plausible-looking zero. See docs/DATA-GAPS.md.
export const UNAVAILABLE = {
  slippage:  'no signal/intended price is recorded — only executed fill prices',
  mae_mfe:   'requires intra-trade price history (klines) — not yet backfilled',
  latency:   'only exchange sync latency is measured, not order round-trip latency',
  backtest:  'no backtest results are imported to compare live behaviour against',
};

// ---------------------------------------------------------------------------------------
// Filters — one contract shared by every feature (analysis, calendar, playbook, report).
// ---------------------------------------------------------------------------------------
const LIST_FILTERS = { symbol: 'symbol', direction: 'direction', exchange: 'exchange', fund: 'fund_id' };

// Columns are emitted already qualified with the `trades` alias used by fetchTrades below.
// The query joins strategy_versions, so a bare `symbol` or `label` would be ambiguous — and
// prefixing them afterwards with a regex over the finished SQL is the kind of thing that
// works until a filter value happens to contain a column name.
const T = 't.';

export function buildWhere(f = {}) {
  const w = ['1=1'];
  const p = [];
  const add = (sql, val) => { p.push(val); w.push(T + sql.replace('?', `$${p.length}`)); };

  // `from`/`to` filter on when a trade CLOSED — a trade belongs to the period in which its
  // result was realised, which is what every PnL figure in the app is keyed on. Still-open
  // trades have no result yet and are excluded from any bounded window.
  if (f.from) add('closed_at >= ?', f.from);
  if (f.to) add('closed_at < (?::date + interval \'1 day\')', f.to);
  if (!f.includeOpen) w.push(`${T}closed_at IS NOT NULL`);

  for (const [key, col] of Object.entries(LIST_FILTERS)) {
    const v = f[key];
    if (Array.isArray(v) && v.length) { p.push(v); w.push(`${T}${col} = ANY($${p.length})`); }
  }
  if (f.minDuration != null) add('duration_s >= ?', Number(f.minDuration));
  if (f.maxDuration != null) add('duration_s <= ?', Number(f.maxDuration));
  if (f.minLeverage != null) add('leverage >= ?', Number(f.minLeverage));
  if (f.maxLeverage != null) add('leverage <= ?', Number(f.maxLeverage));
  if (Array.isArray(f.hour) && f.hour.length) { p.push(f.hour.map(Number)); w.push(`${T}entry_hour = ANY($${p.length})`); }
  if (Array.isArray(f.dow) && f.dow.length) { p.push(f.dow.map(Number)); w.push(`${T}entry_dow = ANY($${p.length})`); }
  if (Array.isArray(f.strategy) && f.strategy.length) { p.push(f.strategy); w.push(`${T}strategy_id = ANY($${p.length})`); }

  return { sql: w.join(' AND '), params: p };
}

export async function fetchTrades(f = {}) {
  const { sql, params } = buildWhere(f);
  // The version LABEL (not just its id) travels with the row so the 'version' dimension
  // groups on something a human recognises without a second lookup per bucket.
  const { rows } = await query(`SELECT t.*, v.label AS version_label FROM trades t
     LEFT JOIN strategy_versions v ON v.id = t.strategy_version_id
     WHERE ${sql}
     ORDER BY COALESCE(t.closed_at, t.opened_at) ASC`, params);
  return rows.map(r => ({
    ...r,
    net_pnl: Number(r.net_pnl), gross_pnl: Number(r.gross_pnl),
    commission: Number(r.commission), funding: Number(r.funding),
    qty: Number(r.qty), leverage: r.leverage == null ? null : Number(r.leverage),
    duration_s: r.duration_s == null ? null : Number(r.duration_s),
  }));
}

// ---------------------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------------------
const sum = (a) => a.reduce((s, x) => s + x, 0);

// Max drawdown of the cumulative NET PnL curve built from the trades themselves — peak-to-
// trough of realised results, in currency. This is deliberately NOT the account-equity
// drawdown shown on the dashboard (which marks open positions to market and includes deposits
// and withdrawals); slicing by bot or by weekday has no meaningful equity curve of its own.
function maxDrawdown(sortedNet) {
  let cum = 0, peak = 0, worst = 0;
  for (const n of sortedNet) {
    cum += n;
    if (cum > peak) peak = cum;
    if (peak - cum > worst) worst = peak - cum;
  }
  return -worst;
}

export function computeKpis(trades) {
  const closed = trades.filter(t => t.closed_at);
  const net = closed.map(t => t.net_pnl);
  const wins = net.filter(n => n > 0);
  const losses = net.filter(n => n < 0);
  const grossProfit = sum(wins);
  const grossLoss = Math.abs(sum(losses));
  const durations = closed.map(t => t.duration_s).filter(d => d != null);

  // Span of the trade set in days, for a frequency that means "per calendar day traded"
  // rather than "per row" — one day with 40 trades and thirty quiet days is a very different
  // regime from a steady 1.3/day, and the average alone hides it.
  const times = closed.map(t => new Date(t.closed_at).getTime());
  const spanDays = times.length > 1 ? Math.max(1, (Math.max(...times) - Math.min(...times)) / 86400000) : (times.length ? 1 : 0);

  return {
    trades: closed.length,
    openTrades: trades.length - closed.length,
    netPnl: sum(net),
    grossPnl: sum(closed.map(t => t.gross_pnl)),
    fees: sum(closed.map(t => t.commission)),
    funding: sum(closed.map(t => t.funding)),
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    // Undefined rather than infinite when a set has no losing trade at all: reporting "∞"
    // as a number would let it win any sort or comparison against real ratios.
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    expectancy: closed.length ? sum(net) / closed.length : null,
    avgWin: wins.length ? grossProfit / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null,
    bestTrade: net.length ? Math.max(...net) : null,
    worstTrade: net.length ? Math.min(...net) : null,
    maxDrawdown: maxDrawdown(net),
    avgDurationS: durations.length ? sum(durations) / durations.length : null,
    tradesPerDay: spanDays ? closed.length / spanDays : null,
  };
}

// ---------------------------------------------------------------------------------------
// Calendar bucketing — the same KPI block, keyed by calendar period instead of by dimension.
// ---------------------------------------------------------------------------------------
// ISO week: weeks start Monday and belong to the year containing their Thursday. Worth doing
// properly rather than dividing the day-of-year by 7 — the naive version disagrees with every
// calendar the desk actually uses during the first and last week of a year.
function isoWeekKey(d) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = x.getUTCDay() || 7;              // Sunday = 7, so Monday = 1
  x.setUTCDate(x.getUTCDate() + 4 - day);      // move to this week's Thursday
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((x - yearStart) / 86400000 + 1) / 7);
  return `${x.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export const GRANULARITIES = ['day', 'week', 'month', 'year'];

const periodKey = {
  day: (d) => d.toISOString().slice(0, 10),
  week: isoWeekKey,
  month: (d) => d.toISOString().slice(0, 7),
  year: (d) => String(d.getUTCFullYear()),
};

// A trade belongs to the period in which it CLOSED — that is when its result exists. Keys are
// UTC throughout, matching how every other date in this system is stored and compared; a
// local-time calendar would shift trades across midnight boundaries depending on who is
// looking.
export function bucketByPeriod(trades, granularity = 'day') {
  const keyOf = periodKey[granularity];
  if (!keyOf) throw new Error(`unknown granularity: ${granularity}`);
  const buckets = new Map();
  for (const t of trades) {
    if (!t.closed_at) continue;
    const k = keyOf(new Date(t.closed_at));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  const rows = [...buckets.entries()]
    .map(([key, ts]) => ({ key, ...computeKpis(ts) }))
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  return { granularity, rows, total: computeKpis(trades) };
}

// Group a trade set along one dimension and compute the full KPI block per bucket.
// `total` is the same KPI block over the unsliced set, so the UI can show each bucket's
// contribution without recomputing (and without the two disagreeing).
export function groupBy(trades, dim) {
  const d = DIMENSIONS[dim];
  if (!d) throw new Error(`unknown dimension: ${dim}`);
  const buckets = new Map();
  for (const t of trades) {
    const k = String(d.of(t) ?? 'unknown');
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  const rows = [...buckets.entries()].map(([key, ts]) => ({ key, ...computeKpis(ts) }));
  // Ordinal dimensions keep their canonical sequence; the rest rank by contribution.
  if (d.order) rows.sort((a, b) => d.order.indexOf(a.key) - d.order.indexOf(b.key));
  else rows.sort((a, b) => b.netPnl - a.netPnl);
  return { dimension: dim, rows, total: computeKpis(trades) };
}
