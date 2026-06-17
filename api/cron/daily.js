// Daily alert cron (Vercel Cron, see vercel.json). Recomputes portfolio metrics
// server-side from real klines, fires threshold alerts, and sends the daily report
// via OpenWA. Secured by CRON_SECRET (Vercel sets the Bearer header) or an admin JWT.
import { computePortfolio, riskMetrics, sumSeries } from '../_lib/metrics.js';
import { getOpenWAConfig, notify, REPORT_AVAILABLE } from '../_lib/notify.js';
import { buildMonthlyPdf } from '../_lib/report.js';
import { getAuth } from '../_lib/auth.js';
import { query } from '../_lib/db.js';
import { BASE_BOTS } from '../_lib/constants.js';

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const h = req.headers.authorization || '';
  if (secret && h === `Bearer ${secret}`) return true;     // Vercel cron
  const a = getAuth(req); if (a && a.role === 'admin') return true; // manual admin trigger
  return false;
}

const grp  = (n) => Math.round(Math.abs(n)).toLocaleString('en-US').replace(/,/g, ' '); // 1 000
const fmt  = (n) => (n >= 0 ? '+' : '-') + grp(n) + ' USDT';   // signed amount in USDT
const fUSD = (n) => grp(n) + ' USDT';                          // unsigned amount in USDT
const fPct = (n) => (n >= 0 ? '+' : '-') + Math.abs(n).toFixed(1) + '%';

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const cfg = await getOpenWAConfig();
    const p = await computePortfolio();
    const m = riskMetrics(p.series);

    // record today's equity snapshot (real recorded history, one row/day)
    const day = new Date(p.series[p.series.length - 1].t).toISOString().slice(0, 10);
    await query(
      `INSERT INTO equity_snapshots (day,equity,pnl_day,metrics) VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (day) DO UPDATE SET equity=$2, pnl_day=$3, metrics=$4::jsonb`,
      [day, Math.round(m.totalEquity), Math.round(m.pnlDay),
       JSON.stringify({ sharpe: m.sharpe, sortino: m.sortino, maxDrawdownPct: m.maxDrawdownPct, ddDurationDays: m.ddDurationDays, pnlWeek: m.pnlWeek })]
    );

    const breaches = [];
    // global portfolio thresholds
    const ddLimit = Math.abs(cfg.drawdownPct ?? 10);
    const pnlLimit = cfg.pnlDayThreshold ?? -5000;
    if (m.maxDrawdownPct <= -ddLimit) breaches.push(`Portfolio: drawdown ${m.maxDrawdownPct.toFixed(1)}% (limit -${ddLimit}%)`);
    if (m.pnlDay <= pnlLimit) breaches.push(`Portfolio: daily PnL ${fmt(m.pnlDay)} (limit ${fmt(pnlLimit)})`);

    // scoped rules (per fund / per bot)
    const funds = (await query('SELECT id,name,bots FROM funds')).rows;
    const scopeSeries = (scope) => {
      if (scope === 'portfolio') return p.series;
      if (scope.startsWith('fund:')) { const f = funds.find(x => x.id === scope.slice(5)); return f ? sumSeries((f.bots || []).map(id => p.per[id]).filter(Boolean)) : null; }
      if (scope.startsWith('bot:')) { const b = p.per[scope.slice(4)]; return b ? b.series : null; }
      return null;
    };
    const scopeLabel = (scope) => scope === 'portfolio' ? 'Portfolio'
      : scope.startsWith('fund:') ? (funds.find(x => x.id === scope.slice(5))?.name || 'Fund')
      : (BASE_BOTS.find(b => b.id === scope.slice(4))?.name || 'Bot');

    // ── report formatting: a global section then one section per fund ──
    // each section = Equity + period PnL (amount in USDT • % over the period)
    const reportBlock = (series, days, label) => {
      const eq = series.map(s => s.equity);
      const last = eq[eq.length - 1];
      const base = eq[Math.max(0, eq.length - 1 - days)];
      const pnl = last - base;
      const pct = base ? (pnl / base) * 100 : 0;
      return `Equity ${fUSD(last)}\nPnL ${label} ${fmt(pnl)} • ${fPct(pct)}`;
    };
    const buildReport = (title, days, label) => {
      let out = `*${title}*\n\n${reportBlock(p.series, days, label)}`;
      for (const f of funds) {
        const s = scopeSeries(`fund:${f.id}`);
        if (s && s.length >= 2) out += `\n\n*${f.name}*\n${reportBlock(s, days, label)}`;
      }
      return out;
    };
    for (const rule of (cfg.alertRules || []).filter(r => r && r.enabled)) {
      const s = scopeSeries(rule.scope); if (!s || s.length < 2) continue;
      const rm = riskMetrics(s); const val = Number(rule.value); let breach = null;
      if (rule.metric === 'drawdown' && rm.maxDrawdownPct <= -Math.abs(val)) breach = `drawdown ${rm.maxDrawdownPct.toFixed(1)}% (limit -${Math.abs(val)}%)`;
      else if (rule.metric === 'pnlDay' && rm.pnlDay <= val) breach = `daily PnL ${fmt(rm.pnlDay)} (limit ${fmt(val)})`;
      if (breach) breaches.push(`${scopeLabel(rule.scope)}: ${breach}`);
    }

    const sent = [];
    if (breaches.length && cfg.enabled) {
      const code = Math.random().toString(36).slice(2, 6).toUpperCase();
      await query('INSERT INTO alerts (code,summary) VALUES ($1,$2)', [code, breaches.join(' · ')]);
      const msg = `🚨 LNO ALERT\n${breaches.join('\n')}\nEquity ${fUSD(m.totalEquity)} · PnL day ${fmt(m.pnlDay)}\n\nReply *ACK ${code}* to acknowledge.`;
      sent.push({ type: 'alert', code, ...(await notify(msg, { type: 'breach' })) });
    }
    if ((cfg.dailyReport ?? true) && cfg.enabled) {
      sent.push({ type: 'report', ...(await notify(buildReport('📊 LNO DAILY REPORT', 1, 'day'), { type: 'daily' })) });
    }
    // weekly (Mondays) + monthly (1st) — folded into the daily cron; ?force=weekly|monthly|all to test
    const force = req.query?.force;
    const dt = new Date(p.series[p.series.length - 1].t);
    const eq = p.series.map(x => x.equity);
    const pnlOver = (days) => eq[eq.length - 1] - eq[Math.max(0, eq.length - 1 - days)];
    if (cfg.enabled && (dt.getUTCDay() === 1 || force === 'weekly' || force === 'all')) {
      sent.push({ type: 'weekly', ...(await notify(buildReport('📅 LNO WEEKLY REPORT', 7, '7d'), { type: 'weekly' })) });
    }
    if (cfg.enabled && (dt.getUTCDate() === 1 || force === 'monthly' || force === 'all')) {
      const pnl30 = pnlOver(30);
      sent.push({ type: 'monthly', ...(await notify(buildReport('🗓️ LNO MONTHLY REPORT', 30, '30d') + '\n\nFull PDF: Control Center ▸ Reports', { type: 'monthly' })) });
      try {
        const label = new Date(dt).toISOString().slice(0, 10);
        const b64 = await buildMonthlyPdf({ equity: m.totalEquity, pnl30, maxDrawdownPct: m.maxDrawdownPct, ddDurationDays: m.ddDurationDays, sharpe: m.sharpe, sortino: m.sortino, best: p.best, worst: p.worst, byExchange: p.byExchange, dateLabel: label });
        // archive it so it can be re-downloaded from the Reports page
        try { await query('INSERT INTO reports (kind,period_label,equity,pnl,pdf_base64) VALUES ($1,$2,$3,$4,$5)', ['monthly', label, Math.round(m.totalEquity), Math.round(pnl30), b64]); } catch (e) {}
        // CallMeBot can't attach files — notify opted-in shareholders that a new report is available
        const shr = await notify(REPORT_AVAILABLE, { type: 'new_report' });
        sent.push({ type: 'monthly-pdf', archived: true, bytes: b64.length, shareholdersNotified: shr.sent || 0 });
      } catch (e) { sent.push({ type: 'monthly-pdf', error: String(e.message || e) }); }
    }
    res.status(200).json({ ok: true, metrics: m, breaches, sent });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
