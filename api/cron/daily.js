// Daily cron (Vercel Cron, see vercel.json): sync positions from connected exchanges,
// record the equity snapshot, fire threshold alerts, and send the WhatsApp reports
// (global + per-fund, grouped by fund with a colour emoji). Secured by CRON_SECRET or an admin JWT.
// Every WhatsApp message is rendered per-recipient in their own users.language (see
// api/_lib/notifyText.js) — notify() calls the builder once per recipient's language.
//
// ?mode=alerts — everything EXCEPT the daily/weekly/monthly report sends: sync, snapshot,
// breach + dormant-bot alerts only. This is what a frequent external trigger (see
// .github/workflows/alert-check.yml) hits every ~10 minutes so alerts fire 24/7 independently
// of anyone visiting the site or of Vercel's own Cron feature (Hobby plan caps that at
// once/day) — while the once-daily report sends stay exactly once/day, driven only by the
// real Vercel Cron (no ?mode=alerts) at its scheduled time.
import { riskMetrics } from '../_lib/metrics.js';
import { buildPortfolio } from '../_lib/portfolio.js';
import { getOpenWAConfig, notify, getUsersByRole, rolesForType, rolesWithReportAccess } from '../_lib/notify.js';
import { reportText, breachAlertText, dormantAlertText, dailyDigestText, verifyReminderText } from '../_lib/notifyText.js';
import { syncExchanges } from '../_lib/sync.js';
import { recordDailyFundSnapshot } from '../_lib/employeeFund.js';
import { buildMonthlyPdf, buildDailyPdf } from '../_lib/report.js';
import { sendDailyReportEmail, sendVerifyReminderEmail } from '../_lib/mailer.js';
import { getAuth } from '../_lib/auth.js';
import { query } from '../_lib/db.js';

const REPORTS_URL = 'https://cc.lno.company/#/admin/reports?status=not_verified';

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const h = req.headers.authorization || '';
  if (secret && h === `Bearer ${secret}`) return true;     // Vercel cron
  const a = getAuth(req); if (a && a.role === 'admin') return true; // manual admin trigger
  return false;
}

// Must match DORMANT_HOURS in src/ui.tsx (frontend's dormantInfo()) so the "dormant" badge
// shown in the UI and this alert agree on the same threshold.
const DORMANT_HOURS = 48;

const grp = (n) => Math.round(Math.abs(n)).toLocaleString('en-US').replace(/,/g, ' ');
const fmt = (n) => (n >= 0 ? '+' : '-') + grp(n) + ' USDT';

async function equitySeries() {
  const { rows } = await query('SELECT day, equity FROM equity_snapshots ORDER BY day ASC');
  return rows.map(r => ({ t: (r.day instanceof Date ? r.day.getTime() : new Date(r.day).getTime()), equity: Number(r.equity) }));
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  const alertsOnly = req.query?.mode === 'alerts';
  try {
    // 1) refresh bots + equity from connected exchanges (best-effort)
    let synced = null; try { synced = await syncExchanges(); } catch (e) { synced = { error: String(e.message || e) }; }
    const cfg = await getOpenWAConfig();

    // 2) build the real-data portfolio + record today's equity snapshot
    const port = await buildPortfolio();
    const today = new Date().toISOString().slice(0, 10);
    await query(
      `INSERT INTO equity_snapshots (day,equity,pnl_day,metrics) VALUES ($1,$2,$3,'{}'::jsonb)
       ON CONFLICT (day) DO UPDATE SET equity=$2, pnl_day=$3`,
      [today, Math.round(port.equity), Math.round(port.pnlDay)]
    );
    const series = await equitySeries();
    const m = riskMetrics(series);
    await query('UPDATE equity_snapshots SET metrics=$2::jsonb WHERE day=$1',
      [today, JSON.stringify({ sharpe: m.sharpe, sortino: m.sortino, maxDrawdownPct: m.maxDrawdownPct, ddDurationDays: m.ddDurationDays })]);
    try { await recordDailyFundSnapshot(); } catch (e) { /* best-effort, doesn't block the rest of the cron */ }

    // 3) threshold alerts (global portfolio): drawdown from history, daily PnL from the sync.
    // Structured (not pre-formatted English) so breachAlertText() can render them per language;
    // breachSummaries stays English — it's only ever stored in the admin-only alerts.summary column.
    const breaches = [];
    const breachSummaries = [];
    const ddLimit = Math.abs(cfg.drawdownPct ?? 10);
    const pnlLimit = cfg.pnlDayThreshold ?? -5000;
    if (m.maxDrawdownPct <= -ddLimit) {
      breaches.push({ kind: 'drawdown', pct: m.maxDrawdownPct, limit: ddLimit });
      breachSummaries.push(`Portfolio: drawdown ${m.maxDrawdownPct.toFixed(1)}% (limit -${ddLimit}%)`);
    }
    if (port.pnlDay <= pnlLimit) {
      breaches.push({ kind: 'pnlDay', pnl: port.pnlDay, limit: pnlLimit });
      breachSummaries.push(`Portfolio: daily PnL ${fmt(port.pnlDay)} (limit ${fmt(pnlLimit)})`);
    }

    const sent = [];
    // Edge-triggered dedup: the alerts-only cron fires every ~10 minutes (see
    // .github/workflows/alert-check.yml), so without this both breach and dormant-bot
    // alerts would re-send the exact same WhatsApp/email every single run for as long as
    // the condition persists — sometimes for hours. Instead we only notify the FIRST time
    // a given breach kind (or a given bot's dormancy) is seen, tracked in app_config, and
    // clear the tracked state the moment the condition resolves so a future recurrence can
    // alert again. Same philosophy as the api_error "fresh failure only" gate in sync.js.
    const currentBreachKinds = breaches.map(b => b.kind);
    {
      const prevRow = (await query("SELECT value FROM app_config WHERE key='breachActiveKinds'")).rows[0];
      const prevKinds = Array.isArray(prevRow?.value) ? prevRow.value : [];
      const newKinds = currentBreachKinds.filter(k => !prevKinds.includes(k));
      if (newKinds.length && cfg.enabled) {
        const code = Math.random().toString(36).slice(2, 6).toUpperCase();
        await query("INSERT INTO alerts (type,code,summary) VALUES ('breach',$1,$2)", [code, breachSummaries.join(' · ')]);
        sent.push({ type: 'alert', code, newKinds, ...(await notify((lang) => breachAlertText(lang, breaches, port, code), { type: 'breach' })) });
      }
      await query(`INSERT INTO app_config (key,value) VALUES ('breachActiveKinds',$1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`, [JSON.stringify(currentBreachKinds)]);
    }

    // 3b) dormant bots: an open position whose side/qty/entry hasn't changed in DORMANT_HOURS
    const dormant = port.bots.filter(b => b.last_changed && (Date.now() - new Date(b.last_changed).getTime()) / 3600000 >= DORMANT_HOURS);
    {
      // last_changed round-trips as a JS Date from the driver but as a plain ISO string once
      // stored in the JSONB config — normalize both sides to ISO before comparing, otherwise
      // Date !== string is always true and every poll looks "newly" dormant.
      const isoOf = (v) => new Date(v).toISOString();
      const prevRow = (await query("SELECT value FROM app_config WHERE key='dormantAlerted'")).rows[0];
      const prevMap = (prevRow?.value && typeof prevRow.value === 'object') ? prevRow.value : {};
      const newlyDormant = dormant.filter(b => prevMap[b.id] !== isoOf(b.last_changed));
      if (newlyDormant.length && cfg.enabled) {
        const dormantData = newlyDormant.map(b => ({ symbol: b.symbol, side: b.side, hours: Math.round((Date.now() - new Date(b.last_changed).getTime()) / 3600000) }));
        sent.push({ type: 'stale', ...(await notify((lang) => dormantAlertText(lang, dormantData), { type: 'stale' })) });
      }
      const nextMap = Object.fromEntries(dormant.map(b => [b.id, isoOf(b.last_changed)]));
      await query(`INSERT INTO app_config (key,value) VALUES ('dormantAlerted',$1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`, [JSON.stringify(nextMap)]);
    }

    // 4) reports — global + per-fund, grouped by fund. Skipped entirely in ?mode=alerts so a
    // frequent trigger can never re-send the daily/weekly/monthly reports — only the real
    // once-daily Vercel Cron run (no mode param) reaches this block.
    if (!alertsOnly) {
      const eqv = series.map(s => s.equity);
      const pnlOver = (d) => eqv.length ? eqv[eqv.length - 1] - eqv[Math.max(0, eqv.length - 1 - d)] : 0;
      const pctOver = (d) => { const base = eqv[Math.max(0, eqv.length - 1 - d)] || 0; return base ? (pnlOver(d) / base) * 100 : 0; };

      if ((cfg.dailyReport ?? true) && cfg.enabled) {
        // pnlOver(1)/pctOver(1), NOT port.pnlDay/pnlPct: the latter compares against
        // whatever equity_snapshots row is "most recent," but that row gets continuously
        // overwritten intraday by the every-5-minute alerts-only cron — so port.pnlDay can
        // end up reflecting the last few minutes rather than a full day. pnlOver(1) always
        // diffs against yesterday's distinct snapshot row, a true ~24h-ago comparison.
        const pnlDay24 = pnlOver(1), pctDay24 = pctOver(1);
        const openPositions = port.bots.filter(b => b.status === 'open').map(b => ({ symbol: b.symbol, side: b.side, unrealizedPnl: Number(b.unrealized_pnl || 0), notional: Number(b.notional || 0) }));
        // "Incidents" = service-health problems (exchange API/data feed), not portfolio
        // performance threshold breaches (drawdown/PnL) — those are a different alert type.
        const { rows: incidentRows } = await query("SELECT count(*)::int AS n FROM alerts WHERE type='api_error' AND created_at > now() - interval '24 hours'");
        const incidentCount = incidentRows[0]?.n || 0;

        // Daily report: PDF archived (auto-verified — internal-only, no shareholder ever
        // waits on it), full HTML in the email body (not a PDF attachment) to every internal
        // role, and a short digest on WhatsApp (admin/operator) — three different formats of
        // the same underlying numbers, matched to what each channel is good at.
        try {
          const b64 = await buildDailyPdf({ equity: port.equity, pnlDay: pnlDay24, pctDay: pctDay24, openPnl: port.openPnl, exposure: port.exposure, funds: port.funds, positions: openPositions, incidentCount, dateLabel: today, series: eqv.slice(-14) });
          await query("INSERT INTO reports (kind,period_label,equity,pnl,pdf_base64,status,verified_by,verified_at) VALUES ('daily',$1,$2,$3,$4,'verified','system',now())",
            [today, Math.round(port.equity), Math.round(pnlDay24), b64]);
          sent.push({ type: 'daily-pdf', archived: true, bytes: b64.length });
        } catch (e) { sent.push({ type: 'daily-pdf', error: String(e.message || e) }); }

        try {
          // Internal-email recipients are further restricted to roles holding
          // view_reports_daily — being 'admin'/'operator'/'viewer' alone isn't enough if
          // that permission was unchecked on the Rules page (see rolesWithReportAccess).
          const emailRoles = await rolesWithReportAccess(['admin', 'operator', 'viewer'], 'daily');
          const recipients = await getUsersByRole(emailRoles);
          for (const r of recipients) await sendDailyReportEmail(r.email, { equity: port.equity, pnlDay: pnlDay24, pctDay: pctDay24, openPnl: port.openPnl, exposure: port.exposure, funds: port.funds, positions: openPositions, incidentCount, dateLabel: today, series: eqv.slice(-14) }).catch(() => {});
          sent.push({ type: 'daily-email', recipients: recipients.length });
        } catch (e) { sent.push({ type: 'daily-email', error: String(e.message || e) }); }

        sent.push({ type: 'report', ...(await notify((lang) => dailyDigestText(lang, { equity: port.equity, pnlDay: pnlDay24, pctDay: pctDay24, openCount: openPositions.length, incidentCount }), { type: 'daily' })) });
      }
      const force = req.query?.force;
      const dt = new Date();
      if (cfg.enabled && (dt.getUTCDay() === 1 || force === 'weekly' || force === 'all')) {
        sent.push({ type: 'weekly', ...(await notify((lang) => reportText(lang, 'weekly', port, { pnl: pnlOver(7), pct: pctOver(7), labelKey: 'period7d' }), { type: 'weekly' })) });
      }
      if (dt.getUTCDate() === 1 || force === 'monthly' || force === 'all') {
        const pnl30 = pnlOver(30);
        if (cfg.enabled) sent.push({ type: 'monthly', ...(await notify((lang) => reportText(lang, 'monthly', port, { pnl: pnl30, pct: pctOver(30), labelKey: 'period30d' }), { type: 'monthly' })) });
        try {
          const monthPositions = port.bots.filter(b => b.status === 'open').map(b => ({ symbol: b.symbol, side: b.side, unrealizedPnl: Number(b.unrealized_pnl || 0), notional: Number(b.notional || 0) }));
          const b64 = await buildMonthlyPdf({ equity: port.equity, pnl30, openPnl: port.openPnl, exposure: port.exposure, maxDrawdownPct: m.maxDrawdownPct, ddDurationDays: m.ddDurationDays, sharpe: m.sharpe, sortino: m.sortino, funds: port.funds, positions: monthPositions, dateLabel: today, series: eqv.slice(-60) });
          // status stays the column default ('not_verified') — monthly is the shareholder-
          // facing kind, so an admin must verify it (see api/snapshots.js) before shareholders
          // are notified; that's what used to happen automatically right here.
          try { await query('INSERT INTO reports (kind,period_label,equity,pnl,pdf_base64) VALUES ($1,$2,$3,$4,$5)', ['monthly', today, Math.round(port.equity), Math.round(pnl30), b64]); } catch (e) {}
          sent.push({ type: 'monthly-pdf', archived: true, bytes: b64.length });
        } catch (e) { sent.push({ type: 'monthly-pdf', error: String(e.message || e) }); }
      }
    }

    // 5) 8am verification reminder (item 15) — runs in EITHER mode (so the frequent
    // alerts-only cron catches the window too), gated to a 5-minute slot once a day so it
    // matches the alerts-only cron's own cadence without spamming on every invocation.
    try {
      const now = new Date();
      if (now.getUTCHours() === 8 && now.getUTCMinutes() < 5) {
        const todayKey = today;
        const flagRow = (await query("SELECT value FROM app_config WHERE key='lastVerifyReminderDay'")).rows[0];
        if ((flagRow?.value) !== todayKey) {
          const { rows: unverified } = await query("SELECT kind, period_label FROM reports WHERE status='not_verified' ORDER BY created_at ASC");
          if (unverified.length) {
            const names = unverified.map(r => `${r.kind} — ${r.period_label}`);
            const admins = await getUsersByRole(await rolesForType(cfg, 'verify_reminder'));
            for (const a2 of admins) await sendVerifyReminderEmail(a2.email, names, REPORTS_URL).catch(() => {});
            const waResult = await notify((lang) => verifyReminderText(lang, names, REPORTS_URL), { type: 'verify_reminder' });
            sent.push({ type: 'verify-reminder', count: unverified.length, emailed: admins.length, ...waResult });
          }
          await query(`INSERT INTO app_config (key,value) VALUES ('lastVerifyReminderDay',$1::jsonb)
             ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`, [JSON.stringify(todayKey)]);
        }
      }
    } catch (e) { sent.push({ type: 'verify-reminder', error: String(e.message || e) }); }

    res.status(200).json({ ok: true, alertsOnly, synced, equity: port.equity, pnlDay: port.pnlDay, metrics: m, breaches, sent });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
