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
};
// auto-seed on boot so the app is usable immediately
await handlers['/api/init']({ method: 'POST', headers: {}, query: {}, body: null },
  { _c: 200, status(c){this._c=c;return this;}, json(o){console.log('[init]', JSON.stringify(o)); return this;}, end(){return this;} });

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
