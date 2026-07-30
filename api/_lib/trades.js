// Round-trip trade reconstruction.
//
// The `fills` table holds individual executions (one row per Binance userTrades entry), and
// `bots` holds the CURRENT state of each (exchange, symbol) position — neither is a record of
// "one completed trade". Every analytics feature in the app (cross-dimension analysis, the PnL
// calendar, per-strategy attribution, anomaly detection, the position detail page) needs the
// round trip instead: the span from "position opened from flat" to "position back to flat",
// with its own entry/exit price, duration, direction and net PnL.
//
// This module walks the fill stream per symbol and materialises those round trips into
// `trades`. It is the single source of truth for what counts as "a trade" — every KPI in
// api/_lib/analytics.js is computed from these rows, so the numbers can't drift between pages.
import { query } from './db.js';

// Position sizes are floating-point sums of exchange-reported quantities, so "back to flat"
// is never exactly 0 — a 3-leg exit on a 0.001 BTC position can leave ~1e-17 behind. Anything
// under this is flat. Chosen well below the smallest lot size any venue quotes, so a real
// residual position can never be swallowed by it.
const FLAT_EPS = 1e-9;
const isFlat = (q) => Math.abs(q) < FLAT_EPS;

// Binance reports a fill's own realized PnL only on the legs that REDUCE a position; opening
// legs carry 0. Summing the column across the whole round trip therefore yields the trade's
// gross realized PnL without needing to re-derive it from entry/exit prices (which would drift
// on partial fills and on positions that were scaled into at several prices).
function emptyTrade(f, direction) {
  return {
    exchange: f.exchange, symbol: f.symbol,
    open_trade_id: Number(f.trade_id), close_trade_id: null,
    direction,
    peak_qty: 0,
    entry_qty: 0, entry_notional: 0,   // qty-weighted running sums -> average prices
    exit_qty: 0, exit_notional: 0,
    gross_pnl: 0, commission: 0,
    opened_at: f.occurred_at, closed_at: null,
    fill_count: 0,
  };
}

// Fold one (possibly partial) leg into the accumulator. `legQty` is always positive and is the
// portion of this fill that belongs to THIS trade — a fill that flips a position straight from
// long to short is split across two trades, so the caller passes each part separately.
function applyLeg(t, f, legQty, opening) {
  if (opening) { t.entry_qty += legQty; t.entry_notional += legQty * Number(f.price); }
  else { t.exit_qty += legQty; t.exit_notional += legQty * Number(f.price); }
  // Commission is charged on a fill's full quantity, so when a flip splits one fill across two
  // trades it is prorated — otherwise both sides would each book the whole cost.
  const share = Number(f.qty) ? legQty / Number(f.qty) : 1;
  t.commission += Number(f.commission || 0) * share;
  // Realized PnL is NOT prorated. The exchange reports it for the portion of the fill that
  // REDUCED an existing position; the portion that opens the opposite one realises nothing
  // yet. Splitting it across both would credit the new trade with profit it hasn't made and
  // understate the trade that actually earned it. A fill can only ever close one trade, so
  // attributing the whole amount to the closing leg is exact, not an approximation.
  if (!opening) t.gross_pnl += Number(f.realized_pnl || 0);
  t.fill_count += 1;
}

function closeTrade(t, f) {
  t.close_trade_id = Number(f.trade_id);
  t.closed_at = f.occurred_at;
  return t;
}

// Walk one symbol's fill stream into round trips. Pure — no DB access, so it's directly
// unit-testable against a hand-written fill sequence.
export function foldFills(fills) {
  const out = [];
  let pos = 0;        // signed position size: >0 long, <0 short
  let cur = null;

  for (const f of fills) {
    const qty = Number(f.qty);
    if (!(qty > 0)) continue;
    const signed = f.side === 'BUY' ? qty : -qty;

    if (isFlat(pos)) {
      cur = emptyTrade(f, signed > 0 ? 'LONG' : 'SHORT');
      applyLeg(cur, f, qty, true);
      pos = signed;
    } else if (Math.sign(signed) === Math.sign(pos)) {
      // same direction — scaling into the position
      applyLeg(cur, f, qty, true);
      pos += signed;
    } else {
      // opposite direction — reduces, closes, or flips
      const closing = Math.min(qty, Math.abs(pos));
      applyLeg(cur, f, closing, false);
      pos += Math.sign(signed) * closing;
      const remainder = qty - closing;
      if (isFlat(pos)) {
        out.push(closeTrade(cur, f));
        cur = null; pos = 0;
        if (remainder > FLAT_EPS) {
          // a flip: the same fill that closed the old trade opens the opposite one
          cur = emptyTrade(f, signed > 0 ? 'LONG' : 'SHORT');
          applyLeg(cur, f, remainder, true);
          pos = Math.sign(signed) * remainder;
        }
      }
    }
    if (cur) cur.peak_qty = Math.max(cur.peak_qty, Math.abs(pos));
  }

  // A still-open position is emitted too (closed_at NULL) so the UI can show live trades
  // alongside closed ones; the next rebuild replaces the row once more fills land.
  if (cur) out.push(cur);
  return out;
}

const avg = (notional, qty) => (qty > FLAT_EPS ? notional / qty : null);

// Rebuild `trades` from `fills`, incrementally.
//
// Cursor: the highest close_trade_id already materialised for a symbol. Everything at or below
// it is immutable (fills never change once recorded), so only fills above it are re-walked.
// Rows for the still-open trade are deleted first and rebuilt, since new fills keep extending
// it. Passing { full: true } ignores the cursor and rebuilds a symbol's whole history — used
// after a backfill imports older fills, which would otherwise sit below the cursor unseen.
export async function rebuildTrades({ symbol = null, full = false } = {}) {
  const scope = symbol
    ? await query('SELECT DISTINCT exchange, symbol FROM fills WHERE symbol=$1', [symbol])
    : await query('SELECT DISTINCT exchange, symbol FROM fills');

  let built = 0;
  for (const { exchange, symbol: sym } of scope.rows) {
    let cursor = 0;
    if (!full) {
      const { rows } = await query(
        'SELECT MAX(close_trade_id) AS id FROM trades WHERE exchange=$1 AND symbol=$2 AND closed_at IS NOT NULL',
        [exchange, sym]
      );
      cursor = Number(rows[0]?.id || 0);
    }
    // Drop the open trade (and, on a full rebuild, everything) so the walk below is the sole
    // writer for the range it covers — re-running is then idempotent rather than additive.
    await query(
      full
        ? 'DELETE FROM trades WHERE exchange=$1 AND symbol=$2'
        : 'DELETE FROM trades WHERE exchange=$1 AND symbol=$2 AND closed_at IS NULL',
      [exchange, sym]
    );

    const { rows: fills } = await query(
      'SELECT exchange,symbol,trade_id,side,qty,price,realized_pnl,commission,occurred_at FROM fills WHERE exchange=$1 AND symbol=$2 AND trade_id > $3 ORDER BY trade_id ASC',
      [exchange, sym, cursor]
    );
    if (!fills.length) continue;

    const trips = foldFills(fills);
    // Position metadata that isn't part of the fill stream. leverage is the bot's CURRENT
    // setting, not what was configured when the trade ran — the exchange doesn't report
    // per-trade leverage and we don't historise it, so it's a best-effort tag for grouping,
    // not an audited value. fund_id is stable enough to attribute directly.
    const { rows: botRows } = await query('SELECT fund_id, leverage FROM bots WHERE exchange=$1 AND symbol=$2 LIMIT 1', [exchange, sym]);
    const fundId = botRows[0]?.fund_id || null;
    const leverage = botRows[0]?.leverage || null;

    for (const t of trips) {
      // Funding is charged on the OPEN position every 8h and is reported separately from
      // fills, so it's joined in by time window rather than accumulated during the walk.
      // Sign is preserved as the exchange reports it (negative = paid, positive = received).
      const { rows: fr } = await query(
        `SELECT COALESCE(SUM(income),0) AS f FROM income_events
         WHERE symbol=$1 AND income_type='FUNDING_FEE' AND occurred_at >= $2 AND occurred_at <= COALESCE($3, now())`,
        [sym, t.opened_at, t.closed_at]
      );
      const funding = Number(fr[0]?.f || 0);
      const net = t.gross_pnl - t.commission + funding;
      const openedAt = new Date(t.opened_at);
      const durationS = t.closed_at ? Math.max(0, Math.round((new Date(t.closed_at) - openedAt) / 1000)) : null;

      await query(
        `INSERT INTO trades (exchange,symbol,open_trade_id,close_trade_id,direction,qty,entry_price,exit_price,
           gross_pnl,commission,funding,net_pnl,opened_at,closed_at,duration_s,entry_hour,entry_dow,fill_count,fund_id,leverage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (exchange,symbol,open_trade_id) DO UPDATE SET
           close_trade_id=EXCLUDED.close_trade_id, qty=EXCLUDED.qty, entry_price=EXCLUDED.entry_price,
           exit_price=EXCLUDED.exit_price, gross_pnl=EXCLUDED.gross_pnl, commission=EXCLUDED.commission,
           funding=EXCLUDED.funding, net_pnl=EXCLUDED.net_pnl, closed_at=EXCLUDED.closed_at,
           duration_s=EXCLUDED.duration_s, fill_count=EXCLUDED.fill_count, fund_id=EXCLUDED.fund_id,
           leverage=EXCLUDED.leverage`,
        [t.exchange, t.symbol, t.open_trade_id, t.close_trade_id, t.direction, t.peak_qty,
         avg(t.entry_notional, t.entry_qty), avg(t.exit_notional, t.exit_qty),
         t.gross_pnl, t.commission, funding, net, t.opened_at, t.closed_at, durationS,
         openedAt.getUTCHours(), openedAt.getUTCDay(), t.fill_count, fundId, leverage]
      );
      built += 1;
    }
  }
  return { built };
}
