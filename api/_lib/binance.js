// Binance USDⓈ-M Futures read-only client. Signs requests with HMAC-SHA256 (key+secret
// stay server-side; read-only keys are enough). Used by the position sync.
import crypto from 'crypto';

const FAPI = 'https://fapi.binance.com';

function signedQS(params, secret) {
  const qs = new URLSearchParams({ ...params, recvWindow: '10000', timestamp: String(Date.now()) }).toString();
  const sig = crypto.createHmac('sha256', secret).update(qs).digest('hex');
  return `${qs}&signature=${sig}`;
}

// Optional static-IP egress: route through a forward/CONNECT proxy (QuotaGuard, Fixie, …)
// so a fixed IP can be whitelisted on the Binance key. BINANCE_PROXY = the proxy URL. The
// request still targets fapi.binance.com (correct Host/SNI/signature) — only the egress IP
// changes. Cached; falls back to a direct call if undici/proxy is unavailable.
let _dispatcher; // undefined = unresolved, null = none
async function proxyDispatcher() {
  if (!process.env.BINANCE_PROXY) return undefined;
  if (_dispatcher === undefined) {
    try { const { ProxyAgent } = await import('undici'); _dispatcher = new ProxyAgent(process.env.BINANCE_PROXY); }
    catch (e) { _dispatcher = null; }
  }
  return _dispatcher || undefined;
}

// Every outbound Binance call gets a hard timeout — fetch() has none by default, so a single
// stalled response (rare, but exchange APIs do hang sometimes) would otherwise block whatever
// awaited it indefinitely. This matters far more since getUserTrades() started firing one call
// PER SYMBOL every sync (see sync.js): with no timeout, one stuck symbol blocks the entire
// sync — and since the cron alert-check hits this on every trigger, a single hang can silently
// break 24/7 alerting until Vercel's own platform timeout eventually kills the request (which
// takes minutes, not seconds — exactly the failure mode this fixes).
const REQUEST_TIMEOUT_MS = 10000;

async function signedGet(path, key, secret, params = {}) {
  const opts = { headers: { 'X-MBX-APIKEY': key }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  const d = await proxyDispatcher(); if (d) opts.dispatcher = d;
  const r = await fetch(`${FAPI}${path}?${signedQS(params, secret)}`, opts);
  let body; try { body = await r.json(); } catch (e) { body = null; }
  if (!r.ok) { const e = new Error((body && body.msg) || `binance ${r.status}`); e.code = body && body.code; throw e; }
  return body;
}

// Open futures positions (positionAmt != 0), normalized.
export async function getPositions(key, secret) {
  const rows = await signedGet('/fapi/v2/positionRisk', key, secret);
  return (Array.isArray(rows) ? rows : [])
    .filter(p => Math.abs(parseFloat(p.positionAmt || '0')) > 0)
    .map(p => {
      const amt = parseFloat(p.positionAmt);
      const mark = parseFloat(p.markPrice || '0');
      const liq = parseFloat(p.liquidationPrice || '0');
      return {
        symbol: p.symbol,
        side: amt >= 0 ? 'LONG' : 'SHORT',
        qty: Math.abs(amt),
        entry: parseFloat(p.entryPrice || '0'),
        mark,
        unrealizedPnl: parseFloat(p.unRealizedProfit || '0'),
        leverage: parseFloat(p.leverage || '0'),
        notional: Math.abs(parseFloat(p.notional != null ? p.notional : amt * mark)),
        liquidationPrice: liq > 0 ? liq : null, // 0 = Binance reports "no liquidation price" (e.g. very low leverage)
      };
    });
}

// Account-level equity (margin balance = wallet + unrealized PnL) + per-symbol maintenance/
// initial margin (from the account endpoint's `positions[]`, keyed by symbol) — used to
// compute each open position's margin usage alongside its liquidation distance.
export async function getAccountEquity(key, secret) {
  const a = await signedGet('/fapi/v2/account', key, secret);
  const margins = {};
  for (const p of (Array.isArray(a.positions) ? a.positions : [])) {
    margins[p.symbol] = { maintMargin: parseFloat(p.maintMargin || '0'), initialMargin: parseFloat(p.initialMargin || '0') };
  }
  return {
    equity: parseFloat(a.totalMarginBalance || '0'),
    walletBalance: parseFloat(a.totalWalletBalance || '0'),
    unrealizedPnl: parseFloat(a.totalUnrealizedProfit || '0'),
    available: parseFloat(a.availableBalance || '0'),
    margins,
  };
}

// Realized PnL / funding / commission history (income history only covers the last 3
// months per Binance). Used to build the trade-attribution and funding/fee analytics —
// unrealized PnL of a currently-open position isn't a "win" or "loss" until it's realized.
export async function getIncome(key, secret, { startTime } = {}) {
  const params = { limit: '1000' };
  if (startTime) params.startTime = String(startTime);
  const rows = await signedGet('/fapi/v1/income', key, secret, params);
  return (Array.isArray(rows) ? rows : []).map(r => ({
    tranId: String(r.tranId), symbol: r.symbol || null, incomeType: r.incomeType,
    income: parseFloat(r.income || '0'), time: Number(r.time),
  }));
}

// Account's own executed trades (fills) for one symbol — futures' userTrades endpoint has
// no all-symbols call, unlike income/positions, so the caller must iterate symbols itself
// (see sync.js). `fromId` (Binance's own trade id, monotonically increasing per symbol)
// resumes from just after the last-seen trade — pass the max known trade_id + 1 to avoid
// re-fetching the same page every sync. Omit both `fromId` and `startTime` to get the most
// recent `limit` trades (first sync for a symbol, nothing recorded yet).
export async function getUserTrades(key, secret, { symbol, fromId, startTime, limit = 1000 } = {}) {
  const params = { symbol, limit: String(limit) };
  if (fromId != null) params.fromId = String(fromId);
  else if (startTime) params.startTime = String(startTime);
  const rows = await signedGet('/fapi/v1/userTrades', key, secret, params);
  return (Array.isArray(rows) ? rows : []).map(r => ({
    tradeId: Number(r.id), symbol: r.symbol, side: r.side,
    qty: parseFloat(r.qty || '0'), price: parseFloat(r.price || '0'),
    realizedPnl: parseFloat(r.realizedPnl || '0'), commission: parseFloat(r.commission || '0'),
    time: Number(r.time),
  }));
}

// User Data Stream (listenKey) — unlike every call above, these three take ONLY the API-KEY
// header, no HMAC signature, by Binance's own design: a listenKey is a scoped, revocable,
// time-limited token meant to be handed to a lower-trust client so it can open its own
// WebSocket for real-time ACCOUNT_UPDATE/ORDER_TRADE_UPDATE events. The account's actual
// key+secret never leave the server — only this derived token does.
async function listenKeyRequest(key, method) {
  const opts = { method, headers: { 'X-MBX-APIKEY': key }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  const d = await proxyDispatcher(); if (d) opts.dispatcher = d;
  const r = await fetch(`${FAPI}/fapi/v1/listenKey`, opts);
  let body; try { body = await r.json(); } catch (e) { body = null; }
  if (!r.ok) { const e = new Error((body && body.msg) || `binance ${r.status}`); e.code = body && body.code; throw e; }
  return body || {};
}
export async function createListenKey(key) { return (await listenKeyRequest(key, 'POST')).listenKey; }
export async function keepAliveListenKey(key) { await listenKeyRequest(key, 'PUT'); }

// Public klines (no key needed — market data, not account data). Used to reconstruct what the
// price actually did DURING a closed trade, which is the only way to compute MAE/MFE: the
// account endpoints report where we entered and exited, never how far the position ran
// against us or in our favour in between.
export async function getKlines({ symbol, interval = '5m', startTime, endTime, limit = 500 }) {
  const qs = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (startTime) qs.set('startTime', String(startTime));
  if (endTime) qs.set('endTime', String(endTime));
  const opts = { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
  const d = await proxyDispatcher(); if (d) opts.dispatcher = d;
  const r = await fetch(`${FAPI}/fapi/v1/klines?${qs}`, opts);
  if (!r.ok) throw new Error(`binance klines ${r.status}`);
  const rows = await r.json();
  return (rows || []).map(k => ({ t: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]) }));
}

// Full order history for one symbol (signed). Distinct from getUserTrades: a FILL is what
// executed, an ORDER is what was ASKED FOR — including the ones that never filled. That gap
// is the only place slippage, cancellations and the resting stop's risk can be read from.
// Like userTrades, futures' allOrders has no all-symbols form, so this is called per symbol.
export async function getAllOrders(key, secret, { symbol, orderId, startTime, limit = 500 } = {}) {
  const params = { symbol, limit: String(limit) };
  if (orderId) params.orderId = String(orderId);
  else if (startTime) params.startTime = String(startTime);
  const rows = await signedGet('/fapi/v1/allOrders', key, secret, params);
  return (rows || []).map(o => ({
    orderId: Number(o.orderId), clientOrderId: o.clientOrderId, side: o.side,
    type: o.type, origType: o.origType, status: o.status,
    price: Number(o.price), stopPrice: Number(o.stopPrice), avgPrice: Number(o.avgPrice),
    origQty: Number(o.origQty), executedQty: Number(o.executedQty),
    reduceOnly: !!o.reduceOnly, closePosition: !!o.closePosition,
    time: Number(o.time), updateTime: Number(o.updateTime),
  }));
}
