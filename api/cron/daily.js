// Daily alert cron (Vercel Cron, see vercel.json). Recomputes portfolio metrics
// server-side from real klines, fires threshold alerts, and sends the daily report
// via OpenWA. Secured by CRON_SECRET (Vercel sets the Bearer header) or an admin JWT.
import { computePortfolio, riskMetrics, sumSeries } from '../_lib/metrics.js';
import { getOpenWAConfig, notify, sendFile, getRecipients } from '../_lib/notify.js';
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

const fmt  = (n) => (n >= 0 ? '+' : '-') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const fUSD = (n) => '$' + Math.round(n).toLocaleString('en-US');

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
      sent.push({ type: 'alert', code, ...(await notify(msg)) });
    }
    if ((cfg.dailyReport ?? true) && cfg.enabled) {
      const exp = Object.entries(p.byExchange).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fUSD(v)}`).join(' · ');
      const msg = `📊 LNO daily report\nEquity ${fUSD(m.totalEquity)}\nPnL day ${fmt(m.pnlDay)} · week ${fmt(m.pnlWeek)}\nMax DD ${m.maxDrawdownPct.toFixed(1)}% (${m.ddDurationDays}d)\nSharpe ${m.sharpe.toFixed(2)} · Sortino ${m.sortino.toFixed(2)}\nBest ${p.best.name} ${fmt(p.best.pnl)} · Worst ${p.worst.name} ${fmt(p.worst.pnl)}\nExposure: ${exp}`;
      sent.push({ type: 'report', ...(await notify(msg)) });
    }
    // weekly (Mondays) + monthly (1st) — folded into the daily cron; ?force=weekly|monthly|all to test
    const force = req.query?.force;
    const dt = new Date(p.series[p.series.length - 1].t);
    const eq = p.series.map(x => x.equity);
    const pnlOver = (days) => eq[eq.length - 1] - eq[Math.max(0, eq.length - 1 - days)];
    if (cfg.enabled && (dt.getUTCDay() === 1 || force === 'weekly' || force === 'all')) {
      sent.push({ type: 'weekly', ...(await notify(`📅 LNO weekly report\nEquity ${fUSD(m.totalEquity)}\nPnL 7d ${fmt(pnlOver(7))}\nMax DD ${m.maxDrawdownPct.toFixed(1)}% · Sharpe ${m.sharpe.toFixed(2)}`)) });
    }
    if (cfg.enabled && (dt.getUTCDate() === 1 || force === 'monthly' || force === 'all')) {
      const pnl30 = pnlOver(30);
      sent.push({ type: 'monthly', ...(await notify(`🗓️ LNO monthly report\nEquity ${fUSD(m.totalEquity)}\nPnL 30d ${fmt(pnl30)}\nMax DD ${m.maxDrawdownPct.toFixed(1)}% (${m.ddDurationDays}d) · Sharpe ${m.sharpe.toFixed(2)} · Sortino ${m.sortino.toFixed(2)}\nFull PDF: Control Center ▸ Reports`)) });
      try {
        const label = new Date(dt).toISOString().slice(0, 10);
        const b64 = await buildMonthlyPdf({ equity: m.totalEquity, pnl30, maxDrawdownPct: m.maxDrawdownPct, ddDurationDays: m.ddDurationDays, sharpe: m.sharpe, sortino: m.sortino, best: p.best, worst: p.worst, byExchange: p.byExchange, dateLabel: label });
        // archive it so it can be re-downloaded from the Reports page
        try { await query('INSERT INTO reports (kind,period_label,equity,pnl,pdf_base64) VALUES ($1,$2,$3,$4,$5)', ['monthly', label, Math.round(m.totalEquity), Math.round(pnl30), b64]); } catch (e) {}
        const tos = await getRecipients(); let fsent = 0;
        for (const to of tos) { const r = await sendFile(cfg, to, b64, 'lno-monthly-report.pdf', 'LNO monthly report'); if (r.ok) fsent++; }
        sent.push({ type: 'monthly-pdf', sent: fsent, total: tos.length, bytes: b64.length });
      } catch (e) { sent.push({ type: 'monthly-pdf', error: String(e.message || e) }); }
    }
    res.status(200).json({ ok: true, metrics: m, breaches, sent });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
