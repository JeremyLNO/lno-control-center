// Everything known about one round trip, assembled in one place.
//
// The point of this module is to be the single answer to "what actually happened on this
// trade". Today that answer is scattered: the entry/exit live in `trades`, the executions in
// `fills`, the funding and commission in `income_events`, the intent in `strategies`, and the
// alerts that fired during it in two other tables. Auditing a trade meant joining all of that
// by hand.
//
// MAE/MFE are the exception: they cannot be looked up anywhere, because no account endpoint
// reports how far a position ran against you between entry and exit. They are reconstructed
// from public klines and cached on the row, so a trade is only ever priced once.
import { query } from './db.js';
import { getKlines } from './binance.js';

export function parseTradeKey(key) {
  // "binance:BTCUSDT:12345" — exchange and symbol never contain a colon, and the id is the
  // last segment, so splitting from the right is unambiguous.
  const parts = String(key || '').split(':');
  if (parts.length < 3) return null;
  const openTradeId = Number(parts.pop());
  const exchange = parts.shift();
  const symbol = parts.join(':');
  if (!exchange || !symbol || !Number.isFinite(openTradeId)) return null;
  return { exchange, symbol, openTradeId };
}

// Candle size that keeps a trade inside one klines page (500 candles) while staying as fine
// as the duration allows: a 20-minute scalp deserves 1m resolution, a 3-day swing does not
// need it and could not fit it anyway.
function intervalFor(durationS) {
  const d = durationS || 3600;
  for (const [maxS, iv] of [[1800, '1m'], [7200, '5m'], [28800, '15m'], [172800, '1h'], [1209600, '4h']]) {
    if (d <= maxS) return iv;
  }
  return '1d';
}

// Worst and best unrealised excursion during the trade, in currency.
//
// A trade that ended +50 after being -400 underwater is a different trade from one that went
// straight to +50, and only MAE tells them apart. Computed from the extremes the price
// actually reached between entry and exit — a rough measure, since a candle's high and low
// have no ordering within the candle, but the magnitude is what matters here.
export function excursions({ direction, entryPrice, qty, candles }) {
  if (!candles || !candles.length || !entryPrice || !qty) return null;
  const high = Math.max(...candles.map(c => c.high));
  const low = Math.min(...candles.map(c => c.low));
  const long = direction === 'LONG';
  const mfePrice = long ? high : low;
  const maePrice = long ? low : high;
  // Clamped at zero by definition: an ADVERSE excursion cannot be favourable and vice versa.
  // A position that never traded below its entry has an MAE of 0 — "it was never down" —
  // not a positive number, which would read as a loss of that size.
  return {
    mfe: Math.max(0, (long ? mfePrice - entryPrice : entryPrice - mfePrice) * qty),
    mae: Math.min(0, (long ? maePrice - entryPrice : entryPrice - maePrice) * qty),
    mfePrice, maePrice,
  };
}

// Price series + excursions for a closed trade, cached on the row after the first call.
// Best-effort: the exchange being unreachable must degrade this page to "no chart", never
// fail the whole request.
async function priceContext(t) {
  if (!t.closed_at) return { candles: [], excursion: null, interval: null };
  const startTime = new Date(t.opened_at).getTime();
  const endTime = new Date(t.closed_at).getTime();
  const interval = intervalFor(t.duration_s);
  let candles = [];
  try {
    // Pad the window slightly so the entry and exit candles are both fully inside it.
    candles = await getKlines({ symbol: t.symbol, interval, startTime: startTime - 60000, endTime: endTime + 60000 });
  } catch (e) { return { candles: [], excursion: null, interval, error: String(e.message || e) }; }

  const ex = excursions({ direction: t.direction, entryPrice: Number(t.entry_price), qty: Number(t.qty), candles });
  if (ex && (t.mae == null || t.mfe == null)) {
    try {
      await query('UPDATE trades SET mae=$3, mfe=$4 WHERE exchange=$1 AND symbol=$2 AND open_trade_id=$5',
        [t.exchange, t.symbol, ex.mae, ex.mfe, t.open_trade_id]);
    } catch (e) { /* caching is an optimisation, not a requirement */ }
  }
  return { candles, excursion: ex, interval };
}

// Metrics this page would show if the data existed. Declared per-page rather than assumed
// absent, so a reader can tell "not measured" from "measured as zero".
export const TRADE_UNAVAILABLE = {
  signals: 'the strategy does not report its entry/exit signals to this system',
  orders: 'only executed fills are synced — placed, amended and cancelled orders are not',
  slippage: 'requires the intended price; only the executed price is known',
  latency: 'order round-trip time is not measured (only exchange sync latency is)',
  r_multiple: 'requires the risk per trade — no stop-loss distance is recorded',
  logs: 'the bots do not ship execution logs to this system',
};

export async function getTradeDetail(key) {
  const parsed = parseTradeKey(key);
  if (!parsed) return null;
  const { exchange, symbol, openTradeId } = parsed;

  const { rows } = await query(
    'SELECT * FROM trades WHERE exchange=$1 AND symbol=$2 AND open_trade_id=$3', [exchange, symbol, openTradeId]
  );
  const t = rows[0];
  if (!t) return null;

  const num = (v) => (v == null ? null : Number(v));
  const openedAt = t.opened_at, closedAt = t.closed_at;

  // The executions that make up this round trip. Bounded by the round trip's own first and
  // last fill ids rather than by time: a flip shares one fill between two trades, and the id
  // range is what says which side of it we are on.
  const { rows: fills } = await query(
    `SELECT trade_id, side, qty, price, realized_pnl, commission, occurred_at FROM fills
     WHERE exchange=$1 AND symbol=$2 AND trade_id >= $3 AND trade_id <= COALESCE($4, $3 + 100000)
     ORDER BY trade_id ASC`,
    [exchange, symbol, openTradeId, t.close_trade_id]
  );

  const { rows: income } = await query(
    `SELECT income_type, income, occurred_at FROM income_events
     WHERE symbol=$1 AND occurred_at >= $2 AND occurred_at <= COALESCE($3, now()) ORDER BY occurred_at ASC`,
    [symbol, openedAt, closedAt]
  );

  // The declared intent behind this trade: the strategy, and the exact version that was live
  // when it opened. This is what makes the page auditable rather than merely informative.
  let strategy = null, version = null;
  if (t.strategy_id) {
    strategy = (await query('SELECT * FROM strategies WHERE id=$1', [t.strategy_id])).rows[0] || null;
    if (t.strategy_version_id) {
      version = (await query('SELECT * FROM strategy_versions WHERE id=$1', [t.strategy_version_id])).rows[0] || null;
    }
  }

  // Anything that fired while this trade was open — the context that explains an odd result.
  const { rows: anomalies } = await query(
    `SELECT code, scope, severity, summary, detected_at FROM anomalies
     WHERE detected_at >= $1 AND detected_at <= COALESCE($2, now())
       AND (scope = 'portfolio' OR scope LIKE $3) ORDER BY detected_at DESC`,
    [openedAt, closedAt, `%${symbol}%`]
  );
  const { rows: incidents } = await query(
    `SELECT type, code, summary, created_at, acked_at FROM alerts
     WHERE created_at >= $1 AND created_at <= COALESCE($2, now()) ORDER BY created_at DESC LIMIT 20`,
    [openedAt, closedAt]
  );

  const price = await priceContext(t);

  return {
    id: `${exchange}:${symbol}:${openTradeId}`,
    exchange, symbol,
    direction: t.direction, qty: num(t.qty),
    entryPrice: num(t.entry_price), exitPrice: num(t.exit_price),
    grossPnl: num(t.gross_pnl), commission: num(t.commission), funding: num(t.funding), netPnl: num(t.net_pnl),
    openedAt, closedAt, durationS: num(t.duration_s), fillCount: t.fill_count,
    leverage: num(t.leverage), fundId: t.fund_id || null,
    notional: num(t.entry_price) != null ? num(t.entry_price) * num(t.qty) : null,
    // Prefer the freshly computed excursion; fall back to whatever was cached on the row if
    // the exchange was unreachable this time.
    mae: price.excursion ? price.excursion.mae : num(t.mae),
    mfe: price.excursion ? price.excursion.mfe : num(t.mfe),
    maePrice: price.excursion?.maePrice ?? null,
    mfePrice: price.excursion?.mfePrice ?? null,
    candles: price.candles,
    candleInterval: price.interval,
    priceError: price.error || null,
    fills: fills.map(f => ({
      tradeId: Number(f.trade_id), side: f.side, qty: Number(f.qty), price: Number(f.price),
      realizedPnl: Number(f.realized_pnl), commission: Number(f.commission), occurredAt: f.occurred_at,
    })),
    income: income.map(i => ({ type: i.income_type, amount: Number(i.income), occurredAt: i.occurred_at })),
    strategy: strategy && {
      id: strategy.id, name: strategy.name, objective: strategy.objective || '',
      entryRules: strategy.entry_rules || '', exitRules: strategy.exit_rules || '',
      riskLimits: strategy.risk_limits || {}, params: strategy.params || {},
      allowedSymbols: strategy.allowed_symbols || [], allowedTimeframes: strategy.allowed_timeframes || [],
    },
    version: version && { id: Number(version.id), label: version.label, deployedAt: version.deployed_at, changes: version.changes || '', params: version.params || {} },
    anomalies: anomalies.map(a => ({ code: a.code, scope: a.scope, severity: a.severity, summary: a.summary, detectedAt: a.detected_at })),
    incidents: incidents.map(i => ({ type: i.type, code: i.code, summary: i.summary, createdAt: i.created_at, resolved: !!i.acked_at })),
    unavailable: TRADE_UNAVAILABLE,
  };
}
