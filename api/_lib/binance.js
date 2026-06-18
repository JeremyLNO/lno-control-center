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

async function signedGet(path, key, secret, params = {}) {
  const opts = { headers: { 'X-MBX-APIKEY': key } };
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
      return {
        symbol: p.symbol,
        side: amt >= 0 ? 'LONG' : 'SHORT',
        qty: Math.abs(amt),
        entry: parseFloat(p.entryPrice || '0'),
        mark,
        unrealizedPnl: parseFloat(p.unRealizedProfit || '0'),
        leverage: parseFloat(p.leverage || '0'),
        notional: Math.abs(parseFloat(p.notional != null ? p.notional : amt * mark)),
      };
    });
}

// Account-level equity (margin balance = wallet + unrealized PnL).
export async function getAccountEquity(key, secret) {
  const a = await signedGet('/fapi/v2/account', key, secret);
  return {
    equity: parseFloat(a.totalMarginBalance || '0'),
    walletBalance: parseFloat(a.totalWalletBalance || '0'),
    unrealizedPnl: parseFloat(a.totalUnrealizedProfit || '0'),
    available: parseFloat(a.availableBalance || '0'),
  };
}
