// Local end-to-end test of the API against an in-process Postgres (PGlite).
// Proves: bcrypt-hashed passwords (no plaintext in DB), JWT login, encrypted secrets
// (no plaintext in DB), masking, and auth gating. Run: node scripts/test-api.mjs
import { PGlite } from '@electric-sql/pglite';

process.env.JWT_SECRET = 'test-jwt-secret-please-change-1234567890';
process.env.APP_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const db = new PGlite();
globalThis.__DB_QUERY__ = (t, p) => db.query(t, p);

const init = (await import('../api/init.js')).default;
const auth = (await import('../api/auth.js')).default;
const users = (await import('../api/users.js')).default;
const openwa = (await import('../api/openwa.js')).default;
const profile = (await import('../api/profile.js')).default;
const cronDaily = (await import('../api/cron/daily.js')).default;
const snapshots = (await import('../api/snapshots.js')).default;
const webhook = (await import('../api/webhook.js')).default;
const alerts = (await import('../api/alerts.js')).default;

function mockRes() {
  const r = { _status: 200, _json: null };
  r.status = (c) => { r._status = c; return r; };
  r.json = (o) => { r._json = o; return r; };
  r.end = () => r;
  return r;
}
async function call(handler, { method = 'GET', body = null, headers = {}, query = {} } = {}) {
  const req = { method, body, headers, query };
  const res = mockRes();
  await handler(req, res);
  return { status: res._status, body: res._json };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${extra && !cond ? '  → ' + JSON.stringify(extra) : ''}`); }

// 1. init
let r = await call(init, { method: 'POST' });
ok('init creates + seeds', r.status === 200 && r.body.seeded === true, r.body);

// 2. login admin/admin
r = await call(auth, { method: 'POST', body: { action: 'login', username: 'admin', password: 'admin' } });
const token = r.body?.token;
ok('login admin/admin returns JWT + user', r.status === 200 && !!token && r.body.user.role === 'admin', r.body);
ok('login response contains NO password field', !('password' in (r.body?.user || {})) && !('password_hash' in (r.body?.user || {})));
const authH = { authorization: 'Bearer ' + token };

// 3. wrong password rejected
r = await call(auth, { method: 'POST', body: { action: 'login', username: 'admin', password: 'wrong' } });
ok('wrong password -> 401', r.status === 401, r.body);

// 4. me requires auth
r = await call(auth, { method: 'GET', headers: {} });
ok('GET me without token -> 401', r.status === 401);
r = await call(auth, { method: 'GET', headers: authH });
ok('GET me with token -> admin', r.status === 200 && r.body.user.username === 'admin', r.body);

// 5. DB stores bcrypt hash, NOT plaintext
let q = await db.query("SELECT password_hash FROM users WHERE username='admin'");
const hash = q.rows[0].password_hash;
ok('password stored as bcrypt hash (starts $2)', /^\$2[aby]\$/.test(hash), { hash });
ok('plaintext "admin" NOT in password_hash', !hash.includes('admin'));

// 6. admin-only gating: create user without token forbidden
r = await call(users, { method: 'POST', body: { username: 'x', email: 'x@lno.company' } });
ok('create user without token -> 401', r.status === 401);

// 7. create user (admin)
r = await call(users, { method: 'POST', headers: authH, body: { username: 'nina.test', email: 'nina.test@lno.company', role: 'operator' } });
ok('admin creates user', r.status === 201 && r.body.user.username === 'nina.test', r.body);
r = await call(users, { method: 'POST', headers: authH, body: { username: 'bad', email: 'bad@gmail.com' } });
ok('create user with non-@lno.company email rejected', r.status === 400, r.body);

// 8. OpenWA config: set apiUrl + apiKey, ensure key is encrypted in DB + masked in response
r = await call(openwa, { method: 'PUT', headers: authH, body: { apiUrl: 'https://wa.example.com', apiKey: 'super-secret-openwa-key-123', defaultSender: '+33612345678', enabled: true } });
ok('openwa PUT ok, returns masked key (not raw)', r.status === 200 && r.body.config.hasApiKey && !JSON.stringify(r.body.config).includes('super-secret-openwa-key-123'), r.body);
q = await db.query("SELECT value FROM app_config WHERE key='openwa'");
const stored = JSON.stringify(q.rows[0].value);
ok('OpenWA api key encrypted in DB (no plaintext)', !stored.includes('super-secret-openwa-key-123') && q.rows[0].value.apiKeyEnc.startsWith('v1:'), { stored });

// 9. GET openwa never leaks the key
r = await call(openwa, { method: 'GET', headers: authH });
ok('GET openwa returns masked key only', r.status === 200 && r.body.config.hasApiKey && !JSON.stringify(r.body.config).includes('super-secret-openwa-key-123'));

// ── Alerts: mock exchange klines + OpenWA sendText so the suite stays offline ──
const sentMessages = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('/sendText')) { sentMessages.push(JSON.parse(opts.body).args); return { ok: true, status: 200, json: async () => ({ success: true }) }; }
  if (u.includes('binance.com')) { const a = []; let t = 1, p = 60000; for (let i = 0; i < 365; i++) { p *= 1 + Math.sin(i / 9) * 0.012; a.push([t, '0', '0', '0', String(p), '0']); t += 86400000; } return { ok: true, json: async () => a }; }
  if (u.includes('bybit.com')) { const list = []; let t = 365 * 86400000, p = 100; for (let i = 0; i < 365; i++) { p *= 1 + Math.cos(i / 7) * 0.01; list.push([String(t), '0', '0', '0', String(p)]); t -= 86400000; } return { ok: true, json: async () => ({ result: { list } }) }; }
  const data = []; let t = 300 * 86400000, p = 600; for (let i = 0; i < 300; i++) { p *= 1 + Math.sin(i / 5) * 0.011; data.push([String(t), '0', '0', '0', String(p)]); t -= 86400000; } return { ok: true, json: async () => ({ data }) };
};

// configure OpenWA (enabled) + give admin a phone & notify so alerts route
await call(openwa, { method: 'PUT', headers: authH, body: { apiUrl: 'https://wa.test', apiKey: 'k', enabled: true, defaultSender: '+33600000000', drawdownPct: 1, pnlDayThreshold: 99999999 } });
await call(profile, { method: 'PATCH', headers: authH, body: { phone: '+33611111111', notify: true } });

// login-failure alert: 3 wrong attempts triggers a WhatsApp to admins
sentMessages.length = 0;
for (let i = 0; i < 3; i++) await call(auth, { method: 'POST', body: { action: 'login', username: 'admin', password: 'nope' } });
ok('3 failed logins -> WhatsApp alert sent', sentMessages.some(m => /failed login/i.test(m.content)), sentMessages);

// daily cron: computes metrics + sends report (admin-triggered)
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH });
ok('cron computes risk metrics (sharpe/sortino/drawdown)', r.status === 200 && typeof r.body.metrics.sharpe === 'number' && typeof r.body.metrics.sortino === 'number' && typeof r.body.metrics.maxDrawdownPct === 'number', r.body && r.body.metrics);
ok('cron sends daily report via OpenWA', sentMessages.some(m => /daily report/i.test(m.content)), sentMessages.map(m => m.content.slice(0, 20)));
ok('cron unauthorized without admin/secret -> 401', (await call(cronDaily, { method: 'POST' })).status === 401);

// scoped per-bot rule + weekly/monthly reports (force)
sentMessages.length = 0;
// pnlDay rule with a huge threshold fires regardless of the data's sign — verifies the
// scoped per-bot rule path produces a bot-named breach (data is now strongly positive)
await call(openwa, { method: 'PUT', headers: authH, body: { alertRules: [{ id: 'r1', scope: 'bot:b1', metric: 'pnlDay', value: 99999999, enabled: true }] } });
r = await call(cronDaily, { method: 'POST', headers: authH, query: { force: 'all' } });
ok('scoped per-bot alert rule breach detected', r.body.breaches.some(b => /Alpha-BTC-Momentum/.test(b)), r.body.breaches);
ok('weekly + monthly reports sent (force=all)', r.body.sent.some(s => s.type === 'weekly') && r.body.sent.some(s => s.type === 'monthly'), r.body.sent.map(s => s.type));
// monthly PDF document sent + the PDF builder produces a valid PDF
const pdfPart = r.body.sent.find(s => s.type === 'monthly-pdf');
ok('monthly PDF document sent via OpenWA', !!pdfPart && !pdfPart.error && pdfPart.sent >= 1, pdfPart);
const { buildMonthlyPdf } = await import('../api/_lib/report.js');
const pdfB64 = await buildMonthlyPdf({ equity: 1e6, pnl30: 5000, maxDrawdownPct: -8, ddDurationDays: 12, sharpe: 1.2, sortino: 1.5, best: { name: 'X', pnl: 1000 }, worst: { name: 'Y', pnl: -500 }, byExchange: { Binance: 5e5, Bybit: 3e5 }, dateLabel: '2026-06-15' });
ok('buildMonthlyPdf produces a valid %PDF', Buffer.from(pdfB64, 'base64').slice(0, 5).toString() === '%PDF-', pdfB64.slice(0, 8));

// acknowledgement: cron created an alert (breach) with a code -> webhook acks it -> /api/alerts shows acked
r = await call(alerts, { method: 'GET', headers: authH });
const pending = r.body.alerts.find(al => !al.ackedAt);
ok('cron recorded an acknowledgeable alert', !!pending && !!pending.code, r.body.alerts.slice(0,2));
r = await call(webhook, { method: 'POST', query: {}, body: { from: '33600000000@c.us', body: `ACK ${pending.code}` } });
ok('WhatsApp "ACK <code>" reply acknowledges via webhook', r.body.acked === pending.code, r.body);
r = await call(alerts, { method: 'GET', headers: authH });
ok('alert now shows acknowledged', !!r.body.alerts.find(al => al.code === pending.code && al.ackedAt), r.body.alerts.find(al=>al.code===pending.code));

// the cron records a daily equity snapshot
r = await call(snapshots, { method: 'GET', headers: authH });
ok('cron wrote an equity snapshot (history accrues)', r.status === 200 && r.body.snapshots.length >= 1 && typeof r.body.snapshots[0].equity === 'number', r.body && r.body.snapshots);

// report archive: admin generates a report -> it lists -> the PDF downloads
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'generateReport' } });
const genReport = r.body.report;
ok('admin generates + archives a report', r.status === 200 && genReport && genReport.id && genReport.kind === 'monthly', r.body);
r = await call(snapshots, { method: 'GET', headers: authH, query: { reports: 'list' } });
ok('report archive lists the generated report', r.status === 200 && (r.body.reports || []).some(x => x.id === genReport.id), r.body && r.body.reports);
r = await call(snapshots, { method: 'GET', headers: authH, query: { report: String(genReport.id) } });
ok('archived report downloads as a valid %PDF', r.status === 200 && Buffer.from(r.body.pdfBase64, 'base64').slice(0, 5).toString() === '%PDF-', r.body && r.body.filename);
r = await call(snapshots, { method: 'GET', query: { reports: 'list' } });
ok('report archive requires auth -> 401', r.status === 401, r.status);

// shareholder role — dashboard + read-only reports, nothing else
r = await call(users, { method: 'POST', headers: authH, body: { username: 'invest.or', email: 'invest.or@lno.company', role: 'shareholder' } });
ok('shareholder role grants exactly [view_activity, view_reports]',
  r.status === 201 && JSON.stringify((r.body.user.permissions || []).slice().sort()) === JSON.stringify(['view_activity', 'view_reports']), r.body.user && r.body.user.permissions);
// non-admin (operator) can read the archive but cannot generate a report
r = await call(auth, { method: 'POST', body: { action: 'login', username: 'sophie.ops', password: 'admin' } });
const opH = { authorization: 'Bearer ' + r.body.token };
r = await call(snapshots, { method: 'POST', headers: opH, body: { action: 'generateReport' } });
ok('non-admin cannot generate a report -> 403', r.status === 403, r.status);
r = await call(snapshots, { method: 'GET', headers: opH, query: { reports: 'list' } });
ok('any authenticated user can list the report archive', r.status === 200 && Array.isArray(r.body.reports), r.status);

// Sign in with Google — verification stubbed (real flow verifies the Google JWKS signature).
globalThis.__GOOGLE_VERIFY__ = async (cred) => JSON.parse(Buffer.from(cred, 'base64').toString());
const gcred = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'alice.new@lno.company', email_verified: true, hd: 'lno.company', given_name: 'Alice', family_name: 'New' }) } });
ok('Google sign-in auto-creates an @lno.company user (viewer, username=local part, names saved)',
  r.status === 200 && r.body.user.username === 'alice.new' && r.body.user.role === 'viewer' && r.body.user.firstName === 'Alice' && r.body.user.lastName === 'New' && r.body.user.authProvider === 'google' && !!r.body.token, r.body);
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'mallory@evil.com', email_verified: true, given_name: 'M', family_name: 'X' }) } });
ok('Google sign-in rejects a non-@lno.company domain -> 403', r.status === 403, r.status);
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'bob@lno.company', email_verified: false, hd: 'lno.company' }) } });
ok('Google sign-in rejects an unverified email -> 403', r.status === 403, r.status);
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'alice.new@lno.company', email_verified: true, hd: 'lno.company', given_name: 'Alice', family_name: 'Renamed' }) } });
ok('repeat Google sign-in updates names, keeps same account', r.status === 200 && r.body.user.lastName === 'Renamed', r.body.user);
r = await call(users, { method: 'GET', headers: authH });
ok('no duplicate account for repeat Google sign-in', r.body.users.filter(x => x.username === 'alice.new').length === 1, r.body.users.filter(x => x.username === 'alice.new').length);
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'admin@lno.company', email_verified: true, hd: 'lno.company', given_name: 'Admin', family_name: 'User' }) } });
ok('Google sign-in links an existing account by email (keeps admin role)', r.status === 200 && r.body.user.username === 'admin' && r.body.user.role === 'admin', r.body.user);
delete globalThis.__GOOGLE_VERIFY__;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
