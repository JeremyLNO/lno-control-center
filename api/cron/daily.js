// Daily cron (Vercel Cron, see vercel.json): sync positions from connected exchanges,
// record the equity snapshot, fire threshold alerts, and send the WhatsApp reports
// (global + per-fund, grouped by fund with a colour emoji). Secured by CRON_SECRET or an admin JWT.
import { riskMetrics } from '../_lib/metrics.js';
import { buildPortfolio } from '../_lib/portfolio.js';
import { colorToEmoji } from '../_lib/colors.js';
import { getOpenWAConfig, notify, REPORT_AVAILABLE } from '../_lib/notify.js';
import { syncExchanges } from '../_lib/sync.js';
import { buildMonthlyPdf } from '../_lib/report.js';
import { getAuth } from '../_lib/auth.js';
import { query } from '../_lib/db.js';

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  const h = req.headers.authorization || '';
  if (secret && h === `Bearer ${secret}`) return true;     // Vercel cron
  const a = getAuth(req); if (a && a.role === 'admin') return true; // manual admin trigger
  return false;
}

const grp  = (n) => Math.round(Math.abs(n)).toLocaleString('en-US').replace(/,/g, ' ');
const fmt  = (n) => (n >= 0 ? '+' : '-') + grp(n) + ' USDT';
const fUSD = (n) => grp(n) + ' USDT';
const fPct = (n) => (n >= 0 ? '+' : '-') + Math.abs(n).toFixed(1) + '%';

async function equitySeries() {
  const { rows } = await query('SELECT day, equity FROM equity_snapshots ORDER BY day ASC');
  return rows.map(r => ({ t: (r.day instanceof Date ? r.day.getTime() : new Date(r.day).getTime()), equity: Number(r.equity) }));
}

// WhatsApp report: global header, then open positions grouped under their fund (colour emoji).
function reportText(title, port, period) {
  let out = `*${title}*\n\nEquity ${fUSD(port.equity)}\nPnL ${period.label} ${fmt(period.pnl)} • ${fPct(period.pct)}`;
  if (port.bots.length) out += `\nOpen PnL ${fmt(port.openPnl)} · Exposure ${fUSD(port.exposure)}`;
  const groups = port.funds.filter(f => f.bots.length).concat(port.unassigned.bots.length ? [port.unassigned] : []);
  for (const g of groups) {
    out += `\n\n${g.id ? colorToEmoji(g.color) : '⚪'} *${g.name}*\nPnL ${fmt(g.uPnl)} · Exposure ${fUSD(g.notional)}`;
    for (const b of g.bots) out += `\n  • ${b.symbol}${b.side ? ' ' + b.side : ''} ${fmt(Number(b.unrealized_pnl || 0))}`;
  }
  return out;
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' });
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

    // 3) threshold alerts (global portfolio): drawdown from history, daily PnL from the sync
    const breaches = [];
    const ddLimit = Math.abs(cfg.drawdownPct ?? 10);
    const pnlLimit = cfg.pnlDayThreshold ?? -5000;
    if (m.maxDrawdownPct <= -ddLimit) breaches.push(`Portfolio: drawdown ${m.maxDrawdownPct.toFixed(1)}% (limit -${ddLimit}%)`);
    if (port.pnlDay <= pnlLimit) breaches.push(`Portfolio: daily PnL ${fmt(port.pnlDay)} (limit ${fmt(pnlLimit)})`);

    const sent = [];
    if (breaches.length && cfg.enabled) {
      const code = Math.random().toString(36).slice(2, 6).toUpperCase();
      await query('INSERT INTO alerts (code,summary) VALUES ($1,$2)', [code, breaches.join(' · ')]);
      const msg = `🚨 LNO ALERT\n${breaches.join('\n')}\nEquity ${fUSD(port.equity)} · PnL day ${fmt(port.pnlDay)}\n\nReply *ACK ${code}* to acknowledge.`;
      sent.push({ type: 'alert', code, ...(await notify(msg, { type: 'breach' })) });
    }

    // 4) reports — global + per-fund, grouped by fund
    const eqv = series.map(s => s.equity);
    const pnlOver = (d) => eqv.length ? eqv[eqv.length - 1] - eqv[Math.max(0, eqv.length - 1 - d)] : 0;
    const pctOver = (d) => { const base = eqv[Math.max(0, eqv.length - 1 - d)] || 0; return base ? (pnlOver(d) / base) * 100 : 0; };

    if ((cfg.dailyReport ?? true) && cfg.enabled) {
      const txt = reportText('📊 LNO DAILY REPORT', port, { pnl: port.pnlDay, pct: port.pnlPct, label: 'day' });
      sent.push({ type: 'report', ...(await notify(txt, { type: 'daily' })) });
    }
    const force = req.query?.force;
    const dt = new Date();
    if (cfg.enabled && (dt.getUTCDay() === 1 || force === 'weekly' || force === 'all')) {
      const txt = reportText('📅 LNO WEEKLY REPORT', port, { pnl: pnlOver(7), pct: pctOver(7), label: '7d' });
      sent.push({ type: 'weekly', ...(await notify(txt, { type: 'weekly' })) });
    }
    if (cfg.enabled && (dt.getUTCDate() === 1 || force === 'monthly' || force === 'all')) {
      const pnl30 = pnlOver(30);
      const txt = reportText('🗓️ LNO MONTHLY REPORT', port, { pnl: pnl30, pct: pctOver(30), label: '30d' }) + '\n\nFull PDF: Control Center ▸ Reports';
      sent.push({ type: 'monthly', ...(await notify(txt, { type: 'monthly' })) });
      try {
        const b64 = await buildMonthlyPdf({ equity: port.equity, pnl30, openPnl: port.openPnl, exposure: port.exposure, maxDrawdownPct: m.maxDrawdownPct, ddDurationDays: m.ddDurationDays, sharpe: m.sharpe, sortino: m.sortino, funds: port.funds, dateLabel: today });
        try { await query('INSERT INTO reports (kind,period_label,equity,pnl,pdf_base64) VALUES ($1,$2,$3,$4,$5)', ['monthly', today, Math.round(port.equity), Math.round(pnl30), b64]); } catch (e) {}
        const shr = await notify(REPORT_AVAILABLE, { type: 'new_report' });
        sent.push({ type: 'monthly-pdf', archived: true, bytes: b64.length, shareholdersNotified: shr.sent || 0 });
      } catch (e) { sent.push({ type: 'monthly-pdf', error: String(e.message || e) }); }
    }

    res.status(200).json({ ok: true, synced, equity: port.equity, pnlDay: port.pnlDay, metrics: m, breaches, sent });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
