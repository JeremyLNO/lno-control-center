// Daily alert cron (Vercel Cron, see vercel.json). Recomputes portfolio metrics
// server-side from real klines, fires threshold alerts, and sends the daily report
// via OpenWA. Secured by CRON_SECRET (Vercel sets the Bearer header) or an admin JWT.
import { computePortfolio, riskMetrics } from '../_lib/metrics.js';
import { getOpenWAConfig, notify } from '../_lib/notify.js';
import { getAuth } from '../_lib/auth.js';
import { query } from '../_lib/db.js';

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

    const ddLimit = Math.abs(cfg.drawdownPct ?? 10);
    const pnlLimit = cfg.pnlDayThreshold ?? -5000;
    const breaches = [];
    if (m.maxDrawdownPct <= -ddLimit) breaches.push(`Max drawdown ${m.maxDrawdownPct.toFixed(1)}% (limit -${ddLimit}%)`);
    if (m.pnlDay <= pnlLimit) breaches.push(`Daily PnL ${fmt(m.pnlDay)} (limit ${fmt(pnlLimit)})`);

    const sent = [];
    if (breaches.length && cfg.enabled) {
      const msg = `🚨 LNO ALERT\n${breaches.join('\n')}\nEquity ${fUSD(m.totalEquity)} · PnL day ${fmt(m.pnlDay)}`;
      sent.push({ type: 'alert', ...(await notify(msg)) });
    }
    if ((cfg.dailyReport ?? true) && cfg.enabled) {
      const exp = Object.entries(p.byExchange).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fUSD(v)}`).join(' · ');
      const msg = `📊 LNO daily report\nEquity ${fUSD(m.totalEquity)}\nPnL day ${fmt(m.pnlDay)} · week ${fmt(m.pnlWeek)}\nMax DD ${m.maxDrawdownPct.toFixed(1)}% (${m.ddDurationDays}d)\nSharpe ${m.sharpe.toFixed(2)} · Sortino ${m.sortino.toFixed(2)}\nBest ${p.best.name} ${fmt(p.best.pnl)} · Worst ${p.worst.name} ${fmt(p.worst.pnl)}\nExposure: ${exp}`;
      sent.push({ type: 'report', ...(await notify(msg)) });
    }
    res.status(200).json({ ok: true, metrics: m, breaches, sent });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
