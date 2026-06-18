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
const exchanges = (await import('../api/exchanges.js')).default;
const funds = (await import('../api/funds.js')).default;
const bots = (await import('../api/bots.js')).default;

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
r = await call(auth, { method: 'POST', body: { action: 'login', email: 'admin@lno.company', password: 'admin' } });
const token = r.body?.token;
ok('login admin/admin returns JWT + user', r.status === 200 && !!token && r.body.user.role === 'admin', r.body);
ok('login response contains NO password field', !('password' in (r.body?.user || {})) && !('password_hash' in (r.body?.user || {})));
const authH = { authorization: 'Bearer ' + token };

// 3. wrong password rejected
r = await call(auth, { method: 'POST', body: { action: 'login', email: 'admin@lno.company', password: 'wrong' } });
ok('wrong password -> 401', r.status === 401, r.body);

// 4. me requires auth
r = await call(auth, { method: 'GET', headers: {} });
ok('GET me without token -> 401', r.status === 401);
r = await call(auth, { method: 'GET', headers: authH });
ok('GET me with token -> admin', r.status === 200 && r.body.user.email === 'admin@lno.company' && r.body.user.role === 'admin', r.body);

// 5. DB stores bcrypt hash, NOT plaintext
let q = await db.query("SELECT password_hash FROM users WHERE username='admin'");
const hash = q.rows[0].password_hash;
ok('password stored as bcrypt hash (starts $2)', /^\$2[aby]\$/.test(hash), { hash });
ok('plaintext "admin" NOT in password_hash', !hash.includes('admin'));

// 6. admin-only gating: create user without token forbidden
r = await call(users, { method: 'POST', body: { email: 'x@lno.company' } });
ok('create user without token -> 401', r.status === 401);

// 7. create user (admin) — email is the identity, no username
r = await call(users, { method: 'POST', headers: authH, body: { email: 'nina.test@lno.company', role: 'operator' } });
ok('admin creates user', r.status === 201 && r.body.user.email === 'nina.test@lno.company' && r.body.user.role === 'operator', r.body);
r = await call(users, { method: 'POST', headers: authH, body: { email: 'bad@gmail.com' } });
ok('create user with non-@lno.company email rejected', r.status === 400, r.body);

// 8. WhatsApp config: enable + a default notification matrix is returned (no default recipient)
r = await call(openwa, { method: 'PUT', headers: authH, body: { enabled: true } });
ok('openwa config has a notification matrix + no default recipient', r.status === 200 && r.body.config.notifMatrix && Array.isArray(r.body.config.notifMatrix.login) && !('defaultSender' in r.body.config), r.body.config);

// ── Alerts: mock exchange klines + CallMeBot sends so the suite stays offline ──
const sentMessages = [];
let binancePositions = [
  { symbol: 'ADAUSDT', positionAmt: '1000',  entryPrice: '0.45', markPrice: '0.47',  unRealizedProfit: '20', leverage: '5',  notional: '470' },
  { symbol: 'XRPUSDT', positionAmt: '-2000', entryPrice: '0.62', markPrice: '0.60',  unRealizedProfit: '40', leverage: '3',  notional: '-1200' },
  { symbol: 'BTCUSDT', positionAmt: '0',     entryPrice: '0',    markPrice: '67000', unRealizedProfit: '0',  leverage: '10', notional: '0' },
];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('fapi.binance.com')) { // signed Binance USDⓈ-M futures (read-only)
    if (u.includes('/fapi/v2/positionRisk')) return { ok: true, status: 200, json: async () => binancePositions };
    if (u.includes('/fapi/v2/account')) return { ok: true, status: 200, json: async () => ({ totalMarginBalance: '125000.50', totalWalletBalance: '120000', totalUnrealizedProfit: '5000.50', availableBalance: '90000' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  }
  if (u.includes('callmebot.com')) { sentMessages.push({ text: new URL(u).searchParams.get('text') || '' }); return { ok: true, status: 200, text: async () => 'Message queued.' }; }
  if (u.includes('binance.com')) { const a = []; let t = 1, p = 60000; for (let i = 0; i < 365; i++) { p *= 1 + Math.sin(i / 9) * 0.012; a.push([t, '0', '0', '0', String(p), '0']); t += 86400000; } return { ok: true, json: async () => a }; }
  if (u.includes('bybit.com')) { const list = []; let t = 365 * 86400000, p = 100; for (let i = 0; i < 365; i++) { p *= 1 + Math.cos(i / 7) * 0.01; list.push([String(t), '0', '0', '0', String(p)]); t -= 86400000; } return { ok: true, json: async () => ({ result: { list } }) }; }
  const data = []; let t = 300 * 86400000, p = 600; for (let i = 0; i < 300; i++) { p *= 1 + Math.sin(i / 5) * 0.011; data.push([String(t), '0', '0', '0', String(p)]); t -= 86400000; } return { ok: true, json: async () => ({ data }) };
};

// configure WhatsApp (enabled) + give admin a phone, key & notify so type:'login'/'daily' route to admins
await call(openwa, { method: 'PUT', headers: authH, body: { enabled: true, drawdownPct: 1, pnlDayThreshold: 99999999 } });
r = await call(profile, { method: 'PATCH', headers: authH, body: { firstName: 'Admin', lastName: 'User', phone: '+33611111111', waApikey: 'cmb-user-key' } });
ok('saving a CallMeBot key (encrypted) auto-enables notifications', r.status === 200 && r.body.user.hasWaApikey === true && r.body.user.notify === true, r.body.user);
q = await db.query("SELECT wa_apikey FROM users WHERE email='admin@lno.company'");
ok('per-user CallMeBot key encrypted in DB (no plaintext)', !String(q.rows[0].wa_apikey || '').includes('cmb-user-key') && String(q.rows[0].wa_apikey).startsWith('v1:'), { v: q.rows[0].wa_apikey });
ok('user gets a welcome WhatsApp when they save their key', sentMessages.some(m => /Welcome to LNO Control Center/i.test(m.text)), sentMessages.map(m => m.text));

// turning notifications OFF must not send a welcome; turning them back ON (key already saved) must
await call(profile, { method: 'PATCH', headers: authH, body: { notify: false } });
sentMessages.length = 0;
r = await call(profile, { method: 'PATCH', headers: authH, body: { notify: true } });
ok('turning notifications ON (off -> on) sends a welcome without re-entering the key', r.body.user.notify === true && sentMessages.some(m => /Welcome to LNO Control Center/i.test(m.text)), sentMessages.map(m => m.text));

// login-failure alert: 3 wrong attempts triggers a WhatsApp to admins
sentMessages.length = 0;
for (let i = 0; i < 3; i++) await call(auth, { method: 'POST', body: { action: 'login', email: 'admin@lno.company', password: 'nope' } });
ok('3 failed logins -> WhatsApp alert sent', sentMessages.some(m => /failed login/i.test(m.text)), sentMessages);

// daily cron: computes metrics + sends report (admin-triggered)
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH });
ok('cron computes risk metrics (sharpe/sortino/drawdown)', r.status === 200 && typeof r.body.metrics.sharpe === 'number' && typeof r.body.metrics.sortino === 'number' && typeof r.body.metrics.maxDrawdownPct === 'number', r.body && r.body.metrics);
ok('cron sends daily report via OpenWA', sentMessages.some(m => /daily report/i.test(m.text)), sentMessages.map(m => (m.text || '').slice(0, 20)));
// report format: bold title, global section, then one bold section per fund (Equity + PnL in USDT • %)
const daily = sentMessages.find(m => /DAILY REPORT/i.test(m.text))?.text || '';
ok('daily report uses the new format (bold title, USDT, PnL day • %)',
  daily.startsWith('*📊 LNO DAILY REPORT*') && /Equity [\d ]+ USDT/.test(daily) && /PnL day [+-][\d ]+ USDT • [+-][\d.]+%/.test(daily),
  daily.slice(0, 120));
ok('cron unauthorized without admin/secret -> 401', (await call(cronDaily, { method: 'POST' })).status === 401);
// every WhatsApp send is recorded in the admin-only message log
r = await call(openwa, { method: 'GET', headers: authH, query: { log: '1' } });
ok('admin WhatsApp log records sent messages', r.status === 200 && Array.isArray(r.body.log) && r.body.log.length >= 1 && typeof r.body.log[0].message === 'string', r.body.log && r.body.log.length);
ok('WhatsApp log resolves the recipient name from the phone', r.body.log.some(l => l.recipientName === 'Admin User'), r.body.log.map(l => l.recipientName));

// global daily-PnL threshold breach (pnlDayThreshold set very high above) + weekly/monthly via force
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH, query: { force: 'all' } });
ok('global daily-PnL threshold breach detected', r.body.breaches.some(b => /daily PnL/i.test(b)), r.body.breaches);
ok('weekly + monthly reports sent (force=all)', r.body.sent.some(s => s.type === 'weekly') && r.body.sent.some(s => s.type === 'monthly'), r.body.sent.map(s => s.type));
// monthly PDF is built + archived (CallMeBot can't attach files, so it's not WhatsApp-sent)
const pdfPart = r.body.sent.find(s => s.type === 'monthly-pdf');
ok('monthly PDF built + archived (not WhatsApp-attached with CallMeBot)', !!pdfPart && !pdfPart.error && pdfPart.bytes > 0, pdfPart);
const { buildMonthlyPdf } = await import('../api/_lib/report.js');
const pdfB64 = await buildMonthlyPdf({ equity: 1e6, pnl30: 5000, openPnl: 1200, exposure: 8e5, maxDrawdownPct: -8, ddDurationDays: 12, sharpe: 1.2, sortino: 1.5, funds: [{ name: 'Core', color: '#10B981', uPnl: 1200, notional: 8e5, bots: [{}] }], dateLabel: '2026-06-15' });
ok('buildMonthlyPdf produces a valid %PDF', Buffer.from(pdfB64, 'base64').slice(0, 5).toString() === '%PDF-', pdfB64.slice(0, 8));

// acknowledgement: cron created an alert (breach) with a code -> webhook acks it -> /api/alerts shows acked
r = await call(alerts, { method: 'GET', headers: authH });
const pending = r.body.alerts.find(al => !al.ackedAt);
ok('cron recorded an acknowledgeable alert', !!pending && !!pending.code, r.body.alerts.slice(0,2));
r = await call(webhook, { method: 'POST', query: {}, body: { event: 'message.received', data: { from: '33600000000@c.us', body: `ACK ${pending.code}` } } });
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

// ── Bots: auto-detected from Binance futures positions, assigned to global funds ──
r = await call(exchanges, { method: 'POST', headers: authH, body: { name: 'binance', label: 'Binance Futures', apiKey: 'BINKEY', apiSecret: 'BINSECRET' } });
ok('admin connects a Binance exchange (read-only key, secret encrypted)', r.status === 201 && r.body.exchange.hasSecret === true, r.body);
const exId = r.body.exchange.id;
// editing without a new secret must KEEP the existing secret (regression)
await call(exchanges, { method: 'PATCH', headers: authH, body: { id: exId, name: 'binance', label: 'Renamed acct', apiKey: 'BINKEY', note: '' } });
const exAfter = (await call(exchanges, { method: 'GET', headers: authH })).body.exchanges.find(e => e.id === exId);
ok('editing an exchange without a new secret keeps the secret', !!exAfter && exAfter.hasSecret === true && exAfter.label === 'Renamed acct', exAfter);
r = await call(bots, { method: 'POST', headers: authH, body: { action: 'sync' } });
ok('sync creates one bot per OPEN futures position', r.status === 200 && r.body.created === 2 && r.body.positions === 2 && r.body.connected === 1, r.body);
ok('sync reads account equity (margin balance)', r.body.totalEquity === 125001, r.body);
r = await call(bots, { method: 'GET', headers: authH });
const adaBot = r.body.bots.find(b => b.symbol === 'ADAUSDT');
ok('a detected pair becomes an unassigned bot id "exchange:symbol"', !!adaBot && adaBot.id === 'binance:ADAUSDT' && adaBot.fundId === null && adaBot.side === 'LONG', adaBot);
ok('flat positions (amt=0) are NOT turned into bots', !r.body.bots.some(b => b.symbol === 'BTCUSDT'), r.body.bots.map(b => b.symbol));
ok('a live equity summary is exposed to the dashboard', r.body.live && r.body.live.equity === 125001 && r.body.live.positions === 2, r.body.live);
await call(funds, { method: 'POST', headers: authH, body: { id: 'f1', name: 'Core Fund', color: '#C9A24D' } });
r = await call(bots, { method: 'PATCH', headers: authH, body: { id: 'binance:ADAUSDT', fundId: 'f1' } });
ok('admin assigns a bot to a fund', r.status === 200 && r.body.bot.fundId === 'f1', r.body);
ok('assigning a bot to a missing fund is rejected -> 400', (await call(bots, { method: 'PATCH', headers: authH, body: { id: 'binance:ADAUSDT', fundId: 'ghost' } })).status === 400);
binancePositions = binancePositions.filter(p => p.symbol !== 'XRPUSDT'); // XRP position closes
await call(bots, { method: 'POST', headers: authH, body: { action: 'sync' } });
r = await call(bots, { method: 'GET', headers: authH });
const xrp = r.body.bots.find(b => b.symbol === 'XRPUSDT');
ok('a vanished position flips the bot to status=closed (kept for history)', xrp && xrp.status === 'closed' && xrp.qty === 0, xrp);
const ada2 = r.body.bots.find(b => b.symbol === 'ADAUSDT');
ok('re-sync updates the open bot AND keeps its fund assignment', ada2 && ada2.status === 'open' && ada2.fundId === 'f1', ada2);
ok('non-admin cannot trigger a sync', [401, 403].includes((await call(bots, { method: 'POST', body: { action: 'sync' } })).status));
r = await call(bots, { method: 'DELETE', headers: authH, body: { id: 'binance:XRPUSDT' } });
ok('admin can delete a bot', r.status === 200 && (await call(bots, { method: 'GET', headers: authH })).body.bots.every(b => b.symbol !== 'XRPUSDT'), r.body);

// ── Funds: global CRUD with colour + colour→emoji mapping ──
r = await call(funds, { method: 'POST', headers: authH, body: { name: 'Growth Fund', color: '#3B82F6' } });
ok('admin creates a global fund with a colour', r.status === 201 && r.body.funds.some(f => f.name === 'Growth Fund' && f.color === '#3B82F6'), r.body.funds);
const growth = (await call(funds, { method: 'GET', headers: authH })).body.funds.find(f => f.name === 'Growth Fund');
r = await call(funds, { method: 'PATCH', headers: authH, body: { id: growth.id, name: 'Growth', color: '#10B981' } });
ok('admin renames/recolours a fund', r.status === 200 && r.body.funds.some(f => f.id === growth.id && f.name === 'Growth' && f.color === '#10B981'), r.body.funds);
const { colorToEmoji } = await import('../api/_lib/colors.js');
ok('fund colour maps to the nearest WhatsApp emoji', colorToEmoji('#10B981') === '🟢' && colorToEmoji('#3B82F6') === '🔵' && colorToEmoji('#EF4444') === '🔴', { g: colorToEmoji('#10B981'), b: colorToEmoji('#3B82F6'), r: colorToEmoji('#EF4444') });
await call(bots, { method: 'PATCH', headers: authH, body: { id: 'binance:ADAUSDT', fundId: growth.id } });
r = await call(funds, { method: 'DELETE', headers: authH, body: { id: growth.id } });
ok('deleting a fund unassigns its bots', r.status === 200 && !r.body.funds.some(f => f.id === growth.id), r.body.funds);
ok('the bot is unassigned after its fund is deleted', (await call(bots, { method: 'GET', headers: authH })).body.bots.find(b => b.id === 'binance:ADAUSDT').fundId === null);

// the WhatsApp report groups open bots under their fund, with the fund's colour emoji
await call(funds, { method: 'POST', headers: authH, body: { id: 'fg', name: 'Greens', color: '#10B981' } });
await call(bots, { method: 'PATCH', headers: authH, body: { id: 'binance:ADAUSDT', fundId: 'fg' } });
sentMessages.length = 0;
await call(cronDaily, { method: 'POST', headers: authH });
const rep = sentMessages.find(m => /DAILY REPORT/i.test(m.text))?.text || '';
ok('report groups bots under their fund with a colour emoji', /🟢 \*Greens\*/.test(rep) && /ADAUSDT/.test(rep), rep.slice(0, 240));

// shareholder role — admin-created, EXTERNAL email, policy-checked password (no username)
r = await call(users, { method: 'POST', headers: authH, body: { email: 'investor@example.com', role: 'shareholder', password: 'Str0ng#Passw0rd!' } });
ok('shareholder created with external email + password (auth_provider=password)',
  r.status === 201 && r.body.user.authProvider === 'password' && r.body.user.email === 'investor@example.com', r.body.user);
ok('shareholder role grants exactly [view_activity, view_reports]',
  r.status === 201 && JSON.stringify((r.body.user.permissions || []).slice().sort()) === JSON.stringify(['view_activity', 'view_reports']), r.body.user && r.body.user.permissions);
// the shareholder signs in with their EMAIL + password
r = await call(auth, { method: 'POST', body: { action: 'login', email: 'investor@example.com', password: 'Str0ng#Passw0rd!' } });
ok('shareholder signs in with email + password', r.status === 200 && !!r.body.token, r.status);
// shareholder opts into WhatsApp -> gets a "new report available" notice when a report is generated
const shH = { authorization: 'Bearer ' + r.body.token };
await call(profile, { method: 'PATCH', headers: shH, body: { phone: '+33655555555', waApikey: 'sh-cmb-key' } });
sentMessages.length = 0;
await call(snapshots, { method: 'POST', headers: authH, body: { action: 'generateReport' } });
ok('shareholder gets a "new report available" WhatsApp on report generation', sentMessages.some(m => /report is available/i.test(m.text)), sentMessages.map(m => m.text));
// per-type/per-role matrix: disabling new_report stops the notice (no shareholder gets it)
await call(openwa, { method: 'PUT', headers: authH, body: { notifMatrix: { new_report: [] } } });
sentMessages.length = 0;
await call(snapshots, { method: 'POST', headers: authH, body: { action: 'generateReport' } });
ok('disabling a type in the matrix stops that notification', !sentMessages.some(m => /report is available/i.test(m.text)), sentMessages.map(m => m.text));
await call(openwa, { method: 'PUT', headers: authH, body: { notifMatrix: { new_report: ['shareholder'] } } }); // restore

// admin sets a NEW password for a password (non-Google) account; Google accounts are refused
const allUsers = (await call(users, { method: 'GET', headers: authH })).body.users;
const shUser = allUsers.find(u => u.email === 'investor@example.com');
const googleUser = allUsers.find(u => u.email === 'nina.test@lno.company');
r = await call(users, { method: 'PATCH', headers: authH, body: { id: shUser.id, password: 'N3w#Strong#Pass!' } });
ok('admin sets a new password for a non-Google user', r.status === 200, r.body);
r = await call(auth, { method: 'POST', body: { action: 'login', email: 'investor@example.com', password: 'N3w#Strong#Pass!' } });
ok('user can sign in with the admin-set password', r.status === 200 && !!r.body.token, r.status);
r = await call(auth, { method: 'POST', body: { action: 'login', email: 'investor@example.com', password: 'Str0ng#Passw0rd!' } });
ok('the previous password no longer works', r.status === 401, r.status);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: shUser.id, password: 'weak' } });
ok('admin-set weak password rejected by policy -> 400', r.status === 400, r.body);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: googleUser.id, password: 'N3w#Strong#Pass!' } });
ok('admin cannot set a password on a Google account -> 400', r.status === 400, r.body);

// weak password is rejected by the policy
r = await call(users, { method: 'POST', headers: authH, body: { email: 'weak@example.com', role: 'shareholder', password: 'short' } });
ok('weak shareholder password rejected -> 400', r.status === 400 && /Password needs/.test(r.body.error || ''), r.body);
// internal roles still must use an @lno.company email (Google)
r = await call(users, { method: 'POST', headers: authH, body: { email: 'someone@gmail.com', role: 'viewer' } });
ok('non-shareholder external email rejected -> 400', r.status === 400 && /@lno\.company/.test(r.body.error || ''), r.body);
// non-admin (operator) can read the archive but cannot generate a report
r = await call(auth, { method: 'POST', body: { action: 'login', email: 'sophie.ops@lno.company', password: 'admin' } });
const opH = { authorization: 'Bearer ' + r.body.token };
r = await call(snapshots, { method: 'POST', headers: opH, body: { action: 'generateReport' } });
ok('non-admin cannot generate a report -> 403', r.status === 403, r.status);
r = await call(snapshots, { method: 'GET', headers: opH, query: { reports: 'list' } });
ok('any authenticated user can list the report archive', r.status === 200 && Array.isArray(r.body.reports), r.status);

// login audit: IP + last-login recorded, heartbeat updates last-seen, history endpoint
r = await call(auth, { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, body: { action: 'login', email: 'admin@lno.company', password: 'admin' } });
ok('login records client IP + last-login on the user', r.status === 200 && r.body.user.lastIp === '203.0.113.7' && !!r.body.user.lastLoginAt, r.body.user);
const hbH = { authorization: 'Bearer ' + r.body.token };
r = await call(auth, { method: 'POST', headers: { ...hbH, 'x-forwarded-for': '198.51.100.4' }, body: { action: 'heartbeat' } });
ok('presence heartbeat -> 200', r.status === 200 && r.body.ok === true, r.body);
r = await call(users, { method: 'GET', headers: authH });
const adminRow = r.body.users.find(u => u.email === 'admin@lno.company');
r = await call(users, { method: 'GET', headers: authH, query: { logins: adminRow.id } });
ok('per-user sign-in history lists the recorded IP + method', r.status === 200 && r.body.logins.some(l => l.ip === '203.0.113.7' && l.method === 'password'), r.body.logins);

// Sign in with Google — verification stubbed (real flow verifies the Google JWKS signature).
globalThis.__GOOGLE_VERIFY__ = async (cred) => JSON.parse(Buffer.from(cred, 'base64').toString());
const gcred = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'alice.new@lno.company', email_verified: true, hd: 'lno.company', given_name: 'Alice', family_name: 'New' }) } });
ok('Google sign-in auto-creates an @lno.company user (viewer, names saved)',
  r.status === 200 && r.body.user.email === 'alice.new@lno.company' && r.body.user.role === 'viewer' && r.body.user.firstName === 'Alice' && r.body.user.lastName === 'New' && r.body.user.authProvider === 'google' && !!r.body.token, r.body);
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'mallory@evil.com', email_verified: true, given_name: 'M', family_name: 'X' }) } });
ok('Google sign-in rejects a non-@lno.company domain -> 403', r.status === 403, r.status);
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'bob@lno.company', email_verified: false, hd: 'lno.company' }) } });
ok('Google sign-in rejects an unverified email -> 403', r.status === 403, r.status);
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'alice.new@lno.company', email_verified: true, hd: 'lno.company', given_name: 'Alice', family_name: 'Renamed' }) } });
ok('repeat Google sign-in updates names, keeps same account', r.status === 200 && r.body.user.lastName === 'Renamed', r.body.user);
r = await call(users, { method: 'GET', headers: authH });
ok('no duplicate account for repeat Google sign-in', r.body.users.filter(x => x.email === 'alice.new@lno.company').length === 1, r.body.users.filter(x => x.email === 'alice.new@lno.company').length);
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'admin@lno.company', email_verified: true, hd: 'lno.company', given_name: 'Admin', family_name: 'User' }) } });
ok('Google sign-in links an existing account by email (keeps admin role)', r.status === 200 && r.body.user.email === 'admin@lno.company' && r.body.user.role === 'admin', r.body.user);
delete globalThis.__GOOGLE_VERIFY__;

// ── Reset: wipe trading/demo data, keep users + config (admin only) — run last ──
r = await call(init, { method: 'POST', body: { action: 'reset' } });
ok('non-admin cannot reset -> 401/403', [401, 403].includes(r.status), r.status);
r = await call(init, { method: 'POST', headers: authH, body: { action: 'reset' } });
ok('admin reset wipes trading data', r.status === 200 && r.body.reset === true, r.body);
ok('reset keeps user accounts', (await call(users, { method: 'GET', headers: authH })).body.users.length >= 1);
ok('reset clears bots + funds + exchanges',
  (await call(bots, { method: 'GET', headers: authH })).body.bots.length === 0 &&
  (await call(funds, { method: 'GET', headers: authH })).body.funds.length === 0 &&
  (await call(exchanges, { method: 'GET', headers: authH })).body.exchanges.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
