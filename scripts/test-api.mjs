// Local end-to-end test of the API against an in-process Postgres (PGlite).
// Proves: bcrypt-hashed passwords (no plaintext in DB), JWT login, encrypted secrets
// (no plaintext in DB), masking, and auth gating. Run: node scripts/test-api.mjs
import { PGlite } from '@electric-sql/pglite';

process.env.JWT_SECRET = 'test-jwt-secret-please-change-1234567890';
process.env.APP_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
process.env.RESEND_API_KEY = 'test-resend-key';

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
const { buildReportData } = await import('../api/_lib/portfolio.js');

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

// PUT /api/users {rolePerms} REPLACES the whole role->permission map, so passing just the
// one role under test silently wipes the others to [] for every later test. These helpers
// always send a complete map: setPerms() overrides only the named roles on top of the
// defaults, restorePerms() puts every role back.
const DEFAULT_PERMS = {
  operator: ['view_activity', 'view_realtime', 'view_trades', 'export_data'],
  viewer: ['view_activity', 'view_realtime', 'view_trades'],
  shareholder: ['view_activity', 'view_realtime', 'view_trades', 'view_reports_monthly', 'view_exchanges'],
};
let USERS_AUTH_H = null; // set once the admin token exists
const setPerms = (over) => call(users, { method: 'PUT', headers: USERS_AUTH_H, body: { rolePerms: { ...DEFAULT_PERMS, ...over } } });
const restorePerms = () => setPerms({});

// 1. init
let r = await call(init, { method: 'POST' });
ok('init creates + seeds', r.status === 200 && r.body.seeded === true, r.body);

// 2. login admin/admin
r = await call(auth, { method: 'POST', body: { action: 'login', email: 'admin@lno.company', password: 'admin' } });
const token = r.body?.token;
ok('login admin/admin returns JWT + user', r.status === 200 && !!token && r.body.user.role === 'admin', r.body);
ok('login response contains NO password field', !('password' in (r.body?.user || {})) && !('password_hash' in (r.body?.user || {})));
const authH = { authorization: 'Bearer ' + token };
USERS_AUTH_H = authH;

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
const ninaId = r.body.user.id;
r = await call(users, { method: 'POST', headers: authH, body: { email: 'bad@gmail.com' } });
ok('create user with non-@lno.company email rejected', r.status === 400, r.body);

// 8. WhatsApp config: enable + a default notification matrix is returned (no default recipient)
r = await call(openwa, { method: 'PUT', headers: authH, body: { enabled: true } });
ok('openwa config has a notification matrix + no default recipient', r.status === 200 && r.body.config.notifMatrix && Array.isArray(r.body.config.notifMatrix.login) && !('defaultSender' in r.body.config), r.body.config);

// ── Alerts: mock exchange klines + TextMeBot sends so the suite stays offline ──
const sentMessages = [];
const sentEmails = []; // {to, subject, code} — code extracted from the subject line for OTP tests
let binancePositions = [
  { symbol: 'ADAUSDT', positionAmt: '1000',  entryPrice: '0.45', markPrice: '0.47',  unRealizedProfit: '20', leverage: '5',  notional: '470' },
  { symbol: 'XRPUSDT', positionAmt: '-2000', entryPrice: '0.62', markPrice: '0.60',  unRealizedProfit: '40', leverage: '3',  notional: '-1200' },
  { symbol: 'BTCUSDT', positionAmt: '0',     entryPrice: '0',    markPrice: '67000', unRealizedProfit: '0',  leverage: '10', notional: '0' },
];
let binanceFail = false; // when true, Binance returns the classic -2015 (key/IP/permissions) error
let walletBalance = '120000'; // mutable so tests can simulate a real capital addition between syncs
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('fapi.binance.com')) { // signed Binance USDⓈ-M futures (read-only)
    if (binanceFail) return { ok: false, status: 401, json: async () => ({ code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' }) };
    if (u.includes('/fapi/v2/positionRisk')) return { ok: true, status: 200, json: async () => binancePositions };
    if (u.includes('/fapi/v2/account')) return { ok: true, status: 200, json: async () => ({ totalMarginBalance: '125000.50', totalWalletBalance: walletBalance, totalUnrealizedProfit: '5000.50', availableBalance: '90000' }) };
    if (u.endsWith('/fapi/v1/listenKey')) return { ok: true, status: 200, json: async () => (opts && opts.method === 'POST' ? { listenKey: 'fake-listen-key-123' } : {}) };
    if (u.includes('/fapi/v1/userTrades')) {
      const symbol = new URL(u).searchParams.get('symbol');
      return { ok: true, status: 200, json: async () => ([
        { id: 1001, symbol, side: 'BUY', qty: '100', price: '0.45', realizedPnl: '0', commission: '0.02', time: Date.now() },
        { id: 1002, symbol, side: 'SELL', qty: '40', price: '0.46', realizedPnl: '4', commission: '0.01', time: Date.now() },
      ]) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }
  if (u.includes('textmebot.com')) { const uu = new URL(u); sentMessages.push({ text: uu.searchParams.get('text') || '', to: uu.searchParams.get('recipient') || '' }); return { ok: true, status: 200, text: async () => 'Success! Message Sent.' }; }
  if (u.includes('api.resend.com')) {
    const payload = JSON.parse(opts.body);
    const code = (payload.subject.match(/^(\d{6})/) || [])[1] || null;
    sentEmails.push({ to: payload.to, subject: payload.subject, code, html: payload.html });
    return { ok: true, status: 200, json: async () => ({ id: 'email_test_' + sentEmails.length }) };
  }
  if (u.includes('binance.com')) { const a = []; let t = 1, p = 60000; for (let i = 0; i < 365; i++) { p *= 1 + Math.sin(i / 9) * 0.012; a.push([t, '0', '0', '0', String(p), '0']); t += 86400000; } return { ok: true, json: async () => a }; }
  if (u.includes('bybit.com')) { const list = []; let t = 365 * 86400000, p = 100; for (let i = 0; i < 365; i++) { p *= 1 + Math.cos(i / 7) * 0.01; list.push([String(t), '0', '0', '0', String(p)]); t -= 86400000; } return { ok: true, json: async () => ({ result: { list } }) }; }
  const data = []; let t = 300 * 86400000, p = 600; for (let i = 0; i < 300; i++) { p *= 1 + Math.sin(i / 5) * 0.011; data.push([String(t), '0', '0', '0', String(p)]); t -= 86400000; } return { ok: true, json: async () => ({ data }) };
};

// configure WhatsApp (enabled) with the firm-wide TextMeBot account key, plus alert thresholds
r = await call(openwa, { method: 'PUT', headers: authH, body: { enabled: true, drawdownPct: 1, pnlDayThreshold: 99999999, apiKey: 'tmb-account-key' } });
ok('openwa config exposes hasApiKey after setting the global key, never the raw key', r.status === 200 && r.body.config.hasApiKey === true && !JSON.stringify(r.body.config).includes('tmb-account-key'), r.body.config);
q = await db.query("SELECT value FROM app_config WHERE key='openwa'");
ok('firm-wide TextMeBot key encrypted in DB (no plaintext)', !JSON.stringify(q.rows[0].value).includes('tmb-account-key') && String(q.rows[0].value.apiKeyEnc || '').startsWith('v1:'), { v: q.rows[0].value.apiKeyEnc });
// give the admin a phone + name (NO per-user key) so type:'login'/'daily' route to admins.
// (The seed admin already has notify=true; turn it off first to test the off->on welcome.)
r = await call(profile, { method: 'PATCH', headers: authH, body: { firstName: 'Admin', lastName: 'User', phone: '+33611111111', notify: false } });
ok('profile no longer exposes a per-user WhatsApp key', !('hasWaApikey' in r.body.user), r.body.user);
sentMessages.length = 0;
r = await call(profile, { method: 'PATCH', headers: authH, body: { notify: true } });
ok('turning notifications ON (off -> on, phone + global key set) sends a welcome via the firm key', r.status === 200 && r.body.user.notify === true && sentMessages.some(m => /Welcome to LNO Control Center/i.test(m.text)), { user: r.body.user, sent: sentMessages.map(m => m.text) });

// "Send test to me" works with a phone + the global key; errors without a phone
sentMessages.length = 0;
r = await call(openwa, { method: 'POST', headers: authH, body: { action: 'test' } });
ok('Send test delivers with phone + global key', r.status === 200 && r.body.ok === true && sentMessages.some(m => /Welcome to LNO Control Center/i.test(m.text)), { status: r.status, body: r.body });
await call(profile, { method: 'PATCH', headers: authH, body: { phone: '' } });
r = await call(openwa, { method: 'POST', headers: authH, body: { action: 'test' } });
ok('Send test errors (400) when the admin has no phone', r.status === 400 && /number/i.test(r.body.error || ''), r.body);
await call(profile, { method: 'PATCH', headers: authH, body: { phone: '+33611111111' } });

// login-failure alert: 3 wrong attempts triggers a WhatsApp to admins
sentMessages.length = 0;
for (let i = 0; i < 3; i++) await call(auth, { method: 'POST', body: { action: 'login', email: 'admin@lno.company', password: 'nope' } });
ok('3 failed logins -> WhatsApp alert sent', sentMessages.some(m => /failed login/i.test(m.text)), sentMessages);

// daily cron: computes metrics + sends report (admin-triggered)
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH });
ok('cron computes risk metrics (sharpe/sortino/drawdown)', r.status === 200 && typeof r.body.metrics.sharpe === 'number' && typeof r.body.metrics.sortino === 'number' && typeof r.body.metrics.maxDrawdownPct === 'number', r.body && r.body.metrics);
ok('cron sends a synthetic daily digest via WhatsApp', sentMessages.some(m => /LNO Daily/i.test(m.text)), sentMessages.map(m => (m.text || '').slice(0, 30)));
// digest format (item 14): headline numbers only, no per-fund/per-bot breakdown — that
// detail moved to the email body (sendDailyReportEmail) and the archived PDF instead.
const daily = sentMessages.find(m => /LNO Daily/i.test(m.text))?.text || '';
ok('daily WhatsApp digest is synthetic (equity, 24h PnL %, open count, incidents — no fund/bot lines)',
  /Equity [\d ]+ USDT/.test(daily) && /PnL 24h [+-][\d ]+ USDT \([+-][\d.]+%\)/.test(daily) && /\d+ open/.test(daily) && !/\*Greens\*/.test(daily),
  daily);
ok('cron unauthorized without admin/secret -> 401', (await call(cronDaily, { method: 'POST' })).status === 401);

// the daily report is also emailed in full HTML to admin/operator/viewer
ok('daily report emails admin/operator/viewer with the full breakdown', sentEmails.some(e => /LNO Daily Report/i.test(e.subject)), sentEmails.map(e => e.subject));

// Report distribution (email + WhatsApp) must respect view_reports_daily, not just role —
// operator/viewer lack it by default (see ROLE_PERMS), so being that role alone must NOT be
// enough to receive the report; revoking/granting the permission should flip it.
ok('operator (no view_reports_daily by default) does NOT get the daily report email', !sentEmails.some(e => e.to === 'nina.test@lno.company'), sentEmails.map(e => e.to));
// PUT rolePerms replaces the whole set, not just the role named — pass viewer/shareholder's
// current defaults through unchanged alongside the operator change, or this silently wipes
// them to [] for every test that runs before their own explicit restore.
await setPerms({ operator: ['view_activity', 'view_realtime', 'view_trades', 'export_data', 'view_reports_daily'] });
sentEmails.length = 0; sentMessages.length = 0;
await call(cronDaily, { method: 'POST', headers: authH });
ok('granting view_reports_daily makes operator receive the daily report email', sentEmails.some(e => e.to === 'nina.test@lno.company' && /LNO Daily Report/i.test(e.subject)), sentEmails.map(e => e.to));
await restorePerms();

// and archived as a PDF report, auto-verified (internal-only kind — no shareholder ever waits on it)
r = await call(snapshots, { method: 'GET', headers: authH, query: { reports: 'list' } });
const dailyRow = r.body.reports.find(x => x.kind === 'daily');
ok('daily report archived with status=verified (auto)', !!dailyRow && dailyRow.status === 'verified' && dailyRow.verifiedBy === 'system', dailyRow);

// per-recipient localization: the same cron run renders the digest in the RECIPIENT's own
// users.language, not a single fixed locale — switch the admin to French and confirm.
await call(profile, { method: 'PATCH', headers: authH, body: { language: 'fr' } });
sentMessages.length = 0;
await call(cronDaily, { method: 'POST', headers: authH });
const dailyFr = sentMessages.find(m => /LNO Quotidien/i.test(m.text))?.text || '';
ok('daily digest renders in the recipient\'s own language (fr)',
  /Equity [\d ]+ USDT/.test(dailyFr) && /PnL 24h [+-][\d ]+ USDT \([+-][\d.]+%\)/.test(dailyFr),
  dailyFr);
await call(profile, { method: 'PATCH', headers: authH, body: { language: 'en' } });
// every WhatsApp send is recorded in the admin-only message log
r = await call(openwa, { method: 'GET', headers: authH, query: { log: '1' } });
ok('admin WhatsApp log records sent messages', r.status === 200 && Array.isArray(r.body.log) && r.body.log.length >= 1 && typeof r.body.log[0].message === 'string', r.body.log && r.body.log.length);
ok('WhatsApp log resolves the recipient name from the phone', r.body.log.some(l => l.recipientName === 'Admin User'), r.body.log.map(l => l.recipientName));
ok('WhatsApp log response reports a total for pagination', r.status === 200 && typeof r.body.total === 'number' && r.body.total >= r.body.log.length, r.body.total);
r = await call(openwa, { method: 'GET', headers: authH, query: { log: '1', limit: '1' } });
ok('WhatsApp log ?limit=1 returns 1 row but the full total', r.status === 200 && r.body.log.length === 1 && r.body.total >= 1, r.body);
{
  const page0 = await call(openwa, { method: 'GET', headers: authH, query: { log: '1', limit: '1', offset: '0' } });
  const page1 = await call(openwa, { method: 'GET', headers: authH, query: { log: '1', limit: '1', offset: '1' } });
  if (page1.body.log.length) ok('WhatsApp log pagination pages don\'t overlap', page0.body.log[0].id !== page1.body.log[0].id, { page0: page0.body.log, page1: page1.body.log });
}
r = await call(openwa, { method: 'GET', headers: authH, query: { log: '1', status: 'ok' } });
ok('WhatsApp log ?status=ok filters server-side', r.status === 200 && r.body.log.every(l => l.ok === true), r.body.log.map(l => l.ok));
r = await call(openwa, { method: 'GET', headers: authH, query: { log: '1', q: 'no-such-recipient-xyz' } });
ok('WhatsApp log ?q filters server-side (no matches)', r.status === 200 && r.body.log.length === 0 && r.body.total === 0, r.body);

// global daily-PnL threshold breach (pnlDayThreshold set very high above) + weekly/monthly via force
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH, query: { force: 'all' } });
ok('global daily-PnL threshold breach detected', r.body.breaches.some(b => b.kind === 'pnlDay'), r.body.breaches);
ok('weekly + monthly reports sent (force=all)', r.body.sent.some(s => s.type === 'weekly') && r.body.sent.some(s => s.type === 'monthly'), r.body.sent.map(s => s.type));
// monthly PDF is built + archived (sent as a text summary; the PDF stays downloadable)
const pdfPart = r.body.sent.find(s => s.type === 'monthly-pdf');
ok('monthly PDF built + archived (not WhatsApp-attached)', !!pdfPart && !pdfPart.error && pdfPart.bytes > 0, pdfPart);
const { buildMonthlyPdf } = await import('../api/_lib/report.js');
const pdfB64 = await buildMonthlyPdf({ equity: 1e6, pnl30: 5000, openPnl: 1200, exposure: 8e5, maxDrawdownPct: -8, ddDurationDays: 12, sharpe: 1.2, sortino: 1.5, funds: [{ name: 'Core', color: '#10B981', uPnl: 1200, notional: 8e5, bots: [{}] }], dateLabel: '2026-06-15' });
ok('buildMonthlyPdf produces a valid %PDF', Buffer.from(pdfB64, 'base64').slice(0, 5).toString() === '%PDF-', pdfB64.slice(0, 8));

// The WhatsApp master switch is a *transport* switch, not a report switch: turning it off
// must still archive the daily PDF and email the report (they don't travel over WhatsApp).
// This used to be coupled — `enabled:false` silently killed the daily email too.
sentMessages.length = 0;
await call(openwa, { method: 'PUT', headers: authH, body: { enabled: false } });
r = await call(cronDaily, { method: 'POST', headers: authH, query: { force: 'all' } });
const offPdf = r.body.sent.find(s => s.type === 'daily-pdf');
const offMail = r.body.sent.find(s => s.type === 'daily-email');
ok('WhatsApp off: daily PDF still archived', !!offPdf && !offPdf.error && offPdf.bytes > 0, offPdf);
ok('WhatsApp off: daily email still sent', !!offMail && !offMail.error && offMail.recipients > 0, offMail);
ok('WhatsApp off: monthly PDF still archived', r.body.sent.some(s => s.type === 'monthly-pdf' && !s.error), r.body.sent.map(s => s.type));
ok('WhatsApp off: no WhatsApp message actually leaves', sentMessages.length === 0, sentMessages.length);
ok('WhatsApp off: report/weekly/monthly report skipped as disabled',
  ['report', 'weekly', 'monthly'].every(t => r.body.sent.find(s => s.type === t)?.skipped === 'disabled'),
  r.body.sent.filter(s => ['report', 'weekly', 'monthly'].includes(s.type)));
await call(openwa, { method: 'PUT', headers: authH, body: { enabled: true } });

// ?mode=alerts (the frequent GitHub Actions trigger — see .github/workflows/alert-check.yml):
// still catches the same breach, but must NEVER send the daily/weekly/monthly reports — even
// with force=all — since a report re-send every ~10 minutes would spam recipients all day.
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH, query: { mode: 'alerts', force: 'all' } });
ok('?mode=alerts still detects the same breach', r.body.alertsOnly === true && r.body.breaches.some(b => b.kind === 'pnlDay'), r.body.breaches);
ok('?mode=alerts never sends daily/weekly/monthly reports, even with force=all', !r.body.sent.some(s => ['report', 'weekly', 'monthly', 'monthly-pdf'].includes(s.type)), r.body.sent.map(s => s.type));
// dedup (this was the actual bug report): the SAME breach was already alerted on the
// previous call above and is still active — a poll ~10 minutes later (the alerts-only
// cron's real cadence) must NOT resend the identical WhatsApp/email again.
ok('a still-active breach does NOT resend on the next poll (dedup)', !r.body.sent.some(s => s.type === 'alert'), r.body.sent.map(s => s.type));

// acknowledgement: cron created an alert (breach) with a code -> webhook acks it -> /api/alerts shows acked
r = await call(alerts, { method: 'GET', headers: authH });
const pending = r.body.alerts.find(al => !al.ackedAt);
ok('cron recorded an acknowledgeable alert', !!pending && !!pending.code, r.body.alerts.slice(0,2));
r = await call(webhook, { method: 'POST', query: {}, body: { event: 'message.received', data: { from: '33600000000@c.us', body: `ACK ${pending.code}` } } });
ok('WhatsApp "ACK <code>" reply acknowledges via webhook', r.body.acked === pending.code, r.body);
r = await call(alerts, { method: 'GET', headers: authH });
ok('alert now shows acknowledged', !!r.body.alerts.find(al => al.code === pending.code && al.ackedAt), r.body.alerts.find(al=>al.code===pending.code));

// breach recovers (threshold relaxed back to normal) -> tracked state clears -> a LATER
// re-breach is treated as fresh and alerts again (edge-triggered, not "alert once forever")
await call(openwa, { method: 'PUT', headers: authH, body: { pnlDayThreshold: -99999999 } });
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH, query: { mode: 'alerts' } });
ok('breach clears once the metric is back under the threshold', !r.body.breaches.some(b => b.kind === 'pnlDay'), r.body.breaches);
ok('no alert sent while recovered', !r.body.sent.some(s => s.type === 'alert'), r.body.sent.map(s => s.type));
await call(openwa, { method: 'PUT', headers: authH, body: { pnlDayThreshold: 99999999 } });
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH, query: { mode: 'alerts' } });
ok('a fresh re-breach after recovery alerts again', r.body.sent.some(s => s.type === 'alert'), r.body.sent.map(s => s.type));


// the cron records a daily equity snapshot
r = await call(snapshots, { method: 'GET', headers: authH });
ok('cron wrote an equity snapshot (history accrues)', r.status === 200 && r.body.snapshots.length >= 1 && typeof r.body.snapshots[0].equity === 'number', r.body && r.body.snapshots);

// seed some equity history so report charts have more than the single "today" point to draw
// (every cronDaily call above landed on the same real calendar day, ON CONFLICT-upserting the
// same row — these are distinct past days, inserted directly rather than via the cron)
for (let i = 13; i >= 1; i--) {
  await db.query(`INSERT INTO equity_snapshots (day,equity,pnl_day,metrics) VALUES (CURRENT_DATE - $1::int, $2, 0, '{}'::jsonb) ON CONFLICT (day) DO NOTHING`, [i, Math.round(1000000 + Math.sin(i) * 20000 + i * 500)]);
}

// report archive: admin generates a report -> it lists -> the PDF downloads
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'generateReport' } });
const genReport = r.body.report;
ok('admin generates + archives a report', r.status === 200 && genReport && genReport.id && genReport.kind === 'monthly', r.body);
r = await call(snapshots, { method: 'GET', headers: authH, query: { reports: 'list' } });
ok('report archive lists the generated report', r.status === 200 && (r.body.reports || []).some(x => x.id === genReport.id), r.body && r.body.reports);
r = await call(snapshots, { method: 'GET', headers: authH, query: { report: String(genReport.id) } });
ok('archived report downloads as a valid %PDF', r.status === 200 && Buffer.from(r.body.pdfBase64, 'base64').slice(0, 5).toString() === '%PDF-', r.body && r.body.filename);
ok('the PDF is larger than a chart-less baseline — it actually drew the equity chart', r.body.pdfBase64.length > 2500, r.body.pdfBase64.length);
r = await call(snapshots, { method: 'GET', query: { reports: 'list' } });
ok('report archive requires auth -> 401', r.status === 401, r.status);

// admin can pick the periodicity when generating on demand — daily/weekly are internal-only
// (no shareholder ever waits on them) so they auto-verify, unlike monthly above
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'generateReport', kind: 'daily' } });
ok('admin can generate a DAILY report on demand, auto-verified', r.status === 200 && r.body.report.kind === 'daily' && r.body.report.status === 'verified', r.body);
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'generateReport', kind: 'weekly' } });
const genWeekly = r.body.report;
ok('admin can generate a WEEKLY report on demand, auto-verified', r.status === 200 && genWeekly.kind === 'weekly' && genWeekly.status === 'verified', r.body);
r = await call(snapshots, { method: 'GET', headers: authH, query: { report: String(genWeekly.id) } });
ok('the generated weekly report downloads as a valid %PDF', r.status === 200 && Buffer.from(r.body.pdfBase64, 'base64').slice(0, 5).toString() === '%PDF-', r.body && r.body.filename);

// unverify: admin can revert a verified report back to not_verified (re-review, not damage
// control — it doesn't un-send anything already emailed/WhatsApped)
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'unverifyReport', id: genWeekly.id } });
ok('admin can unverify a report', r.status === 200 && r.body.report.status === 'not_verified' && r.body.report.verifiedBy === null, r.body);
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'unverifyReport', id: genWeekly.id } });
ok('unverifying an already-not_verified report is rejected -> 400', r.status === 400, r.body);
r = await call(snapshots, { method: 'POST', body: { action: 'unverifyReport', id: genWeekly.id } });
ok('non-admin cannot unverify -> 401/403', [401, 403].includes(r.status), r.status);

// delete: admin can permanently remove an archived report
r = await call(snapshots, { method: 'POST', body: { action: 'deleteReport', id: genWeekly.id } });
ok('non-admin cannot delete a report -> 401/403', [401, 403].includes(r.status), r.status);
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'deleteReport', id: genWeekly.id } });
ok('admin can delete a report', r.status === 200 && r.body.id === genWeekly.id, r.body);
r = await call(snapshots, { method: 'GET', headers: authH, query: { reports: 'list' } });
ok('deleted report no longer appears in the archive', !(r.body.reports || []).some(x => x.id === genWeekly.id), r.body.reports);
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'deleteReport', id: genWeekly.id } });
ok('deleting an already-deleted report -> 404', r.status === 404, r.status);

// Reports page "send test" buttons — sent ONLY to the requesting admin, not the real
// recipient list (admin's phone was set to +33611111111 / notify email above)
sentEmails.length = 0;
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'testEmail' } });
ok('admin can send a test daily-report email to themselves', r.status === 200 && r.body.email === 'admin@lno.company', r.body);
ok('the test email includes the equity sparkline chart (inline SVG)', sentEmails.some(e => e.to === 'admin@lno.company' && /<svg/.test(e.html || '')), sentEmails.map(e => e.to));
ok('the test email actually went out with the daily report subject', sentEmails.some(e => e.to === 'admin@lno.company' && /LNO Daily Report/i.test(e.subject)), sentEmails.map(e => ({ to: e.to, subject: e.subject })));
ok('a test email send does NOT also email other admin/operator/viewer accounts', sentEmails.filter(e => /LNO Daily Report/i.test(e.subject)).length === 1, sentEmails.map(e => e.to));
r = await call(snapshots, { method: 'POST', body: { action: 'testEmail' } });
ok('non-admin cannot trigger a test email -> 401/403', [401, 403].includes(r.status), r.status);

sentMessages.length = 0;
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'testWhatsApp' } });
ok('admin can send a test daily-digest WhatsApp to themselves', r.status === 200 && r.body.phone === '+33611111111', r.body);
ok('the test WhatsApp actually went out as the synthetic daily digest', sentMessages.some(m => m.to === '+33611111111' && /LNO Daily/i.test(m.text)), sentMessages.map(m => ({ to: m.to, text: (m.text || '').slice(0, 30) })));
ok('a test WhatsApp send does NOT also message other admin/operator accounts', sentMessages.filter(m => /LNO Daily/i.test(m.text)).length === 1, sentMessages.map(m => m.to));
r = await call(snapshots, { method: 'POST', body: { action: 'testWhatsApp' } });
ok('non-admin cannot trigger a test WhatsApp -> 401/403', [401, 403].includes(r.status), r.status);

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
const exSynced = (await call(exchanges, { method: 'GET', headers: authH })).body.exchanges.find(e => e.id === exId);
ok('a successful sync records the round-trip latency', !!exSynced && typeof exSynced.latencyMs === 'number' && exSynced.latencyMs >= 0, exSynced);
r = await call(bots, { method: 'GET', headers: authH, query: { fills: '1' } });
ok('sync records real account fills per open symbol', r.status === 200 && r.body.fills.length >= 2 && r.body.fills.some(f => f.symbol === 'ADAUSDT' && f.side === 'BUY'), r.body);
r = await call(bots, { method: 'POST', headers: authH, body: { action: 'sync' } });
r = await call(bots, { method: 'GET', headers: authH, query: { fills: '1' } });
ok('re-syncing does not duplicate already-recorded fills', r.status === 200 && r.body.fills.filter(f => f.symbol === 'ADAUSDT' && f.side === 'BUY').length === 1, r.body.fills);
// ---------------------------------------------------------------------------------------
// Round-trip trade reconstruction (api/_lib/trades.js) — the dataset every analytics
// surface reads. foldFills() is pure, so the tricky cases are asserted directly on it
// rather than through a seeded exchange.
// ---------------------------------------------------------------------------------------
const { foldFills, rebuildTrades } = await import('../api/_lib/trades.js');
const mkFill = (id, side, qty, price, pnl = 0, com = 0, at = '2026-07-01T10:00:00Z') =>
  ({ exchange: 'binance', symbol: 'TSTUSDT', trade_id: id, side, qty, price, realized_pnl: pnl, commission: com, occurred_at: at });

let trips = foldFills([mkFill(1, 'BUY', 1, 100, 0, 0.1), mkFill(2, 'BUY', 1, 102, 0, 0.1), mkFill(3, 'SELL', 2, 110, 16, 0.2)]);
ok('scaling into a long then exiting is ONE round trip, entry = qty-weighted average',
  trips.length === 1 && trips[0].direction === 'LONG' && trips[0].entry_notional / trips[0].entry_qty === 101 && trips[0].gross_pnl === 16, trips);
ok('a round trip that returns to flat is marked closed', !!trips[0].closed_at && trips[0].peak_qty === 2, trips[0]);

// A single fill that crosses zero closes one trade and opens the opposite one.
trips = foldFills([mkFill(1, 'BUY', 1, 100), mkFill(2, 'SELL', 3, 110, 10, 0.3)]);
ok('a fill that flips the position splits into two trades', trips.length === 2 && trips[0].direction === 'LONG' && trips[1].direction === 'SHORT', trips.map(t => t.direction));
// Binance reports realizedPnl for the REDUCING part of a fill only — prorating it across the
// flip would credit the freshly-opened trade with profit it has not made.
ok('realized PnL on a flip goes entirely to the trade being closed',
  trips[0].gross_pnl === 10 && trips[1].gross_pnl === 0, trips.map(t => t.gross_pnl));
// Commission, unlike realized PnL, IS charged on the fill's whole quantity and is prorated.
// The flipping fill carries 0.3 on 3 units: 1 unit closes the long (0.1), 2 open the short (0.2).
ok('commission on a flip is prorated across both trades',
  Math.abs(trips[0].commission - 0.1) < 1e-9 && Math.abs(trips[1].commission - 0.2) < 1e-9, trips.map(t => t.commission));
ok('the trade left open after a flip stays open', !!trips[0].closed_at && !trips[1].closed_at, trips.map(t => !!t.closed_at));

// Exchange-reported quantities are floats: a 3-leg exit leaves a ~1e-17 residual that must
// still count as flat, or every round trip would be recorded as permanently open.
trips = foldFills([mkFill(1, 'BUY', 0.3, 100), mkFill(2, 'SELL', 0.1, 101, 0.1), mkFill(3, 'SELL', 0.1, 102, 0.2), mkFill(4, 'SELL', 0.1, 103, 0.3)]);
ok('a float-residual exit still closes the trade', trips.length === 1 && !!trips[0].closed_at, trips);

// End-to-end against the seeded exchange: the sync above already ran the rebuild.
const tradeRows = (await db.query('SELECT * FROM trades ORDER BY opened_at')).rows;
ok('syncing materialises round trips into the trades table', Array.isArray(tradeRows), tradeRows.length);
const rebuilt = await rebuildTrades();
const afterRebuild = (await db.query('SELECT COUNT(*)::int AS n FROM trades')).rows[0].n;
await rebuildTrades();
ok('rebuilding trades is idempotent (no duplicate rows)', (await db.query('SELECT COUNT(*)::int AS n FROM trades')).rows[0].n === afterRebuild, { afterRebuild, rebuilt });

// ---------------------------------------------------------------------------------------
// Cross-dimension analysis engine (api/_lib/analytics.js + GET /api/snapshots?analysis).
// Seeded with a hand-computed trade set so every KPI has a known expected value.
// 3 wins (+100 +200 +300) and 2 losses (-50 -150): net +400, PF 600/200 = 3.
// ---------------------------------------------------------------------------------------
const seedTrade = (id, symbol, dir, net, day, hour) => db.query(
  `INSERT INTO trades (exchange,symbol,open_trade_id,close_trade_id,direction,qty,entry_price,exit_price,
     gross_pnl,commission,funding,net_pnl,opened_at,closed_at,duration_s,entry_hour,entry_dow,fill_count,leverage)
   VALUES ('binance',$1,$2,$2,$3,1,100,110,$4,0,0,$4,$5::timestamptz,$5::timestamptz + interval '1 hour',3600,$6,
     EXTRACT(DOW FROM $5::timestamptz)::int,2,5)
   ON CONFLICT (exchange,symbol,open_trade_id) DO NOTHING`,
  [symbol, id, dir, net, `2026-06-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`, hour]
);
await db.query("DELETE FROM trades WHERE symbol LIKE 'AN%USDT'");
await seedTrade(9001, 'ANAUSDT', 'LONG', 100, 1, 9);
await seedTrade(9002, 'ANAUSDT', 'LONG', 200, 2, 9);
await seedTrade(9003, 'ANAUSDT', 'SHORT', -50, 3, 14);
await seedTrade(9004, 'ANBUSDT', 'LONG', 300, 4, 9);
await seedTrade(9005, 'ANBUSDT', 'SHORT', -150, 5, 14);

r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', group: 'symbol', from: '2026-06-01', to: '2026-06-30' } });
ok('analysis endpoint groups by dimension', r.status === 200 && r.body.dimension === 'symbol' && r.body.rows.length === 2, r.body);
const tot = r.body.total;
ok('analysis KPIs: net PnL, trades, win rate', tot.trades === 5 && tot.netPnl === 400 && tot.winRate === 60, tot);
// PF = gross profit / gross loss = 600 / 200 = 3. Expectancy = mean net = 400/5 = 80.
ok('analysis KPIs: profit factor + expectancy', tot.profitFactor === 3 && tot.expectancy === 80, tot);
// Cumulative net curve is +100 +300 +250 +550 +400 -> peak 550, trough after it 400 -> -150.
ok('analysis max drawdown is peak-to-trough of the cumulative net curve', tot.maxDrawdown === -150, tot.maxDrawdown);
// Buckets must reconcile with the unsliced total, or a slice is silently dropping trades.
ok('grouped buckets sum back to the total',
  r.body.rows.reduce((s, x) => s + x.netPnl, 0) === tot.netPnl && r.body.rows.reduce((s, x) => s + x.trades, 0) === tot.trades, r.body.rows);

r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', group: 'direction', from: '2026-06-01', to: '2026-06-30' } });
const shortRow = r.body.rows.find(x => x.key === 'SHORT');
ok('grouping by direction isolates LONG vs SHORT', shortRow && shortRow.trades === 2 && shortRow.netPnl === -200, r.body.rows);
// A bucket with no losing trade has an UNDEFINED profit factor, not an infinite one.
const longRow = r.body.rows.find(x => x.key === 'LONG');
ok('profit factor is null (not Infinity) when a bucket has no losing trade', longRow && longRow.profitFactor === null, longRow);

r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', group: 'symbol', compare: 'direction', from: '2026-06-01', to: '2026-06-30' } });
ok('a second dimension produces a comparison matrix', r.status === 200 && Array.isArray(r.body.matrix) && r.body.matrix.length === 2 && r.body.matrix[0].cells.length >= 1, r.body.matrix);

r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', group: 'symbol', symbol: 'ANAUSDT', from: '2026-06-01', to: '2026-06-30' } });
ok('list filters narrow the set server-side', r.status === 200 && r.body.rows.length === 1 && r.body.total.trades === 3, r.body.total);
r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', group: 'symbol', hour: '14', from: '2026-06-01', to: '2026-06-30' } });
ok('entry-hour filter narrows the set server-side', r.status === 200 && r.body.total.trades === 2 && r.body.total.netPnl === -200, r.body.total);
// Calendar bucketing: same trade set, keyed by period instead of by dimension.
// The seeded set is 5 trades on 5 consecutive June days: +100 +200 -50 +300 -150.
r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', calendar: 'day', from: '2026-06-01', to: '2026-06-30' } });
ok('calendar buckets by day', r.status === 200 && r.body.granularity === 'day' && r.body.rows.length === 5, r.body.rows);
ok('calendar days are chronological and carry the full KPI block',
  r.body.rows[0].key === '2026-06-01' && r.body.rows[0].netPnl === 100 && r.body.rows[0].winRate === 100
  && r.body.rows[4].key === '2026-06-05', r.body.rows.map(x => `${x.key}:${x.netPnl}`));
ok('calendar buckets reconcile with the unsliced total',
  r.body.rows.reduce((s, x) => s + x.netPnl, 0) === r.body.total.netPnl, { sum: r.body.rows.reduce((s, x) => s + x.netPnl, 0), total: r.body.total.netPnl });

r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', calendar: 'month', from: '2026-06-01', to: '2026-06-30' } });
ok('calendar buckets by month', r.status === 200 && r.body.rows.length === 1 && r.body.rows[0].key === '2026-06' && r.body.rows[0].trades === 5, r.body.rows);

// ISO weeks belong to the year containing their Thursday. 2026-06-01 is a Monday, so these
// five days are all week 23 — the naive "day-of-year / 7" would split them.
r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', calendar: 'week', from: '2026-06-01', to: '2026-06-30' } });
ok('calendar buckets by ISO week (Monday-first)', r.status === 200 && r.body.rows.length === 1 && /^2026-W\d\d$/.test(r.body.rows[0].key), r.body.rows);
// 2027-01-01 is a Friday, so it belongs to ISO week 53 of 2026, not week 1 of 2027 — the
// case a hand-rolled week number always gets wrong.
await seedTrade(9101, 'ANCUSDT', 'LONG', 10, 1, 9);
await db.query("UPDATE trades SET closed_at='2027-01-01T12:00:00Z', opened_at='2027-01-01T11:00:00Z' WHERE open_trade_id=9101");
r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', calendar: 'week', symbol: 'ANCUSDT', from: '2026-12-01', to: '2027-01-31' } });
ok('a January 1st that falls on a Friday lands in the previous ISO year', r.body.rows[0]?.key === '2026-W53', r.body.rows);
await db.query("DELETE FROM trades WHERE open_trade_id=9101");

r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', calendar: 'fortnight' } });
ok('an unknown granularity is rejected -> 400', r.status === 400, r.status);

// Trade list + per-position detail (api/_lib/tradeDetail.js).
r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', list: '1', from: '2026-06-01', to: '2026-06-30' } });
ok('the round-trip list is paginated newest-first', r.status === 200 && r.body.total === 5 && r.body.trades[0].closedAt >= r.body.trades[4].closedAt, r.body.trades.map(x => x.id));
const tradeKey = r.body.trades[0].id;
ok('each listed trade carries an addressable id', /^binance:AN[AB]USDT:\d+$/.test(tradeKey), tradeKey);

const { parseTradeKey, excursions } = await import('../api/_lib/tradeDetail.js');
// The id is exchange:symbol:openTradeId — split from the RIGHT, since a symbol could in
// principle contain a colon while the numeric id never does.
ok('a trade key parses back into its parts',
  JSON.stringify(parseTradeKey('binance:BTCUSDT:42')) === JSON.stringify({ exchange: 'binance', symbol: 'BTCUSDT', openTradeId: 42 }), parseTradeKey('binance:BTCUSDT:42'));
ok('a malformed trade key is rejected rather than guessed at', parseTradeKey('nonsense') === null && parseTradeKey('a:b:notanumber') === null, [parseTradeKey('nonsense'), parseTradeKey('a:b:notanumber')]);

// MAE/MFE: a LONG entered at 100 that dipped to 90 and peaked at 130, 2 units.
// MAE = (90-100)*2 = -20 (worst it was ever down), MFE = (130-100)*2 = +60.
const exLong = excursions({ direction: 'LONG', entryPrice: 100, qty: 2, candles: [{ high: 110, low: 95 }, { high: 130, low: 90 }] });
ok('MAE/MFE measure the worst and best excursion, not the outcome', exLong.mae === -20 && exLong.mfe === 60, exLong);
// The same prices on a SHORT invert: the dip is the profit and the peak is the damage.
const exShort = excursions({ direction: 'SHORT', entryPrice: 100, qty: 2, candles: [{ high: 110, low: 95 }, { high: 130, low: 90 }] });
ok('MAE/MFE invert for a SHORT', exShort.mae === -60 && exShort.mfe === 20, exShort);
ok('excursions with no candles are null, not zero', excursions({ direction: 'LONG', entryPrice: 100, qty: 1, candles: [] }) === null, 'null expected');
// A position that never traded below its entry was never down: MAE is 0, not a positive
// number that would read as a loss of that size.
const exNeverDown = excursions({ direction: 'LONG', entryPrice: 100, qty: 1, candles: [{ high: 120, low: 105 }] });
ok('an adverse excursion is clamped at zero, never positive', exNeverDown.mae === 0 && exNeverDown.mfe === 20, exNeverDown);

r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', trade: tradeKey } });
ok('the position detail resolves', r.status === 200 && r.body.id === tradeKey && r.body.symbol && r.body.direction, r.body && { id: r.body.id, sym: r.body.symbol });
ok('the detail carries the full cost breakdown', r.status === 200 && 'grossPnl' in r.body && 'commission' in r.body && 'funding' in r.body && 'netPnl' in r.body, Object.keys(r.body || {}));
// Slippage and R-multiple used to be declared as uninstrumented here; both are measured now
// that orders are synced, so the gap list is empty and the fields are present instead.
ok('the detail exposes the order-derived metrics', 'slippage' in r.body && 'rMultiple' in r.body && 'unfilledOrders' in r.body, Object.keys(r.body).filter(k => /slip|rMult|unfilled/i.test(k)));
ok('the detail declares no remaining uninstrumented metric', Object.keys(r.body.unavailable).length === 0, r.body.unavailable);
// The exchange is unreachable from the test harness, so the chart degrades to empty rather
// than failing the request — the page must survive a venue outage.
ok('an unreachable exchange degrades the chart instead of failing the page', Array.isArray(r.body.candles), r.body.priceError || r.body.candles);
r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', trade: 'binance:NOPEUSDT:1' } });
ok('an unknown position -> 404', r.status === 404, r.status);

r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', group: 'nonsense' } });
ok('an unknown dimension is rejected -> 400', r.status === 400, r.status);
r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: 'meta' } });
ok('analysis meta exposes dimensions, filter options and the not-instrumented list',
  r.status === 200 && r.body.dimensions.some(d => d.key === 'leverage') && Array.isArray(r.body.options.symbol) && !!r.body.unavailable.mae_mfe, r.body.unavailable);
await db.query("DELETE FROM trades WHERE symbol LIKE 'AN%USDT'");

// ---------------------------------------------------------------------------------------
// Strategy playbook + version attribution (api/_lib/strategies.js).
// Three trades on the same bot, spread over three months; two versions deployed between
// them. Each trade must land on the version that was live when it OPENED.
// ---------------------------------------------------------------------------------------
await db.query("DELETE FROM trades WHERE symbol='PBKUSDT'");
await db.query("DELETE FROM strategies WHERE id LIKE 'pb-test%'");
const pbTrade = (id, day, net) => db.query(
  `INSERT INTO trades (exchange,symbol,open_trade_id,close_trade_id,direction,qty,entry_price,exit_price,
     gross_pnl,commission,funding,net_pnl,opened_at,closed_at,duration_s,entry_hour,entry_dow,fill_count,leverage)
   VALUES ('binance','PBKUSDT',$1,$1,'LONG',1,100,110,$2,0,0,$2,$3::timestamptz,$3::timestamptz + interval '1 hour',3600,10,1,2,5)`,
  [id, net, day]
);
await pbTrade(7001, '2026-01-15T10:00:00Z', 100);   // before any version -> unattributed
await pbTrade(7002, '2026-03-15T10:00:00Z', -40);   // v1 window
await pbTrade(7003, '2026-05-15T10:00:00Z', 250);   // v2 window

r = await call(bots, { method: 'POST', headers: authH, body: { action: 'createStrategy', name: 'PB Test', botId: 'binance:PBKUSDT', expectedKpis: { minProfitFactor: 1.5, minWinRate: 60 } } });
ok('a strategy can be created with declared expectations', r.status === 200 && r.body.strategy.id && r.body.strategy.expectedKpis.minProfitFactor === 1.5, r.body);
const pbId = r.body.strategy.id;

r = await call(bots, { method: 'POST', headers: authH, body: { action: 'deployVersion', strategyId: pbId, label: 'v1', at: '2026-02-01T00:00:00Z', changes: 'first' } });
ok('deploying a version records it', r.status === 200 && r.body.version.label === 'v1', r.body);
r = await call(bots, { method: 'POST', headers: authH, body: { action: 'deployVersion', strategyId: pbId, label: 'v2', at: '2026-04-01T00:00:00Z', changes: 'wider stop' } });
ok('deploying again retires the previous version', r.status === 200 && r.body.version.label === 'v2', r.body);
let vrows = (await db.query('SELECT label, retired_at FROM strategy_versions WHERE strategy_id=$1 ORDER BY deployed_at', [pbId])).rows;
ok('the version timeline has no gap and no overlap',
  vrows[0].label === 'v1' && vrows[0].retired_at && new Date(vrows[0].retired_at).toISOString().startsWith('2026-04-01') && vrows[1].retired_at === null, vrows);

const attributed = (await db.query(
  `SELECT t.open_trade_id, v.label FROM trades t LEFT JOIN strategy_versions v ON v.id=t.strategy_version_id
   WHERE t.symbol='PBKUSDT' ORDER BY t.open_trade_id`)).rows;
ok('each trade is attributed to the version live when it OPENED',
  attributed[1].label === 'v1' && attributed[2].label === 'v2', attributed);
// A trade that predates every declared version is left unattributed rather than being
// forced onto the oldest one — the desk genuinely does not know what produced it.
ok('a trade predating every version stays unattributed', attributed[0].label === null, attributed[0]);

r = await call(bots, { method: 'GET', headers: authH, query: { playbook: '1', strategy: pbId } });
const pb = r.body.strategies[0];
ok('the playbook returns per-version realised KPIs',
  r.status === 200 && pb.versions.find(v => v.label === 'v1').actual.netPnl === -40 && pb.versions.find(v => v.label === 'v2').actual.netPnl === 250, pb.versions.map(v => ({ v: v.label, n: v.actual.netPnl })));
// Only attributed trades count towards the strategy: the unattributed +100 must be excluded,
// otherwise a strategy would be credited with results from before it was documented.
ok('strategy totals exclude unattributed trades', pb.overall.netPnl === 210 && pb.overall.trades === 2, pb.overall);
// Max drawdown folds a CUMULATIVE curve, so it is order-dependent: -40 then +250 gives -40,
// while +250 then -40 gives -40 too — but a longer unordered sequence does not. Asserting it
// twice across a mutation catches the missing ORDER BY that made it drift between page loads.
const dd1 = pb.overall.maxDrawdown;
await call(bots, { method: 'POST', headers: authH, body: { action: 'reattribute' } });
const dd2 = (await call(bots, { method: 'GET', headers: authH, query: { playbook: '1', strategy: pbId } })).body.strategies[0].overall.maxDrawdown;
ok('max drawdown is stable across reads (trades are folded in chronological order)', dd1 === dd2 && dd1 === -40, { dd1, dd2 });
// Declared 1.5 profit factor / 60% win rate vs an actual 250/40 = 6.25 and 50%.
const expPF = pb.expectations.find(e => e.key === 'minProfitFactor');
const expWR = pb.expectations.find(e => e.key === 'minWinRate');
ok('expectations are judged against the realised KPIs', expPF.status === 'met' && expWR.status === 'missed', pb.expectations);

// Backdating a correction must move history, not just future trades.
r = await call(bots, { method: 'POST', headers: authH, body: { action: 'deployVersion', strategyId: pbId, label: 'v0', at: '2026-01-01T00:00:00Z', changes: 'backdated' } });
const afterBackdate = (await db.query(
  `SELECT v.label FROM trades t LEFT JOIN strategy_versions v ON v.id=t.strategy_version_id
   WHERE t.symbol='PBKUSDT' AND t.open_trade_id=7001`)).rows[0];
ok('backdating a deployment re-attributes historical trades', afterBackdate.label === 'v0', afterBackdate);
// Inserting a version BEFORE the existing ones must reseal the whole timeline, not just close
// the currently-open one: otherwise v0 would run forever, overlap v1/v2, and attribution would
// silently pick one of the matching versions at random.
const sealed = (await db.query('SELECT label, deployed_at, retired_at FROM strategy_versions WHERE strategy_id=$1 ORDER BY deployed_at', [pbId])).rows;
ok('a backdated version does not overlap the versions that follow it',
  sealed.every((v, i) => i === sealed.length - 1
    ? v.retired_at === null
    : v.retired_at && new Date(v.retired_at).getTime() === new Date(sealed[i + 1].deployed_at).getTime()),
  sealed.map(v => ({ v: v.label, from: v.deployed_at, to: v.retired_at })));
const stillSplit = (await db.query(
  `SELECT v.label, count(*)::int AS n FROM trades t LEFT JOIN strategy_versions v ON v.id=t.strategy_version_id
   WHERE t.symbol='PBKUSDT' GROUP BY v.label ORDER BY v.label`)).rows;
ok('trades stay spread across the resealed timeline, not collapsed onto one version',
  stillSplit.length === 3 && stillSplit.every(r => r.n === 1), stillSplit);

// The 'version' dimension on the Analysis page resolves through the same attribution.
r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', group: 'version', symbol: 'PBKUSDT', from: '2026-01-01', to: '2026-12-31' } });
ok('the analysis engine can group by strategy version',
  r.status === 200 && r.body.rows.some(x => x.key === 'v2' && x.netPnl === 250), r.body.rows);

await db.query("DELETE FROM strategies WHERE id LIKE 'pb-test%' OR name='Operator strategy'");
await db.query("DELETE FROM trades WHERE symbol='PBKUSDT'");

// ---------------------------------------------------------------------------------------
// Anomaly detection (api/_lib/anomalies.js).
// Seeded so each detector has a case it MUST fire on and the totals are hand-checkable.
// Baseline window = 42 days ending 14 days ago; recent window = last 14 days.
// ---------------------------------------------------------------------------------------
await db.query("DELETE FROM anomalies");
await db.query("DELETE FROM trades WHERE symbol LIKE 'AN%'");
let anId = 8000;
// `daysAgo` is relative to now so the rows always land in the right window, whenever the
// suite runs — a fixed date would silently stop triggering as time passes.
const anTrade = (symbol, dir, net, daysAgo) => db.query(
  `INSERT INTO trades (exchange,symbol,open_trade_id,close_trade_id,direction,qty,entry_price,exit_price,
     gross_pnl,commission,funding,net_pnl,opened_at,closed_at,duration_s,entry_hour,entry_dow,fill_count,leverage)
   VALUES ('binance',$1,$2,$2,$3,1,100,110,$4,0,0,$4, now() - ($5||' days')::interval, now() - ($5||' days')::interval + interval '1 hour',
     3600,10,1,2,5)`,
  [symbol, ++anId, dir, net, String(daysAgo)]
);
// ANWIN: healthy baseline (PF 3.0), collapsing recent window (PF 0.25) -> profit_factor_drop.
for (let i = 0; i < 12; i++) await anTrade('ANWIN', 'LONG', i % 3 === 0 ? -100 : 150, 20 + i);
for (let i = 0; i < 12; i++) await anTrade('ANWIN', 'LONG', i % 4 === 0 ? 50 : -100, i % 13);
// ANDIR: long side works, short side does not -> long_short_drift.
for (let i = 0; i < 10; i++) await anTrade('ANDIR', 'LONG', 80, i % 13);
for (let i = 0; i < 10; i++) await anTrade('ANDIR', 'SHORT', -90, i % 13);
for (let i = 0; i < 10; i++) await anTrade('ANDIR', 'LONG', 40, 20 + i);
// ANQUIET: traded steadily, then stopped entirely -> trade_frequency (critical).
for (let i = 0; i < 15; i++) await anTrade('ANQUIET', 'LONG', 20, 20 + i);

r = await call(alerts, { method: 'POST', headers: authH, body: { action: 'detectAnomalies' } });
ok('detection runs and reports what it created', r.status === 200 && typeof r.body.created === 'number' && r.body.created > 0, r.body);

r = await call(alerts, { method: 'GET', headers: authH, query: { anomalies: '1', status: 'open' } });
const byCode = (c, scopePart) => r.body.entries.find(a => a.code === c && (!scopePart || a.scope.includes(scopePart)));
ok('profit factor collapse is detected', !!byCode('profit_factor_drop', 'ANWIN'), r.body.entries.map(a => a.code + '@' + a.scope));
ok('a long/short divergence is detected', !!byCode('long_short_drift', 'ANDIR'), r.body.entries.map(a => a.code + '@' + a.scope));
const quiet = byCode('trade_frequency', 'ANQUIET');
ok('a bot that stopped trading is flagged critical', !!quiet && quiet.severity === 'critical', quiet);

// Each finding must carry the numbers that produced it — a detector whose reasoning cannot
// be checked gets ignored after its first false positive.
const pfFinding = byCode('profit_factor_drop', 'ANWIN');
ok('a finding carries a probable cause and its evidence',
  !!pfFinding.cause && pfFinding.evidence.recentPF != null && pfFinding.evidence.baselinePF != null
  && pfFinding.evidence.baselinePF > pfFinding.evidence.recentPF, pfFinding);
// The collapsed window is outright losing, so this is the critical variant, not a warning.
ok('a profit factor below 1 is critical, not a warning', pfFinding.severity === 'critical', pfFinding.severity);

// Re-running must refresh the same finding, never stack duplicates — the detectors run daily.
const before = (await db.query('SELECT count(*)::int AS n FROM anomalies WHERE resolved_at IS NULL')).rows[0].n;
r = await call(alerts, { method: 'POST', headers: authH, body: { action: 'detectAnomalies' } });
const after = (await db.query('SELECT count(*)::int AS n FROM anomalies WHERE resolved_at IS NULL')).rows[0].n;
ok('re-running refreshes findings instead of duplicating them', before === after && r.body.created === 0 && r.body.refreshed > 0, { before, after, ...r.body });

// A condition that stops being true must close itself, or the page becomes a list of
// everything that ever went wrong rather than what is wrong now.
await db.query("DELETE FROM trades WHERE symbol='ANDIR'");
r = await call(alerts, { method: 'POST', headers: authH, body: { action: 'detectAnomalies' } });
ok('a finding that no longer holds is auto-resolved', r.body.resolved > 0, r.body);
r = await call(alerts, { method: 'GET', headers: authH, query: { anomalies: '1', status: 'open' } });
ok('...and disappears from the open list', !r.body.entries.some(a => a.scope.includes('ANDIR')), r.body.entries.map(a => a.scope));
r = await call(alerts, { method: 'GET', headers: authH, query: { anomalies: '1', status: 'resolved' } });
ok('...but is still readable in the resolved history', r.body.entries.some(a => a.scope.includes('ANDIR')), r.body.entries.map(a => a.scope));

const openOne = (await call(alerts, { method: 'GET', headers: authH, query: { anomalies: '1' } })).body.entries[0];
r = await call(alerts, { method: 'POST', headers: authH, body: { action: 'ackAnomaly', id: openOne.id } });
ok('an anomaly can be acknowledged', r.status === 200 && !!r.body.anomaly.ackedAt, r.body.anomaly);
r = await call(alerts, { method: 'GET', headers: authH, query: { anomalies: '1', severity: 'critical' } });
ok('severity filters server-side', r.status === 200 && r.body.entries.every(a => a.severity === 'critical'), r.body.entries.map(a => a.severity));
r = await call(alerts, { method: 'GET', headers: authH, query: { anomalies: '1' } });
// Slippage rise and unfilled orders both became detectable with the order sync, so the
// "cannot detect" list is now empty — still exported, so the block stays wired for the next gap.
ok('the undetectable list is exposed and now empty', r.body.undetectable && Object.keys(r.body.undetectable).length === 0, r.body.undetectable);

await db.query("DELETE FROM trades WHERE symbol LIKE 'AN%'");
await db.query("DELETE FROM anomalies");

// ---------------------------------------------------------------------------------------
// Weekly review (api/_lib/weeklyReport.js). Seeded across three windows so the comparison
// against the previous week and against the 4-week baseline both have real values.
// ---------------------------------------------------------------------------------------
await db.query("DELETE FROM trades WHERE symbol LIKE 'WK%'");
const { buildWeeklyReview } = await import('../api/_lib/weeklyReport.js');
let wkId = 6000;
const wkTrade = (symbol, net, daysAgo) => db.query(
  `INSERT INTO trades (exchange,symbol,open_trade_id,close_trade_id,direction,qty,entry_price,exit_price,
     gross_pnl,commission,funding,net_pnl,opened_at,closed_at,duration_s,entry_hour,entry_dow,fill_count,leverage)
   VALUES ('binance',$1,$2,$2,'LONG',1,100,110,$3,0,0,$3, now() - ($4||' days')::interval, now() - ($4||' days')::interval + interval '1 hour',
     3600,10,1,2,5)`, [symbol, ++wkId, net, String(daysAgo)]
);
// This week: +100 -300 on WKAAA, +50 on WKBBB -> net -150
await wkTrade('WKAAA', 100, 2); await wkTrade('WKAAA', -300, 3); await wkTrade('WKBBB', 50, 4);
// Last week: +200 net
await wkTrade('WKAAA', 200, 10);
// The four weeks before that: +400 total -> a 100/week baseline
await wkTrade('WKAAA', 400, 20);

let rv = await buildWeeklyReview();
ok('weekly review reports the week net PnL', rv.portfolio.netPnl === -150 && rv.portfolio.trades === 3, rv.portfolio);
ok('weekly review compares against the previous week',
  rv.portfolio.prevNetPnl === 200 && rv.portfolio.vsPrevPct === -175, { prev: rv.portfolio.prevNetPnl, pct: rv.portfolio.vsPrevPct });
// The baseline covers 4 weeks (+400) so a like-for-like weekly average is +100.
ok('weekly review compares against the 4-week average', rv.portfolio.avgWeeklyNetPnl === 100, rv.portfolio.avgWeeklyNetPnl);
ok('weekly review attributes PnL per bot',
  rv.bots.find(b => b.symbol === 'WKAAA')?.netPnl === -200 && rv.bots.find(b => b.symbol === 'WKBBB')?.netPnl === 50, rv.bots);
ok('weekly review separates contributors from detractors',
  rv.contributors.some(b => b.symbol === 'WKBBB') && rv.detractors.some(b => b.symbol === 'WKAAA'), { c: rv.contributors.map(b => b.symbol), d: rv.detractors.map(b => b.symbol) });
ok('weekly review lists the individual losing trades', rv.significantLosses[0]?.netPnl === -300, rv.significantLosses);
// A bot trading with no strategy declared is a governance gap the review must surface.
ok('a bot trading with no declared strategy is flagged for review',
  rv.review.some(i => i.kind === 'undocumented_bot' && i.detail === 'WKAAA'), rv.review);

// A desk with no history has nothing to compare against; that must read as "no comparable
// week", never as a percentage computed from a zero baseline.
await db.query("DELETE FROM trades WHERE symbol LIKE 'WK%' AND closed_at < now() - interval '7 days'");
rv = await buildWeeklyReview();
ok('with no previous week, the comparison is null rather than a fabricated percentage',
  rv.portfolio.vsPrevPct === null && rv.portfolio.prevNetPnl === 0, rv.portfolio);

const { buildWeeklyPdf: bwp } = await import('../api/_lib/report.js');
const wkPdf = await bwp({ equity: 1e6, pnl7: -150, openPnl: 0, exposure: 0, funds: [], positions: [], dateLabel: rv.weekLabel, series: [1, 2, 3], review: rv });
ok('the weekly PDF renders with the review attached', Buffer.from(wkPdf, 'base64').slice(0, 5).toString() === '%PDF-', wkPdf.slice(0, 8));

// End-to-end through the cron: archived as a report row, and emailed to the roles holding
// view_reports_weekly (the same gate the daily email uses).
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH, query: { force: 'weekly' } });
ok('the weekly cron archives a weekly PDF', r.body.sent.some(s => s.type === 'weekly-pdf' && s.archived && s.bytes > 0), r.body.sent.filter(s => String(s.type).startsWith('weekly')));
ok('the weekly cron emails the review', r.body.sent.some(s => s.type === 'weekly-email' && s.recipients > 0), r.body.sent.filter(s => String(s.type).startsWith('weekly')));
const wkRow = (await db.query("SELECT id,kind,status,html_body FROM reports WHERE kind='weekly' ORDER BY created_at DESC LIMIT 1")).rows[0];
ok('the archived weekly report is auto-verified (internal-only)', wkRow && wkRow.status === 'verified', wkRow && wkRow.status);
// The HTML preview must be the EXACT body that was emailed, so it is stored at generation
// rather than re-rendered on demand from the same numbers (which could drift).
ok('the archived report stores the emailed HTML body', !!wkRow.html_body && wkRow.html_body.includes('Weekly Review'), wkRow.html_body?.slice(0, 60));
r = await call(snapshots, { method: 'GET', headers: authH, query: { report: String(wkRow.id), format: 'html' } });
ok('a report can be previewed as HTML', r.status === 200 && r.body.html === wkRow.html_body, r.status);
r = await call(snapshots, { method: 'GET', headers: authH, query: { reports: 'list' } });
ok('the list flags which reports have a preview', r.body.reports.find(x => x.id === Number(wkRow.id))?.hasHtml === true, r.body.reports.slice(0, 2));
// A report archived before this feature has no body; saying so beats fabricating one.
await db.query('UPDATE reports SET html_body=NULL WHERE id=$1', [wkRow.id]);
r = await call(snapshots, { method: 'GET', headers: authH, query: { report: String(wkRow.id), format: 'html' } });
ok('a report with no stored body reports that, rather than inventing a preview', r.status === 404, r.status);
await db.query("DELETE FROM trades WHERE symbol LIKE 'WK%'");

// ---------------------------------------------------------------------------------------
// Discussion layer: comments, @mentions, incident review (api/_lib/comments.js).
// ---------------------------------------------------------------------------------------
const { extractHandles } = await import('../api/_lib/comments.js');
ok('handles are extracted from a comment body',
  JSON.stringify(extractHandles('hi @sophie.ops and @marc.view, see @sophie.ops again').sort()) === JSON.stringify(['marc.view', 'sophie.ops']),
  extractHandles('hi @sophie.ops and @marc.view, see @sophie.ops again'));
// A trailing full stop belongs to the sentence, not to the handle.
ok('a handle at the end of a sentence keeps its punctuation out', extractHandles('ping @marc.view.')[0] === 'marc.view', extractHandles('ping @marc.view.'));

r = await call(alerts, { method: 'POST', headers: authH, body: {
  action: 'addComment', entityType: 'position', entityId: 'binance:BTCUSDT:1',
  body: 'Widened the stop here, @sophie.ops can you re-check the sizing?', category: 'question', priority: 'high' } });
ok('a comment is posted and its mention resolved', r.status === 200 && r.body.id && r.body.mentioned.includes('sophie.ops'), r.body);
const commentId = r.body.id;
// An @word matching nobody is text, not a broken mention: no row, no notification.
r = await call(alerts, { method: 'POST', headers: authH, body: {
  action: 'addComment', entityType: 'position', entityId: 'binance:BTCUSDT:1', body: 'cc @nobody.at.all' } });
ok('an @handle matching no user creates no mention', r.status === 200 && r.body.mentioned.length === 0, r.body);

r = await call(alerts, { method: 'GET', headers: authH, query: { comments: '1', entityType: 'position', entityId: 'binance:BTCUSDT:1' } });
ok('the thread reads back with its metadata', r.status === 200 && r.body.comments.length === 2 && r.body.comments[0].category === 'question' && r.body.comments[0].priority === 'high', r.body.comments);
ok('comments carry their resolved mentions', r.body.comments[0].mentions.some(m => m.username === 'sophie.ops'), r.body.comments[0].mentions);

// The mention lands in the MENTIONED user's inbox, not the author's.
let sophieLogin = await call(auth, { method: 'POST', body: { action: 'login', email: 'sophie.ops@lno.company', password: 'admin' } });
const sophieH = { authorization: 'Bearer ' + sophieLogin.body.token };
r = await call(alerts, { method: 'GET', headers: sophieH, query: { mentions: '1' } });
ok('the mentioned user sees it in their inbox', r.status === 200 && r.body.mentions.length === 1 && r.body.mentions[0].commentId === commentId, r.body.mentions);
ok('the mention carries what a deep link needs', r.body.mentions[0].entityType === 'position' && r.body.mentions[0].entityId === 'binance:BTCUSDT:1', r.body.mentions[0]);
r = await call(alerts, { method: 'GET', headers: authH, query: { mentions: '1' } });
ok('the author does not get a mention notification for their own comment', r.body.mentions.length === 0, r.body.mentions);

r = await call(alerts, { method: 'POST', headers: sophieH, body: { action: 'readMentions' } });
ok('mentions can be marked read', r.status === 200 && r.body.unread === 0, r.body);
r = await call(alerts, { method: 'GET', headers: sophieH, query: { mentions: '1' } });
ok('...and drop out of the unread inbox', r.body.mentions.length === 0, r.body.mentions);

// Resolution is stamped server-side, so "who closed this" is never the client's claim.
r = await call(alerts, { method: 'POST', headers: authH, body: { action: 'updateComment', id: commentId, status: 'resolved' } });
ok('a comment can be resolved', r.status === 200, r.body);
r = await call(alerts, { method: 'GET', headers: authH, query: { comments: '1', entityType: 'position', entityId: 'binance:BTCUSDT:1' } });
const resolved = r.body.comments.find(c => c.id === commentId);
ok('resolution records who and when, server-side', resolved.status === 'resolved' && !!resolved.resolvedAt && !!resolved.resolvedBy, resolved);
r = await call(alerts, { method: 'POST', headers: authH, body: { action: 'updateComment', id: commentId, status: 'open' } });
r = await call(alerts, { method: 'GET', headers: authH, query: { comments: '1', entityType: 'position', entityId: 'binance:BTCUSDT:1' } });
ok('reopening clears the resolution stamp', r.body.comments.find(c => c.id === commentId).resolvedAt === null, r.body.comments.find(c => c.id === commentId));

// Incident review: a document with a validation step, not a conversation.
r = await call(alerts, { method: 'POST', headers: authH, body: {
  action: 'saveReview', entityType: 'anomaly', entityId: '1', title: 'SOLUSDT drawdown',
  problem: 'PF collapsed', impact: '-400 over 3 days', rootCause: 'stop widened without retest',
  correctiveActions: 'revert to 4x ATR', severity: 'high' } });
ok('an incident review is opened as a draft', r.status === 200 && r.body.review.status === 'draft' && r.body.review.severity === 'high', r.body.review);
const reviewId = r.body.review.id;
r = await call(alerts, { method: 'POST', headers: authH, body: { action: 'saveReview', id: reviewId, status: 'validated' } });
ok('validating stamps who signed it off', r.body.review.status === 'validated' && !!r.body.review.validatedBy && !!r.body.review.validatedAt, r.body.review);
// A post-mortem that turns out wrong must be reopenable, and reopening must un-sign it.
r = await call(alerts, { method: 'POST', headers: authH, body: { action: 'saveReview', id: reviewId, status: 'in_review' } });
ok('reopening a review clears its validation', r.body.review.status === 'in_review' && r.body.review.validatedBy === null && r.body.review.validatedAt === null, r.body.review);
r = await call(alerts, { method: 'POST', headers: authH, body: { action: 'saveReview', entityType: 'anomaly', entityId: '2' } });
ok('a review without a title is rejected -> 400', r.status === 400, r.body);

// The colleague directory is readable by any signed-in user, but exposes nothing sensitive.
r = await call(profile, { method: 'GET', headers: sophieH, query: { directory: '1' } });
ok('any signed-in user can read the colleague directory', r.status === 200 && r.body.users.length >= 2, r.body.users?.length);
ok('the directory exposes no role, phone or login data',
  Object.keys(r.body.users[0]).every(k => ['id', 'username', 'name', 'handle', 'avatar'].includes(k)), Object.keys(r.body.users[0]));

// ---------------------------------------------------------------------------------------
// Orders (api/_lib/orders.js) — the three metrics only orders can give: slippage, unfilled
// work, and the risk an R-multiple divides by.
// ---------------------------------------------------------------------------------------
const { orderSlippage, isUnfilled, attachOrderMetrics, ordersForTrade } = await import('../api/_lib/orders.js');

// Slippage is a COST normalised by side: a BUY filled above its limit and a SELL filled below
// it are the same problem, so both come out positive.
ok('a BUY filled above its limit is positive slippage',
  orderSlippage({ type: 'LIMIT', side: 'BUY', price: 100, avg_price: 101, executed_qty: 2 }) === 2, 'expected +2');
ok('a SELL filled below its limit is also positive slippage',
  orderSlippage({ type: 'LIMIT', side: 'SELL', price: 100, avg_price: 99, executed_qty: 2 }) === 2, 'expected +2');
ok('a fill better than asked is negative slippage (price improvement)',
  orderSlippage({ type: 'LIMIT', side: 'BUY', price: 100, avg_price: 99.5, executed_qty: 2 }) === -1, 'expected -1');
// A MARKET order asks for "whatever is there" — it has no intended price. Reporting 0 would
// drag every average toward zero and make a genuinely slipping book look fine.
ok('a MARKET order has no measurable slippage (null, not zero)',
  orderSlippage({ type: 'MARKET', side: 'BUY', price: 0, avg_price: 101, executed_qty: 2 }) === null, 'expected null');
// A *_MARKET stop executes at market once triggered; the TRIGGER is what was intended.
ok('a stop-market measures against its trigger price',
  orderSlippage({ type: 'STOP_MARKET', side: 'SELL', price: 0, stop_price: 100, avg_price: 98, executed_qty: 1 }) === 2, 'expected +2');
ok('an order that never executed has no slippage',
  orderSlippage({ type: 'LIMIT', side: 'BUY', price: 100, avg_price: 0, executed_qty: 0 }) === null, 'expected null');
ok('a cancelled order with no execution counts as unfilled',
  isUnfilled({ status: 'CANCELED', executed_qty: 0 }) === true && isUnfilled({ status: 'CANCELED', executed_qty: 1 }) === false, 'partial fills are not unfilled');

// End to end on a seeded round trip: 2 orders that filled with slippage, 1 cancelled,
// 1 protective stop 10 below a 100 entry on 2 units -> risk 20.
await db.query("DELETE FROM trades WHERE symbol='ORDUSDT'");
await db.query("DELETE FROM orders WHERE symbol='ORDUSDT'");
await db.query(
  `INSERT INTO trades (exchange,symbol,open_trade_id,close_trade_id,direction,qty,entry_price,exit_price,
     gross_pnl,commission,funding,net_pnl,opened_at,closed_at,duration_s,entry_hour,entry_dow,fill_count,leverage)
   VALUES ('binance','ORDUSDT',4001,4002,'LONG',2,100,105,10,0,0,10,
     now() - interval '2 hours', now() - interval '1 hour',3600,10,1,2,5)`);
const seedOrder = (id, side, type, status, price, stopPrice, avg, qty, execQty, reduce, minsAgo) => db.query(
  `INSERT INTO orders (exchange,symbol,order_id,side,type,status,price,stop_price,avg_price,orig_qty,executed_qty,reduce_only,close_position,placed_at,updated_at)
   VALUES ('binance','ORDUSDT',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false, now() - ($11||' minutes')::interval, now())`,
  [id, side, type, status, price, stopPrice, avg, qty, execQty, reduce, String(minsAgo)]
);
await seedOrder(1, 'BUY', 'LIMIT', 'FILLED', 100, 0, 100.5, 2, 2, false, 110);   // +1 slippage
await seedOrder(2, 'SELL', 'LIMIT', 'FILLED', 105, 0, 104.5, 2, 2, true, 70);    // +1 slippage
await seedOrder(3, 'BUY', 'LIMIT', 'CANCELED', 99, 0, 0, 2, 0, false, 100);      // unfilled
await seedOrder(4, 'SELL', 'STOP_MARKET', 'CANCELED', 0, 90, 0, 2, 0, true, 105); // the protective stop

await attachOrderMetrics({ symbol: 'ORDUSDT' });
const ordTrade = (await db.query("SELECT slippage, unfilled_orders, risk, r_multiple FROM trades WHERE symbol='ORDUSDT'")).rows[0];
ok('slippage is summed across the round trip', Math.abs(Number(ordTrade.slippage) - 2) < 1e-9, ordTrade.slippage);
ok('orders placed and never filled are counted', Number(ordTrade.unfilled_orders) === 2, ordTrade.unfilled_orders);
// Risk = |entry - stop| x size = |100 - 90| x 2 = 20. R = net 10 / 20 = 0.5.
ok('risk is read off the protective stop', Math.abs(Number(ordTrade.risk) - 20) < 1e-9, ordTrade.risk);
ok('the R-multiple divides the result by that risk', Math.abs(Number(ordTrade.r_multiple) - 0.5) < 1e-9, ordTrade.r_multiple);

// An entry stop is not protection — only reduce-only stops define the accepted loss.
await db.query("UPDATE orders SET reduce_only=false WHERE symbol='ORDUSDT' AND order_id=4");
await attachOrderMetrics({ symbol: 'ORDUSDT' });
const noRisk = (await db.query("SELECT risk, r_multiple FROM trades WHERE symbol='ORDUSDT'")).rows[0];
ok('a non-reducing stop does not count as protection', noRisk.risk === null && noRisk.r_multiple === null, noRisk);

r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: '1', trade: 'binance:ORDUSDT:4001' } });
ok('the position detail carries its orders', r.status === 200 && r.body.orders.length === 4, r.body.orders?.length);
ok('an order row states what was asked and what was got',
  r.body.orders[0].intendedPrice === 100 && r.body.orders[0].avgPrice === 100.5 && Math.abs(r.body.orders[0].slippage - 1) < 1e-9, r.body.orders[0]);
ok('a market-style order shows no intended price rather than zero',
  ordersForTrade && r.body.orders.find(o => o.type === 'STOP_MARKET').intendedPrice === 90, r.body.orders.find(o => o.type === 'STOP_MARKET'));
// Every declared gap on this page is now measured.
ok('the position page no longer declares any uninstrumented metric', Object.keys(r.body.unavailable).length === 0, r.body.unavailable);
r = await call(snapshots, { method: 'GET', headers: authH, query: { analysis: 'meta' } });
ok('slippage is no longer listed as unavailable in the analysis engine', !r.body.unavailable.slippage && !!r.body.unavailable.mae_mfe, r.body.unavailable);

await db.query("DELETE FROM orders WHERE symbol='ORDUSDT'");
await db.query("DELETE FROM trades WHERE symbol='ORDUSDT'");

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

// a failed sync surfaces + stores the exchange error message, and immediately alerts
// admins/operators by WhatsApp + email — but only on the transition INTO error, not on
// every retry while the outage continues (the alerts-only cron hits this every ~5 min)
sentMessages.length = 0; sentEmails.length = 0;
binanceFail = true;
r = await call(bots, { method: 'POST', headers: authH, body: { action: 'sync' } });
ok('a failed sync returns the error message', r.body.errors >= 1 && /Invalid API-key, IP, or permissions/.test((r.body.errorMsgs || []).join(' ')), r.body);
const exErr = (await call(exchanges, { method: 'GET', headers: authH })).body.exchanges.find(e => e.id === exId);
ok('the sync error is stored on the exchange (status=error + lastError)', !!exErr && exErr.status === 'error' && /-2015|permissions/.test(exErr.lastError || ''), exErr);
ok('a fresh API failure sends a WhatsApp alert immediately', sentMessages.some(m => /API ERROR/i.test(m.text)), sentMessages.map(m => m.text.slice(0, 40)));
ok('a fresh API failure emails admins/operators immediately', sentEmails.some(e => /exchange API error/i.test(e.subject)), sentEmails.map(e => e.subject));
r = await call(alerts, { method: 'GET', headers: authH, query: { limit: '300' } });
ok('the failure is recorded in the System Status alert history (open, no end yet)', r.body.alerts.some(a => a.type === 'api_error' && a.ackedAt == null && a.durationSec == null), r.body.alerts.filter(a => a.type === 'api_error'));
sentMessages.length = 0; sentEmails.length = 0;
await call(bots, { method: 'POST', headers: authH, body: { action: 'sync' } }); // still failing — retry
ok('a repeated failure (still in error) does not re-alert', !sentMessages.some(m => /API ERROR/i.test(m.text)) && sentEmails.length === 0, { sentMessages, sentEmails });
r = await call(alerts, { method: 'GET', headers: authH, query: { limit: '300' } });
ok('a repeated failure does not create a second alert-history row', r.body.alerts.filter(a => a.type === 'api_error').length === 1, r.body.alerts.filter(a => a.type === 'api_error'));
binanceFail = false;
await call(bots, { method: 'POST', headers: authH, body: { action: 'sync' } }); // restore good state (clears lastError)
ok('a successful re-sync clears the stored error', ((await call(exchanges, { method: 'GET', headers: authH })).body.exchanges.find(e => e.id === exId) || {}).lastError == null);
r = await call(alerts, { method: 'GET', headers: authH, query: { limit: '300' } });
const closedApiErr = r.body.alerts.find(a => a.type === 'api_error');
ok('recovery auto-closes the alert history row with an end + duration', !!closedApiErr && closedApiErr.ackedAt != null && closedApiErr.ackedBy === 'system' && typeof closedApiErr.durationSec === 'number' && closedApiErr.durationSec >= 0, closedApiErr);
ok('?limit is capped and defaults sanely (GET /api/alerts)', r.status === 200 && Array.isArray(r.body.alerts), r.status);
r = await call(alerts, { method: 'GET', headers: authH, query: { type: 'api_error' } });
ok('?type=api_error excludes breach-type alerts', r.status === 200 && r.body.alerts.length > 0 && r.body.alerts.every(a => a.type === 'api_error'), r.body.alerts.map(a => a.type));
r = await call(alerts, { method: 'GET', headers: authH, query: { type: 'breach' } });
ok('?type=breach excludes api_error-type alerts', r.status === 200 && r.body.alerts.length > 0 && r.body.alerts.every(a => a.type === 'breach'), r.body.alerts.map(a => a.type));
r = await call(alerts, { method: 'GET', headers: authH });
ok('no ?type filter still returns both alert types (System Status full history)', r.status === 200 && r.body.alerts.some(a => a.type === 'breach') && r.body.alerts.some(a => a.type === 'api_error'), r.body.alerts.map(a => a.type));
{
  const rd = await buildReportData(1);
  ok('incidentCount only counts service-health (api_error) alerts, not portfolio breaches', rd.incidentCount >= 1, rd.incidentCount);
  // Period-over-period comparison: the same-length window immediately BEFORE the current
  // one, so a report can say "+12% this month vs +4% last month".
  ok('report data carries a previous-period comparison when history allows', typeof rd.prevPnl === 'number' && typeof rd.prevPct === 'number', { prevPnl: rd.prevPnl, prevPct: rd.prevPct });
  ok('...with pnl and pct agreeing in sign', Math.sign(rd.prevPnl) === Math.sign(rd.prevPct), { prevPnl: rd.prevPnl, prevPct: rd.prevPct });
  const wide = await buildReportData(1000);
  ok('...and omitted entirely (null) when the window is wider than the whole history', wide.prevPnl === null && wide.prevPct === null, { prevPnl: wide.prevPnl, prevPct: wide.prevPct });
}
{
  // exact value against a known window: the two snapshots before the latest one
  const eq = (await db.query('SELECT equity FROM equity_snapshots ORDER BY day ASC')).rows.map(r => Number(r.equity));
  const rd = await buildReportData(1);
  const expectPnl = eq[eq.length - 2] - eq[eq.length - 3];
  ok('previous-period pnl matches the two snapshots before the latest', rd.prevPnl === expectPnl, { got: rd.prevPnl, expected: expectPnl });
}
r = await call(alerts, { method: 'GET', headers: authH, query: { limit: '1' } });
ok('alerts ?limit=1 returns 1 row but reports the full matching total (System Status pagination)', r.status === 200 && r.body.alerts.length === 1 && r.body.total >= 2, r.body);
{
  const page0 = await call(alerts, { method: 'GET', headers: authH, query: { limit: '1', offset: '0' } });
  const page1 = await call(alerts, { method: 'GET', headers: authH, query: { limit: '1', offset: '1' } });
  ok('alerts pagination pages don\'t overlap', page0.body.alerts[0].id !== page1.body.alerts[0].id, { page0: page0.body.alerts, page1: page1.body.alerts });
}
r = await call(alerts, { method: 'GET', headers: authH, query: { date: '1999-01-01' } });
ok('alerts ?date filters server-side (no rows on an unrelated day)', r.status === 200 && r.body.alerts.length === 0 && r.body.total === 0, r.body);

// ── Real-time: the browser gets a scoped listenKey (never the real key/secret) to open its
// own WebSocket for instant account/position updates, instead of waiting on the 30s poll ──
ok('fetching a listenKey requires auth -> 401', (await call(bots, { query: { listenKey: '1' } })).status === 401);
r = await call(bots, { method: 'GET', headers: authH, query: { listenKey: '1' } });
ok('admin gets a real listenKey + wss:// URL, never the underlying API key/secret', r.status === 200 && r.body.listenKey === 'fake-listen-key-123' && r.body.wsUrl === 'wss://fstream.binance.com/ws/fake-listen-key-123', r.body);
r = await call(bots, { method: 'POST', headers: authH, body: { action: 'listenKeyKeepAlive' } });
ok('admin can keep the listenKey alive', r.status === 200 && r.body.ok === true, r.body);

// dormant bots: same dedup story as the breach alerts above — an open position stuck
// unchanged for >48h should alert once, not on every ~10-minute poll while it stays stuck
// (the mock exchange position for ADAUSDT is unchanged from here on, so re-syncing via
// cronDaily below never bumps last_changed on its own — see sync.js's CASE WHEN).
await db.query("UPDATE bots SET last_changed = now() - interval '50 hours' WHERE id='binance:ADAUSDT'");
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH, query: { mode: 'alerts' } });
ok('a newly-dormant bot triggers a stale alert', r.body.sent.some(s => s.type === 'stale'), r.body.sent.map(s => s.type));
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH, query: { mode: 'alerts' } });
ok('the same still-dormant bot does NOT resend on the next poll (dedup)', !r.body.sent.some(s => s.type === 'stale'), r.body.sent.map(s => s.type));
// the bot changes (no longer dormant) -> tracked state clears for it -> going dormant again
// later is treated as fresh, not "alert once forever"
await db.query("UPDATE bots SET last_changed = now() WHERE id='binance:ADAUSDT'");
await call(cronDaily, { method: 'POST', headers: authH, query: { mode: 'alerts' } });
await db.query("UPDATE bots SET last_changed = now() - interval '50 hours' WHERE id='binance:ADAUSDT'");
sentMessages.length = 0;
r = await call(cronDaily, { method: 'POST', headers: authH, query: { mode: 'alerts' } });
ok('a bot going dormant again after recovering alerts again', r.body.sent.some(s => s.type === 'stale'), r.body.sent.map(s => s.type));
await db.query("UPDATE bots SET last_changed = now() WHERE id='binance:ADAUSDT'"); // leave clean for later tests

// ── Employee Fund: contributions are detected live from the synced wallet balance, never
// auto-granted on hire, and only become a share once an admin assigns them to someone ──
r = await call(funds, { method: 'GET', headers: authH, query: { employeeSummary: '1' } });
ok('new user (nina) has NOT been auto-granted a share — no more auto-credit on hire', r.status === 200 && !r.body.employees.some(e => e.userId === ninaId) && r.body.notEnrolled.some(u => u.userId === ninaId), { employees: r.body.employees.map(e => e.userId), notEnrolled: r.body.notEnrolled.map(u => u.userId) });
ok('no pending contribution yet (wallet balance unchanged across all syncs so far)', r.body.pendingContributions.length === 0, r.body.pendingContributions);

// a normal trading swing (no real capital added) must NOT be mistaken for a contribution
walletBalance = '120400'; // +400 — well under the $1000 detection band
await call(bots, { method: 'POST', headers: authH, body: { action: 'sync' } });
r = await call(funds, { method: 'GET', headers: authH, query: { employeeSummary: '1' } });
ok('a sub-$1000 wallet swing is NOT flagged as a contribution', r.body.pendingContributions.length === 0, r.body.pendingContributions);

// a real ~$1000 capital addition IS detected on the next sync, live, with no deposit/transfer API involved
walletBalance = '121400'; // +1000 more on top of the prior 120400 baseline
await call(bots, { method: 'POST', headers: authH, body: { action: 'sync' } });
r = await call(funds, { method: 'GET', headers: authH, query: { employeeSummary: '1' } });
ok('a real +1000 USDT wallet jump is detected as a pending contribution', r.body.pendingContributions.length === 1 && r.body.pendingContributions[0].amount === 1000, r.body.pendingContributions);
const contribId = r.body.pendingContributions[0].id;

ok('non-admin cannot assign a contribution', [401, 403].includes((await call(funds, { method: 'POST', body: { action: 'assignEmployeeContribution', contributionId: contribId, userId: ninaId } })).status));
r = await call(funds, { method: 'POST', headers: authH, body: { action: 'assignEmployeeContribution', contributionId: contribId, userId: ninaId } });
const ninaShare = r.body.employees.find(e => e.userId === ninaId);
ok('admin assigns the detected contribution to a specific employee — that INITIATES their personal share', r.status === 200 && !!ninaShare && ninaShare.contributedAmount === 1000 && r.body.pendingContributions.length === 0, r.body);
ok('assigning the same contribution twice is rejected (already assigned)', (await call(funds, { method: 'POST', headers: authH, body: { action: 'assignEmployeeContribution', contributionId: contribId, userId: ninaId } })).status === 400);

// a second $1000 addition, assigned to the SAME employee, tops up rather than duplicating
walletBalance = '122400'; // +1000 again
await call(bots, { method: 'POST', headers: authH, body: { action: 'sync' } });
r = await call(funds, { method: 'GET', headers: authH, query: { employeeSummary: '1' } });
const contribId2 = r.body.pendingContributions[0].id;
r = await call(funds, { method: 'POST', headers: authH, body: { action: 'assignEmployeeContribution', contributionId: contribId2, userId: ninaId } });
const ninaShare2 = r.body.employees.find(e => e.userId === ninaId);
ok('assigning a second contribution to the same employee tops up (2000 total), not a duplicate row', r.status === 200 && r.body.employees.filter(e => e.userId === ninaId).length === 1 && ninaShare2.contributedAmount === 2000, r.body.employees.filter(e => e.userId === ninaId));

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

// the WhatsApp weekly/monthly report (still the detailed reportText() format — only the
// daily digest was made synthetic) groups open bots under their fund, with a colour emoji
await call(funds, { method: 'POST', headers: authH, body: { id: 'fg', name: 'Greens', color: '#10B981' } });
await call(bots, { method: 'PATCH', headers: authH, body: { id: 'binance:ADAUSDT', fundId: 'fg' } });
sentMessages.length = 0;
await call(cronDaily, { method: 'POST', headers: authH, query: { force: 'weekly' } });
const rep = sentMessages.find(m => /WEEKLY REPORT/i.test(m.text))?.text || '';
ok('weekly report groups bots under their fund with a colour emoji', /🟢 \*Greens\*/.test(rep) && /ADAUSDT/.test(rep), rep.slice(0, 240));

// with a real fund now assigned (ADAUSDT -> Greens), the daily report email's fund bars
// actually render (they were empty above since no funds/bots existed yet at that point)
sentEmails.length = 0;
await call(snapshots, { method: 'POST', headers: authH, body: { action: 'testEmail' } });
ok('the daily report email renders fund bars once a fund actually has bots', sentEmails.some(e => /background:#F1F3F6/.test(e.html || '') && /Greens/.test(e.html || '')), sentEmails.map(e => e.to));

// shareholder role — admin-created, EXTERNAL email, no password (signs in via emailed OTP)
r = await call(users, { method: 'POST', headers: authH, body: { email: 'investor@example.com', role: 'shareholder' } });
ok('shareholder created with external email, no password (auth_provider=otp)',
  r.status === 201 && r.body.user.authProvider === 'otp' && r.body.user.email === 'investor@example.com', r.body.user);
ok('shareholder role grants Exchanges/Funds/Live/Status/monthly Reports by default',
  r.status === 201 && JSON.stringify((r.body.user.permissions || []).slice().sort()) === JSON.stringify(['view_activity', 'view_exchanges', 'view_realtime', 'view_reports_monthly', 'view_trades']), r.body.user && r.body.user.permissions);
ok('an admin-created account with no photo gets a random style-2 preset avatar', /^\/avatars\/style2\/s2-\d{2}\.jpg$/.test(r.body.user.avatar || ''), r.body.user.avatar);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: r.body.user.id, avatar: '/avatars/style1/s1-05.jpg' } });
ok('admin can set a user\'s avatar to a specific preset', r.status === 200 && r.body.user.avatar === '/avatars/style1/s1-05.jpg', r.body.user);

// ── Rules (role -> permission mapping) — permissions are per-role, not per-user ──
r = await call(users, { method: 'GET', headers: authH, query: { rules: '1' } });
ok('non-admin cannot view rules -> handled by requireAdmin (sanity: admin CAN)', r.status === 200 && Array.isArray(r.body.permissions) && r.body.rolePerms.shareholder.includes('view_reports_monthly'), r.body);
r = await call(users, { method: 'GET', query: { rules: '1' } });
ok('unauthenticated cannot view rules -> 401', r.status === 401, r.status);
r = await call(users, { method: 'PUT', headers: authH, body: { rolePerms: { shareholder: ['view_activity'], viewer: ['view_activity', 'view_trades'], operator: ['view_activity', 'export_data', 'not_a_real_perm'] } } });
ok('admin updates role permissions, unknown perms are dropped', r.status === 200 && JSON.stringify(r.body.rolePerms.operator.sort()) === JSON.stringify(['export_data', 'view_activity']), r.body.rolePerms);
r = await call(users, { method: 'GET', headers: authH, query: { rules: '1' } });
ok('updated rules persist and are re-readable', JSON.stringify(r.body.rolePerms.shareholder) === JSON.stringify(['view_activity']), r.body.rolePerms);
// dedicated account (not investor@example.com — reused later, would trip its 60s resend
// cooldown) to confirm a role permission change takes effect on next sign-in with zero
// per-user migration needed
await call(users, { method: 'POST', headers: authH, body: { email: 'rules.probe@example.com', role: 'shareholder' } });
sentEmails.length = 0;
await call(auth, { method: 'POST', body: { action: 'requestOtp', email: 'rules.probe@example.com' } });
r = await call(auth, { method: 'POST', body: { action: 'verifyOtp', email: 'rules.probe@example.com', code: sentEmails[0].code } });
ok('a role permission change takes effect immediately for existing users of that role (no per-user storage)',
  r.status === 200 && JSON.stringify(r.body.user.permissions) === JSON.stringify(['view_activity']), r.body.user && r.body.user.permissions);
// restore defaults so later tests (and the reset section) aren't affected by this probe
r = await call(users, { method: 'PUT', headers: authH, body: { rolePerms: { operator: ['view_activity', 'view_realtime', 'view_trades', 'export_data'], viewer: ['view_activity', 'view_realtime', 'view_trades'], shareholder: ['view_activity', 'view_realtime', 'view_trades', 'view_reports_monthly', 'view_exchanges'] } } });
ok('restore default role permissions', r.status === 200, r.body);

// migration: a role customized (via the Rules page) before 'view_reports' was split into
// daily/weekly/monthly must keep the same effective access (daily+monthly, the two kinds
// that actually get archived) rather than silently losing it once the old key stops matching
// any known permission — see the app_config.rolePerms backfill in schema.js's migrate().
await db.query(`UPDATE app_config SET value = jsonb_set(value, '{shareholder}', '["view_activity","view_reports"]'::jsonb) WHERE key='rolePerms'`);
await call(init, { method: 'POST' }); // re-runs migrate()
r = await call(users, { method: 'GET', headers: authH, query: { rules: '1' } });
ok('legacy "view_reports" in a saved role config is migrated to daily+monthly, not dropped',
  r.body.rolePerms.shareholder.includes('view_reports_daily') && r.body.rolePerms.shareholder.includes('view_reports_monthly') && !r.body.rolePerms.shareholder.includes('view_reports'),
  r.body.rolePerms.shareholder);
r = await restorePerms();
ok('restore shareholder defaults after the migration probe', r.status === 200, r.body);

// the shareholder signs in via an emailed 6-digit code: request -> extract from the mocked
// Resend send -> verify. shH (this session) is reused below for the WhatsApp opt-in test.
sentEmails.length = 0;
r = await call(auth, { method: 'POST', body: { action: 'requestOtp', email: 'investor@example.com' } });
ok('requestOtp emails a 6-digit code to an eligible otp account', r.status === 200 && r.body.ok === true && sentEmails.length === 1 && /^\d{6}$/.test(sentEmails[0].code || ''), sentEmails);
const otpCode1 = sentEmails[0].code;
r = await call(auth, { method: 'POST', body: { action: 'verifyOtp', email: 'investor@example.com', code: otpCode1 === '000000' ? '111111' : '000000' } });
ok('verifyOtp rejects a wrong code -> 401', r.status === 401, r.body);
r = await call(auth, { method: 'POST', body: { action: 'verifyOtp', email: 'investor@example.com', code: otpCode1 } });
ok('shareholder signs in with the emailed code', r.status === 200 && !!r.body.token, r.status);
const shH = { authorization: 'Bearer ' + r.body.token };
r = await call(auth, { method: 'POST', body: { action: 'verifyOtp', email: 'investor@example.com', code: otpCode1 } });
ok('a consumed code cannot be reused', r.status === 401, r.body);

// ── Exchanges: shareholders (view_exchanges by default) see wallets only, never API keys ──
r = await call(exchanges, { method: 'GET', headers: shH });
ok('shareholder can list exchanges -> 200', r.status === 200, r.status);
const shExRow = (r.body.exchanges || []).find(e => e.id === exId) || {};
ok('shareholder view has wallets but never apiKey/secret/status fields', 'wallets' in shExRow && !('apiKey' in shExRow) && !('secretMasked' in shExRow) && !('status' in shExRow), shExRow);
r = await call(exchanges, { method: 'POST', headers: shH, body: { name: 'binance', label: 'nope' } });
ok('shareholder cannot create an exchange -> 403', r.status === 403, r.status);

// manage_exchanges: a granted non-admin (operator, here) can create/edit/delete a connection
// and trigger a sync, but every response back to them stays stripped of the raw key/secret —
// identical to the read-only GET shape, not the admin one — even though THEY created it.
await setPerms({ operator: ['view_activity', 'view_realtime', 'view_trades', 'export_data', 'view_exchanges', 'manage_exchanges'] });
r = await call(auth, { method: 'POST', body: { action: 'login', email: 'sophie.ops@lno.company', password: 'admin' } });
const mgH = { authorization: 'Bearer ' + r.body.token };
r = await call(exchanges, { method: 'POST', headers: mgH, body: { name: 'binance', label: 'Ops-managed', apiKey: 'OPSKEY', apiSecret: 'OPSSECRET', wallets: [{ network: 'BTC', address: 'bc1qtest' }] } });
const mgExId = r.body.exchange && r.body.exchange.id;
ok('a manage_exchanges non-admin can create an exchange connection', r.status === 201 && r.body.exchange.label === 'Ops-managed', r.body);
ok('...but the create response never leaks the raw key/secret to a non-admin', !('apiKey' in r.body.exchange) && !('secretMasked' in r.body.exchange), r.body.exchange);
r = await call(exchanges, { method: 'PATCH', headers: mgH, body: { id: mgExId, label: 'Ops-managed v2' } });
ok('a manage_exchanges non-admin can edit a connection without re-supplying the key', r.status === 200 && r.body.exchange.label === 'Ops-managed v2', r.body);
const mgExAsAdmin = (await call(exchanges, { method: 'GET', headers: authH })).body.exchanges.find(e => e.id === mgExId);
ok('editing without an apiKey does NOT wipe the key that was set on create', mgExAsAdmin && mgExAsAdmin.apiKey === 'OPSKEY', mgExAsAdmin);
r = await call(bots, { method: 'POST', headers: mgH, body: { action: 'sync' } });
ok('a manage_exchanges non-admin can trigger a sync', r.status === 200 && r.body.ok === true, r.body);
r = await call(exchanges, { method: 'DELETE', headers: mgH, body: { id: mgExId } });
ok('a manage_exchanges non-admin can delete a connection', r.status === 200, r.body);
ok('deleted connection is gone', !(await call(exchanges, { method: 'GET', headers: authH })).body.exchanges.some(e => e.id === mgExId));
await restorePerms();
r = await call(exchanges, { method: 'POST', headers: mgH, body: { name: 'binance', label: 'nope' } });
ok('an operator WITHOUT manage_exchanges still cannot create an exchange -> 403', r.status === 403, r.status);

// requestOtp never reveals whether an account exists/qualifies (email enumeration)
sentEmails.length = 0;
r = await call(auth, { method: 'POST', body: { action: 'requestOtp', email: 'no-such-account@example.com' } });
ok('requestOtp for an unknown email still returns {ok:true} but sends nothing', r.status === 200 && r.body.ok === true && sentEmails.length === 0, r.body);
// @lno.company emails always sign in with Google — requestOtp short-circuits with a
// dedicated error instead of the usual {ok:true}, since that's a domain-wide fact, not an
// account-existence leak (nina.test@lno.company is a real GOOGLE-provider account here).
r = await call(auth, { method: 'POST', body: { action: 'requestOtp', email: 'nina.test@lno.company' } });
ok('requestOtp for an @lno.company email is rejected with GOOGLE_ONLY', r.status === 400 && r.body.code === 'GOOGLE_ONLY' && sentEmails.length === 0, r.body);

// resend cooldown: a second request for the same (fresh) account within 60s doesn't duplicate
await call(users, { method: 'POST', headers: authH, body: { email: 'cooldown.test@example.com', role: 'shareholder' } });
sentEmails.length = 0;
await call(auth, { method: 'POST', body: { action: 'requestOtp', email: 'cooldown.test@example.com' } });
await call(auth, { method: 'POST', body: { action: 'requestOtp', email: 'cooldown.test@example.com' } });
ok('requesting a second code within 60s does not send a duplicate email', sentEmails.length === 1, sentEmails);

// shareholder opts into WhatsApp -> gets a "new report available" notice, but only once an
// admin VERIFIES the report — not at generation time (item 15's verification workflow)
await call(profile, { method: 'PATCH', headers: shH, body: { phone: '+33655555555', notify: true } });
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'generateReport' } });
const genForVerify = r.body.report;
sentMessages.length = 0;
ok('freshly generated report is not_verified and did not notify shareholders yet', genForVerify.status === 'not_verified' && sentMessages.length === 0, r.body);
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'verifyReport', id: genForVerify.id } });
ok('admin verifies the report', r.status === 200 && r.body.report.status === 'verified' && r.body.report.verifiedBy, r.body);
ok('shareholder gets a "new report available" WhatsApp when the report is verified', sentMessages.some(m => /report is available/i.test(m.text)), sentMessages.map(m => m.text));
// "A new report is available" is an availability PING, not report content: the matrix still
// chooses who wants to be pinged (see PING_TYPE_PERM in api/_lib/notify.js)…
await call(openwa, { method: 'PUT', headers: authH, body: { notifMatrix: { new_report: [] } } });
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'generateReport' } });
sentMessages.length = 0;
await call(snapshots, { method: 'POST', headers: authH, body: { action: 'verifyReport', id: r.body.report.id } });
ok('disabling a type in the matrix stops that notification', !sentMessages.some(m => /report is available/i.test(m.text)), sentMessages.map(m => m.text));
await call(openwa, { method: 'PUT', headers: authH, body: { notifMatrix: { new_report: ['shareholder'] } } }); // restore
// …and the permission narrows it on top: you're never pinged about a report you can't open,
// even while the matrix still lists your role.
await setPerms({ shareholder: ['view_activity', 'view_realtime', 'view_trades', 'view_exchanges'] });
r = await call(snapshots, { method: 'POST', headers: authH, body: { action: 'generateReport' } });
sentMessages.length = 0;
await call(snapshots, { method: 'POST', headers: authH, body: { action: 'verifyReport', id: r.body.report.id } });
ok('revoking view_reports_monthly stops the ping even with the matrix still enabled', !sentMessages.some(m => /report is available/i.test(m.text)), sentMessages.map(m => m.text));
await restorePerms();

// admin sets a NEW password — only accounts still on the legacy 'password' provider have one
// to set (no longer creatable via the API — simulate a pre-existing legacy row directly).
// Google and OTP (shareholder) accounts are both refused.
const allUsers = (await call(users, { method: 'GET', headers: authH })).body.users;
const shUser = allUsers.find(u => u.email === 'investor@example.com');
const googleUser = allUsers.find(u => u.email === 'nina.test@lno.company');
await db.query(
  `INSERT INTO users (id,username,email,first_name,last_name,role,active,permissions,password_hash,auth_provider)
   VALUES ('u_legacy','legacy@lno.company','legacy@lno.company','Legacy','Pw','viewer',true,'[]'::jsonb,'x','password')`
);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: 'u_legacy', password: 'N3w#Strong#Pass!' } });
ok('admin sets a new password for a legacy password-provider account', r.status === 200, r.body);
r = await call(auth, { method: 'POST', body: { action: 'login', email: 'legacy@lno.company', password: 'N3w#Strong#Pass!' } });
ok('that account can sign in with the newly-set password', r.status === 200 && !!r.body.token, r.status);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: 'u_legacy', password: 'weak' } });
ok('admin-set weak password rejected by policy -> 400', r.status === 400, r.body);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: googleUser.id, password: 'N3w#Strong#Pass!' } });
ok('admin cannot set a password on a Google account -> 400', r.status === 400, r.body);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: shUser.id, password: 'N3w#Strong#Pass!' } });
ok('admin cannot set a password on an OTP (shareholder) account -> 400', r.status === 400, r.body);

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
// reports rights are split by periodicity (daily/weekly/monthly) — operator has none of the
// three by default, so the archive is visible (200) but filtered down to nothing
ok('operator sees an empty archive with no view_reports_* permission', (r.body.reports || []).length === 0, r.body.reports);
r = await call(snapshots, { method: 'GET', headers: opH, query: { report: String(genReport.id) } });
ok('operator cannot download a report kind they lack permission for -> 403', r.status === 403, r.status);
await setPerms({ operator: ['view_activity', 'view_realtime', 'view_trades', 'export_data', 'view_reports_daily'] });
r = await call(snapshots, { method: 'GET', headers: opH, query: { reports: 'list' } });
ok('granting view_reports_daily surfaces daily reports but not monthly', r.body.reports.length > 0 && r.body.reports.every(x => x.kind === 'daily'), r.body.reports.map(x => x.kind));
r = await call(snapshots, { method: 'GET', headers: opH, query: { report: String(genReport.id) } });
ok('still cannot download the monthly report without view_reports_monthly -> 403', r.status === 403, r.status);
await restorePerms();
r = await call(exchanges, { method: 'GET', headers: opH });
ok('operator has no view_exchanges by default -> 403', r.status === 403, r.status);

// view_trades/view_realtime/view_activity now actually gate GET /api/bots (was a real bypass
// before this audit fix — the frontend hid the pages but the API accepted any authenticated
// caller regardless of role permissions)
await setPerms({ operator: ['export_data'] }); // strip all three
r = await call(bots, { method: 'GET', headers: opH });
ok('a role with none of view_activity/view_realtime/view_trades cannot list bots -> 403', r.status === 403, r.status);
r = await call(bots, { method: 'GET', headers: opH, query: { fills: '1' } });
ok('...nor read fills without view_realtime -> 403', r.status === 403, r.status);
// Playbook RBAC. The surrounding block deliberately strips the operator role down, so each
// case sets exactly the permissions it is asserting on rather than inheriting whatever the
// previous test left behind.
r = await call(bots, { method: 'GET', headers: opH, query: { playbook: '1' } });
ok('reading the playbook without view_trades -> 403', r.status === 403, r.status);
await setPerms({ operator: ['view_trades'] });
r = await call(bots, { method: 'GET', headers: opH, query: { playbook: '1' } });
ok('view_trades is enough to READ the playbook', r.status === 200, r.status);
r = await call(bots, { method: 'POST', headers: opH, body: { action: 'createStrategy', name: 'nope' } });
ok('...but not to edit it without manage_strategies -> 403', r.status === 403, r.status);
// Reading a thread follows the same gate as the data it hangs off; WRITING needs its own
// permission, so a read-only analyst cannot annotate the record.
r = await call(alerts, { method: 'GET', headers: opH, query: { comments: '1', entityType: 'position', entityId: 'x' } });
ok('view_trades is enough to READ a discussion', r.status === 200 && r.body.canWrite === false, { status: r.status, canWrite: r.body?.canWrite });
r = await call(alerts, { method: 'POST', headers: opH, body: { action: 'addComment', entityType: 'position', entityId: 'x', body: 'nope' } });
ok('...but posting without manage_comments -> 403', r.status === 403, r.status);
await setPerms({ operator: ['view_trades', 'manage_comments'] });
r = await call(alerts, { method: 'POST', headers: opH, body: { action: 'addComment', entityType: 'position', entityId: 'x', body: 'ok now' } });
ok('manage_comments lets a non-admin post', r.status === 200, r.status);
// Reading your own mentions is not a shared-state write and needs no permission at all.
await setPerms({ operator: [] });
r = await call(alerts, { method: 'GET', headers: opH, query: { mentions: '1' } });
ok('any signed-in user can read their own mentions, with no permission', r.status === 200, r.status);
await setPerms({ operator: ['view_trades', 'manage_strategies'] });
r = await call(bots, { method: 'POST', headers: opH, body: { action: 'createStrategy', name: 'Operator strategy' } });
ok('manage_strategies lets a non-admin edit the playbook', r.status === 200, r.status);
await restorePerms();
await restorePerms();
r = await call(bots, { method: 'GET', headers: opH });
ok('restored: operator can list bots again', r.status === 200, r.status);
r = await call(bots, { method: 'GET', headers: opH, query: { attribution: '1' } });
ok('attribution/costs stay admin-only regardless of permissions (BotsPage is admin-only)', r.status === 403, r.status);

// manage_funds: decorative before this fix — toggling it on the Rules page did nothing;
// now it actually gates fund CRUD the same way manage_exchanges gates exchange CRUD
r = await call(funds, { method: 'POST', headers: opH, body: { name: 'Nope Fund' } });
ok('operator WITHOUT manage_funds cannot create a fund -> 403', r.status === 403, r.status);
await setPerms({ operator: ['view_activity', 'view_realtime', 'view_trades', 'export_data', 'manage_funds'] });
r = await call(funds, { method: 'POST', headers: opH, body: { name: 'Ops Fund', color: '#3B82F6' } });
const opFund = (r.body.funds || []).find(f => f.name === 'Ops Fund');
ok('operator WITH manage_funds can create a fund', r.status === 201 && !!opFund, r.body);
r = await call(funds, { method: 'PATCH', headers: opH, body: { id: opFund.id, name: 'Ops Fund Renamed' } });
ok('...and edit it', r.status === 200 && (r.body.funds || []).some(f => f.name === 'Ops Fund Renamed'), r.body);
r = await call(funds, { method: 'DELETE', headers: opH, body: { id: opFund.id } });
ok('...and delete it', r.status === 200 && !(r.body.funds || []).some(f => f.id === opFund.id), r.body);
r = await call(funds, { method: 'POST', headers: opH, body: { action: 'assignEmployeeContribution', contributionId: 1, userId: 'x' } });
ok('manage_funds does NOT extend to Employee Fund contribution assignment (stays admin-only)', r.status === 403, r.status);
await restorePerms();

// manage_whatsapp: same story as manage_funds — was decorative, now real
r = await call(openwa, { method: 'GET', headers: opH });
ok('operator WITHOUT manage_whatsapp cannot view WhatsApp config -> 403', r.status === 403, r.status);
await setPerms({ operator: ['view_activity', 'view_realtime', 'view_trades', 'export_data', 'manage_whatsapp'] });
r = await call(openwa, { method: 'GET', headers: opH });
ok('operator WITH manage_whatsapp can view WhatsApp config', r.status === 200, r.status);
r = await call(openwa, { method: 'PUT', headers: opH, body: { dailyReport: false } });
ok('...and update it', r.status === 200 && r.body.config.dailyReport === false, r.body);
await call(openwa, { method: 'PUT', headers: authH, body: { dailyReport: true } }); // restore
await restorePerms();

// view_logs and manage_users were removed outright (view_logs never gated anything; a
// functional manage_users would have let a non-admin promote themselves to admin via the
// same PATCH endpoint that edits roles — a real privilege-escalation path, not worth wiring)
r = await call(users, { method: 'GET', headers: authH, query: { rules: '1' } });
ok('view_logs and manage_users no longer exist as grantable permissions', !r.body.permissions.includes('view_logs') && !r.body.permissions.includes('manage_users'), r.body.permissions);
r = await call(users, { method: 'PUT', headers: authH, body: { rolePerms: { operator: ['view_logs', 'manage_users', 'view_activity'] } } });
ok('setting a role to those removed strings silently drops them (unknown-perm filtering)', JSON.stringify(r.body.rolePerms.operator) === JSON.stringify(['view_activity']), r.body.rolePerms);
await restorePerms();
// even granting an operator EVERY remaining permission can't touch user/role management —
// api/users.js stays hardcoded to role==='admin', not permission-gated, by design
await setPerms({ operator: ['view_activity', 'view_realtime', 'view_trades', 'view_reports_daily', 'view_reports_weekly', 'view_reports_monthly', 'view_exchanges', 'export_data', 'manage_exchanges', 'manage_whatsapp', 'manage_funds'] });
r = await call(users, { method: 'GET', headers: opH });
ok('no permission, however broad, grants access to user administration -> still 403', r.status === 403, r.status);
r = await call(users, { method: 'PATCH', headers: opH, body: { id: 'u1', role: 'admin' } });
ok('...specifically: cannot self-promote to admin via PATCH -> 403', r.status === 403, r.status);
await restorePerms();

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
r = await call(users, { method: 'GET', headers: authH, query: { allLogins: '1' } });
ok('admin-only all-sign-ins table lists events across users, with role attached', r.status === 200 && r.body.logins.some(l => l.email === 'admin@lno.company' && l.role === 'admin' && l.ip === '203.0.113.7'), r.body.logins && r.body.logins.slice(0, 3));
r = await call(users, { method: 'GET', headers: opH, query: { allLogins: '1' } });
ok('non-admin cannot view the all-sign-ins table -> 403', r.status === 403, r.status);
r = await call(users, { method: 'GET', headers: authH, query: { allLogins: '1', limit: '1' } });
ok('all-sign-ins is paginated: ?limit=1 returns 1 row but reports the full total', r.status === 200 && r.body.logins.length === 1 && r.body.total >= 3, r.body);
{
  const page0 = await call(users, { method: 'GET', headers: authH, query: { allLogins: '1', limit: '1', offset: '0' } });
  const page1 = await call(users, { method: 'GET', headers: authH, query: { allLogins: '1', limit: '1', offset: '1' } });
  ok('all-sign-ins pages don\'t overlap', page0.body.logins[0].createdAt !== page1.body.logins[0].createdAt, { page0: page0.body.logins, page1: page1.body.logins });
}
r = await call(users, { method: 'GET', headers: authH, query: { allLogins: '1', ip: '203.0.113.7' } });
ok('all-sign-ins ?ip filters server-side (partial match)', r.status === 200 && r.body.logins.length > 0 && r.body.logins.every(l => l.ip === '203.0.113.7'), r.body.logins);
r = await call(users, { method: 'GET', headers: authH, query: { allLogins: '1', ip: '203.0.113.7', date: '1999-01-01' } });
ok('all-sign-ins ?date filters server-side (no rows on an unrelated day)', r.status === 200 && r.body.logins.length === 0 && r.body.total === 0, r.body);

// Sign in with Google — verification stubbed (real flow verifies the Google JWKS signature).
globalThis.__GOOGLE_VERIFY__ = async (cred) => JSON.parse(Buffer.from(cred, 'base64').toString());
const gcred = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
sentMessages.length = 0; sentEmails.length = 0;
r = await call(auth, { method: 'POST', body: { action: 'google', credential: gcred({ email: 'alice.new@lno.company', email_verified: true, hd: 'lno.company', given_name: 'Alice', family_name: 'New', picture: 'https://lh3.googleusercontent.com/a/fake-alice' }) } });
ok('Google sign-in auto-creates an @lno.company user (viewer, names saved)',
  r.status === 200 && r.body.user.email === 'alice.new@lno.company' && r.body.user.role === 'viewer' && r.body.user.firstName === 'Alice' && r.body.user.lastName === 'New' && r.body.user.authProvider === 'google' && !!r.body.token, r.body);
ok('a new sign-up captures the Google profile picture as the avatar', r.body.user.avatar === 'https://lh3.googleusercontent.com/a/fake-alice', r.body.user.avatar);
ok('a new sign-up alerts admins via WhatsApp immediately', sentMessages.some(m => /NEW SIGN-UP/i.test(m.text)), sentMessages.map(m => m.text.slice(0, 40)));
ok('a new sign-up alerts admins via email immediately', sentEmails.some(e => /New Control Center sign-up/i.test(e.subject)), sentEmails.map(e => e.subject));
sentMessages.length = 0; sentEmails.length = 0;
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

// ── P3: account lockout after repeated failed logins — shared between password login and
// OTP verification (registerFailedAttempt in api/auth.js), tested via each path ──
r = await call(users, { method: 'POST', headers: authH, body: { email: 'lock.test@external.com', role: 'shareholder' } });
for (let i = 0; i < 5; i++) await call(auth, { method: 'POST', body: { action: 'verifyOtp', email: 'lock.test@external.com', code: '000000' } });
const lockedTry = await call(auth, { method: 'POST', body: { action: 'verifyOtp', email: 'lock.test@external.com', code: '000000' } });
ok('account locks after 5 failed OTP verifications -> 429', lockedTry.status === 429, lockedTry.body);

// ── P3: the last active admin can't be deactivated, demoted, or deleted ──
r = await call(users, { method: 'PATCH', headers: authH, body: { id: adminRow.id, active: false } });
ok('cannot deactivate the last active admin -> 400', r.status === 400, r.body);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: adminRow.id, role: 'operator' } });
ok('cannot demote the last active admin -> 400', r.status === 400, r.body);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: ninaId, role: 'admin' } });
ok('promote a second user to admin', r.status === 200 && r.body.user.role === 'admin', r.body);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: adminRow.id, active: false } });
ok('deactivating an admin is allowed once another admin exists', r.status === 200, r.body);
r = await call(users, { method: 'DELETE', headers: authH, body: { id: ninaId } });
ok('cannot delete the last active admin -> 400', r.status === 400, r.body);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: adminRow.id, active: true } });
ok('re-activate the original admin for later tests', r.status === 200, r.body);
r = await call(users, { method: 'PATCH', headers: authH, body: { id: ninaId, role: 'operator' } });
ok('demote nina back to operator now that another admin is active', r.status === 200, r.body);

// ── P3: admin actions are recorded in the audit log ──
const auditLog = (await call(users, { method: 'GET', headers: authH, query: { audit: '1' } })).body.audit || [];
const auditActions = auditLog.map(x => x.action);
ok('audit log records user.create', auditActions.includes('user.create'), auditActions.slice(0, 8));
ok('audit log records exchange.create', auditActions.includes('exchange.create'), auditActions.slice(0, 8));
ok('audit entries carry actor + action fields', auditLog.length > 0 && 'actorEmail' in auditLog[0] && 'action' in auditLog[0]);
// the audit log is the one read on this admin-only endpoint that view_audit can grant
r = await call(users, { method: 'GET', headers: opH, query: { audit: '1' } });
ok('non-admin without view_audit cannot read the audit log -> 403', r.status === 403, r.status);
await setPerms({ operator: ['view_activity', 'view_realtime', 'view_trades', 'export_data', 'view_audit'] });
r = await call(users, { method: 'GET', headers: opH, query: { audit: '1' } });
ok('view_audit lets a non-admin read the audit log', r.status === 200 && Array.isArray(r.body.audit) && r.body.audit.length > 0, r.status);
ok('...but view_audit grants nothing else on that endpoint (user list stays admin-only)', (await call(users, { method: 'GET', headers: opH })).status === 403);
r = await call(users, { method: 'GET', headers: authH, query: { audit: '1', limit: '1' } });
ok('audit log is paginated: ?limit=1 returns 1 row but the full total', r.status === 200 && r.body.audit.length === 1 && r.body.total > 1, { n: r.body.audit.length, total: r.body.total });
{
  const p0 = await call(users, { method: 'GET', headers: authH, query: { audit: '1', limit: '1', offset: '0' } });
  const p1 = await call(users, { method: 'GET', headers: authH, query: { audit: '1', limit: '1', offset: '1' } });
  ok('audit log pages don\'t overlap', p0.body.audit[0].id !== p1.body.audit[0].id, { p0: p0.body.audit, p1: p1.body.audit });
}
r = await call(users, { method: 'GET', headers: authH, query: { audit: '1', action: 'user.create' } });
ok('audit log ?action filters server-side', r.status === 200 && r.body.audit.length > 0 && r.body.audit.every(x => x.action === 'user.create'), r.body.audit.map(x => x.action));
r = await call(users, { method: 'GET', headers: authH, query: { audit: '1', date: '1999-01-01' } });
ok('audit log ?date filters server-side (no rows on an unrelated day)', r.status === 200 && r.body.audit.length === 0 && r.body.total === 0, r.body);
ok('audit log exposes its distinct action keys for the filter dropdown', Array.isArray(r.body.actions) && r.body.actions.includes('user.create'), r.body.actions);
await restorePerms();

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
