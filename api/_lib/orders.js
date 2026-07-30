// Order history, and the three metrics that only orders can give.
//
// Until now this system saw executions only. A fill answers "what happened"; an order answers
// "what was asked for" — and the gap between the two is where three questions live that no
// amount of fill data can settle:
//
//   Slippage      the price asked vs the price got. Invisible if you only ever see the got.
//   Unfilled work orders placed and then cancelled or expired. A strategy that cancels most
//                 of what it places is behaving very differently from one that doesn't, and
//                 the fill stream shows neither of them differently.
//   Risk          the distance to the resting stop. It is what an R-multiple divides by, and
//                 it is the only record of how much the desk was actually willing to lose.
//
// Everything here comes from Binance's own allOrders endpoint — no external source.
import { query } from './db.js';
import { decrypt } from './crypto.js';
import { getAllOrders } from './binance.js';

// Order types that carry an INTENDED price to compare the execution against.
//
// A plain MARKET order asks for "whatever is there", so it has no intended price and no
// meaningful slippage — reporting 0 for it would drag every average toward zero and make a
// genuinely slipping limit book look fine. Those are excluded, not zeroed.
const INTENDED_PRICE = (o) => {
  const t = String(o.type || '');
  if (t === 'MARKET') return null;
  // A *_MARKET stop executes at market once triggered; the trigger is what was intended.
  if (t.endsWith('_MARKET')) return o.stop_price > 0 ? Number(o.stop_price) : null;
  return o.price > 0 ? Number(o.price) : null;
};

// Slippage as a COST, in currency: positive means the fill was worse than asked. A buy filled
// above its limit and a sell filled below it are the same problem, so the sign is normalised
// by side rather than left as a raw price difference.
export function orderSlippage(o) {
  const intended = INTENDED_PRICE(o);
  const avg = Number(o.avg_price || 0);
  const qty = Number(o.executed_qty || 0);
  if (intended == null || !(avg > 0) || !(qty > 0)) return null;
  const perUnit = o.side === 'BUY' ? avg - intended : intended - avg;
  return perUnit * qty;
}

const TERMINAL_UNFILLED = new Set(['CANCELED', 'EXPIRED', 'REJECTED']);
export const isUnfilled = (o) => TERMINAL_UNFILLED.has(String(o.status)) && Number(o.executed_qty || 0) === 0;

// Incremental per-symbol sync, mirroring how fills are pulled. Resumes from the highest order
// id already stored: Binance's allOrders accepts an orderId cursor and returns everything
// after it, which is exact where a startTime would risk re-reading or skipping a boundary.
export async function syncOrders({ exchange = 'binance', apiKey, secret, symbols = [] } = {}) {
  let stored = 0;
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const { rows } = await query('SELECT MAX(order_id) AS id FROM orders WHERE exchange=$1 AND symbol=$2', [exchange, symbol]);
      const cursor = rows[0]?.id;
      const list = await getAllOrders(apiKey, secret, {
        symbol,
        orderId: cursor != null ? Number(cursor) + 1 : undefined,
        startTime: cursor == null ? Date.now() - 7 * 86400000 : undefined,
      });
      for (const o of list) {
        // Orders DO mutate (NEW -> PARTIALLY_FILLED -> FILLED/CANCELED), unlike fills. An
        // upsert keeps the latest state rather than pinning whatever was seen first.
        await query(
          `INSERT INTO orders (exchange,symbol,order_id,client_order_id,side,type,status,price,stop_price,avg_price,
             orig_qty,executed_qty,reduce_only,close_position,placed_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,to_timestamp($15/1000.0),to_timestamp($16/1000.0))
           ON CONFLICT (exchange,symbol,order_id) DO UPDATE SET
             status=EXCLUDED.status, avg_price=EXCLUDED.avg_price, executed_qty=EXCLUDED.executed_qty,
             updated_at=EXCLUDED.updated_at`,
          [exchange, symbol, o.orderId, o.clientOrderId, o.side, o.type, o.status, o.price, o.stopPrice,
           o.avgPrice, o.origQty, o.executedQty, o.reduceOnly, o.closePosition, o.time, o.updateTime || o.time]
        );
        stored++;
      }
    } catch (e) { /* best-effort per symbol — one bad symbol must not drop the rest */ }
  }));
  return { stored };
}

// Fold each round trip's orders into slippage, risk and R-multiple.
//
// Orders carry no fill id, so they are matched to a trade by symbol and time window. That is
// an approximation only where two round trips on the same symbol overlap in time — which
// cannot happen, since a round trip is by definition the span from flat to flat.
export async function attachOrderMetrics({ symbol = null } = {}) {
  const { rows: trades } = await query(
    `SELECT exchange, symbol, open_trade_id, direction, qty, entry_price, net_pnl, opened_at, closed_at
     FROM trades WHERE closed_at IS NOT NULL ${symbol ? 'AND symbol=$1' : ''}`, symbol ? [symbol] : []
  );
  let updated = 0;
  for (const t of trades) {
    const { rows: orders } = await query(
      `SELECT * FROM orders WHERE exchange=$1 AND symbol=$2 AND placed_at >= $3 AND placed_at <= $4`,
      [t.exchange, t.symbol, t.opened_at, t.closed_at]
    );
    if (!orders.length) continue;

    const slips = orders.map(orderSlippage).filter(v => v != null);
    // null, not 0, when nothing in the window had an intended price: "we could not measure
    // it" and "it was perfect" are different facts.
    const slippage = slips.length ? slips.reduce((a, b) => a + b, 0) : null;
    const unfilled = orders.filter(isUnfilled).length;

    // Risk = distance from entry to the protective stop, times size. Only stops that REDUCE
    // the position count: an entry stop is not protection, it is the entry.
    const stops = orders.filter(o => String(o.type).startsWith('STOP') && Number(o.stop_price) > 0 && (o.reduce_only || o.close_position));
    let risk = null, rMultiple = null;
    if (stops.length && t.entry_price) {
      // The widest stop is the real exposure: if several were placed and moved, the loss the
      // desk actually accepted at entry is the furthest one, not the tightest.
      const worst = stops.reduce((acc, o) => {
        const d = Math.abs(Number(t.entry_price) - Number(o.stop_price));
        return d > acc ? d : acc;
      }, 0);
      if (worst > 0) {
        risk = worst * Number(t.qty);
        if (risk > 0) rMultiple = Number(t.net_pnl) / risk;
      }
    }

    await query(
      `UPDATE trades SET slippage=$4, unfilled_orders=$5, risk=$6, r_multiple=$7
       WHERE exchange=$1 AND symbol=$2 AND open_trade_id=$3`,
      [t.exchange, t.symbol, t.open_trade_id, slippage, unfilled, risk, rMultiple]
    );
    updated++;
  }
  return { updated };
}

// The orders that make up one round trip, for the position page.
export async function ordersForTrade({ exchange, symbol, openedAt, closedAt }) {
  const { rows } = await query(
    `SELECT * FROM orders WHERE exchange=$1 AND symbol=$2 AND placed_at >= $3 AND placed_at <= COALESCE($4, now())
     ORDER BY placed_at ASC`, [exchange, symbol, openedAt, closedAt]
  );
  return rows.map(o => ({
    orderId: Number(o.order_id), side: o.side, type: o.type, status: o.status,
    price: Number(o.price) || null, stopPrice: Number(o.stop_price) || null,
    avgPrice: Number(o.avg_price) || null,
    origQty: Number(o.orig_qty), executedQty: Number(o.executed_qty),
    reduceOnly: o.reduce_only, closePosition: o.close_position,
    intendedPrice: INTENDED_PRICE(o), slippage: orderSlippage(o), unfilled: isUnfilled(o),
    placedAt: o.placed_at, updatedAt: o.updated_at,
  }));
}

// Convenience for the sync path: which symbols are worth pulling orders for. Same scope as
// the fills sync — currently open, or closed within the last day.
export async function orderSyncSymbols(openSymbols = []) {
  const { rows } = await query(
    "SELECT DISTINCT symbol FROM bots WHERE exchange='binance' AND status='closed' AND last_seen > now() - interval '1 day'"
  );
  return [...new Set([...openSymbols, ...rows.map(r => r.symbol)])];
}

export async function decryptSecret(enc) { return decrypt(enc); }
