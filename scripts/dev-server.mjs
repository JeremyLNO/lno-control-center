// Local full-stack dev server: serves dist/ + runs the /api functions against an
// in-process Postgres (PGlite). For LOCAL TESTING ONLY. Run: node scripts/dev-server.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

process.env.JWT_SECRET ||= 'local-dev-jwt-secret-please-change-1234567890';
process.env.APP_ENCRYPTION_KEY ||= '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const db = new PGlite();
globalThis.__DB_QUERY__ = (t, p) => db.query(t, p);

const handlers = {
  '/api/init': (await import('../api/init.js')).default,
  '/api/auth': (await import('../api/auth.js')).default,
  '/api/users': (await import('../api/users.js')).default,
  '/api/profile': (await import('../api/profile.js')).default,
  '/api/funds': (await import('../api/funds.js')).default,
  '/api/exchanges': (await import('../api/exchanges.js')).default,
  '/api/openwa': (await import('../api/openwa.js')).default,
  '/api/cron/daily': (await import('../api/cron/daily.js')).default,
  '/api/snapshots': (await import('../api/snapshots.js')).default,
  '/api/webhook': (await import('../api/webhook.js')).default,
  '/api/alerts': (await import('../api/alerts.js')).default,
  '/api/bots': (await import('../api/bots.js')).default,
};
// auto-seed on boot so the app is usable immediately
await handlers['/api/init']({ method: 'POST', headers: {}, query: {}, body: null },
  { _c: 200, status(c){this._c=c;return this;}, json(o){console.log('[init]', JSON.stringify(o)); return this;}, end(){return this;} });

// dev-only fixture: a few open positions with liquidation/margin/activity data, since
// there's no way to exercise real Binance sync locally. Lets the risk UI (liq. distance /
// margin usage / dormant-bot detection) be checked visually without a live exchange key.
await db.query(`INSERT INTO bots (id,exchange,symbol,side,qty,entry,mark,unrealized_pnl,notional,leverage,status,liquidation_price,maint_margin,initial_margin,last_changed)
  VALUES
    ('binance:BTCUSDT','binance','BTCUSDT','LONG',0.5,60000,61000,500,30500,10,'open',55000,150,1600,now()),
    ('binance:ETHUSDT','binance','ETHUSDT','SHORT',5,3200,3100,500,15500,20,'open',3720,80,780,now()),
    ('binance:SOLUSDT','binance','SOLUSDT','LONG',100,145,150,500,15000,5,'open',100,900,1000,now() - interval '72 hours')
  ON CONFLICT (id) DO NOTHING`);
// dev-only fixture: a "live" snapshot with a deliberate walletBalance/equity mismatch, to
// exercise the balance-reconciliation warning locally (real Binance data would rarely drift).
await db.query(`INSERT INTO app_config (key,value) VALUES ('live','{"equity":50000,"walletBalance":45000,"positions":3,"connected":1,"syncedAt":0}'::jsonb)
  ON CONFLICT (key) DO NOTHING`);
// dev-only fixture: realized PnL history, since there's no local way to exercise Binance's
// income endpoint either. Lets the per-bot/per-fund attribution tables be checked visually.
await db.query(`INSERT INTO income_events (tran_id,exchange,symbol,income_type,income,occurred_at) VALUES
    ('fx1','binance','BTCUSDT','REALIZED_PNL',420,now()-interval '5 days'),
    ('fx2','binance','BTCUSDT','REALIZED_PNL',180,now()-interval '4 days'),
    ('fx3','binance','BTCUSDT','REALIZED_PNL',-150,now()-interval '3 days'),
    ('fx4','binance','ETHUSDT','REALIZED_PNL',-90,now()-interval '4 days'),
    ('fx5','binance','ETHUSDT','REALIZED_PNL',-60,now()-interval '2 days'),
    ('fx6','binance','ETHUSDT','REALIZED_PNL',30,now()-interval '1 days'),
    ('fx7','binance','BTCUSDT','FUNDING_FEE',-12.5,now()-interval '5 days'),
    ('fx8','binance','BTCUSDT','FUNDING_FEE',-8.2,now()-interval '2 days'),
    ('fx9','binance','BTCUSDT','COMMISSION',-6.1,now()-interval '5 days'),
    ('fx10','binance','ETHUSDT','FUNDING_FEE',4.3,now()-interval '3 days'),
    ('fx11','binance','ETHUSDT','COMMISSION',-3.4,now()-interval '3 days')
  ON CONFLICT (tran_id) DO NOTHING`);
// dev-only fixture: a fill stream that forms real round trips, so the analytics surfaces
// (cross-dimension analysis, calendar, playbook) have something to show locally. Deliberately
// seeded as FILLS rather than as `trades` rows: rebuildTrades() below then reconstructs them
// through the exact production code path, which is what we actually want to exercise.
// Deterministic (no Math.random) so a screenshot taken today matches one taken tomorrow.
{
  const syms = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT'];
  const px = { BTCUSDT: 60000, ETHUSDT: 3200, SOLUSDT: 145, ADAUSDT: 0.62 };
  let id = 5000;
  const vals = [];
  for (let d = 1; d <= 75; d++) {
    const n = 1 + Math.floor(Math.abs(Math.sin(d * 1.7)) * 3);
    for (let k = 0; k < n; k++) {
      const sym = syms[(d + k) % syms.length];
      const long = (d + k) % 3 !== 0;
      const hour = [2, 7, 9, 13, 16, 20][(d * 3 + k) % 6];
      const durS = [600, 2400, 9000, 40000, 120000][(d + k) % 5];
      const qty = sym === 'ADAUSDT' ? 5000 : sym === 'SOLUSDT' ? 40 : sym === 'ETHUSDT' ? 2 : 0.1;
      const entry = px[sym];
      // pnl varies in sign and size by symbol/day so the buckets actually differ
      const pnl = Math.round((Math.sin(d * 0.9 + k * 2.1) * 180 + Math.cos(d * 0.3) * 60) * (long ? 1 : 0.6) * 100) / 100;
      const exit = entry + (long ? pnl / qty : -pnl / qty);
      const open = new Date(Date.UTC(2026, 4, 1, hour, 5) + (d - 1) * 86400000).toISOString();
      const close = new Date(Date.parse(open) + durS * 1000).toISOString();
      const fee = Math.abs(qty * entry) * 0.0004;
      vals.push(`('binance','${sym}',${++id},'${long ? 'BUY' : 'SELL'}',${qty},${entry},0,${fee.toFixed(4)},'${open}')`);
      vals.push(`('binance','${sym}',${++id},'${long ? 'SELL' : 'BUY'}',${qty},${exit},${pnl},${fee.toFixed(4)},'${close}')`);
    }
  }
  await db.query(`INSERT INTO fills (exchange,symbol,trade_id,side,qty,price,realized_pnl,commission,occurred_at)
    VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`);
  const { rebuildTrades } = await import('../api/_lib/trades.js');
  const built = await rebuildTrades({ full: true });
  console.log('[fixture] round trips reconstructed from fills:', JSON.stringify(built));
}

const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png','.woff2':'font/woff2' };
const DIST = new URL('../dist/', import.meta.url);
const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json' }); res.end(body); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const key = url.pathname.replace(/\/$/, '');
  if (handlers[key]) {
    let raw = ''; for await (const c of req) raw += c;
    let body = null; if (raw) { try { body = JSON.parse(raw); } catch {} }
    const vreq = { method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body };
    const vres = { _c: 200, status(c){this._c=c;return this;}, json(o){ send(res,this._c,JSON.stringify(o)); return this;}, end(){ res.end(); return this;} };
    try { await handlers[key](vreq, vres); } catch (e) { send(res, 500, JSON.stringify({ error: String(e.message||e) })); }
    return;
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  try {
    const buf = await readFile(new URL(file, DIST));
    send(res, 200, buf, MIME[extname(file)] || 'application/octet-stream');
  } catch {
    try { const buf = await readFile(new URL('index.html', DIST)); send(res, 200, buf, 'text/html'); }
    catch { send(res, 404, 'not found', 'text/plain'); }
  }
});
const PORT = process.env.PORT || 8788;
server.listen(PORT, () => console.log('full-stack dev server on http://localhost:' + PORT));
