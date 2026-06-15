// Recorded daily equity history (written by the daily cron) + report archive.
//   GET                  -> equity snapshots (any auth)
//   GET ?reports=list    -> archived report metadata (any auth)
//   GET ?report=<id>     -> a single archived report's PDF (base64) (any auth)
//   POST {action:'generateReport'} -> build + store a report now (admin) — no WhatsApp send
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';
import { computePortfolio, riskMetrics } from './_lib/metrics.js';
import { buildMonthlyPdf } from './_lib/report.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;

      if (req.query?.reports === 'list') {
        const { rows } = await query('SELECT id,kind,period_label,equity,pnl,created_at FROM reports ORDER BY created_at DESC LIMIT 100');
        return res.status(200).json({ reports: rows.map(r => ({
          id: Number(r.id), kind: r.kind, periodLabel: r.period_label,
          equity: Number(r.equity), pnl: Number(r.pnl), createdAt: r.created_at,
        })) });
      }
      if (req.query?.report) {
        const { rows } = await query('SELECT pdf_base64,period_label,kind FROM reports WHERE id=$1', [req.query.report]);
        if (!rows.length) return res.status(404).json({ error: 'report not found' });
        return res.status(200).json({ pdfBase64: rows[0].pdf_base64, filename: `lno-${rows[0].kind}-report-${rows[0].period_label}.pdf` });
      }

      const limit = Math.min(parseInt(req.query?.limit || '365', 10) || 365, 1000);
      const { rows } = await query('SELECT day,equity,pnl_day,metrics FROM equity_snapshots ORDER BY day ASC LIMIT $1', [limit]);
      return res.status(200).json({ snapshots: rows.map(r => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
        equity: Number(r.equity), pnlDay: Number(r.pnl_day), metrics: r.metrics || {},
      })) });
    }

    if (req.method === 'POST') {
      const a = requireAdmin(req, res); if (!a) return;
      if (req.body?.action === 'generateReport') {
        const p = await computePortfolio(); const m = riskMetrics(p.series);
        const dt = new Date(p.series[p.series.length - 1].t);
        const eq = p.series.map(x => x.equity);
        const pnl30 = eq[eq.length - 1] - eq[Math.max(0, eq.length - 1 - 30)];
        const label = dt.toISOString().slice(0, 10);
        const b64 = await buildMonthlyPdf({ equity: m.totalEquity, pnl30, maxDrawdownPct: m.maxDrawdownPct, ddDurationDays: m.ddDurationDays, sharpe: m.sharpe, sortino: m.sortino, best: p.best, worst: p.worst, byExchange: p.byExchange, dateLabel: label });
        const { rows } = await query('INSERT INTO reports (kind,period_label,equity,pnl,pdf_base64) VALUES ($1,$2,$3,$4,$5) RETURNING id,created_at',
          ['monthly', label, Math.round(m.totalEquity), Math.round(pnl30), b64]);
        return res.status(200).json({ ok: true, report: { id: Number(rows[0].id), kind: 'monthly', periodLabel: label, equity: Math.round(m.totalEquity), pnl: Math.round(pnl30), createdAt: rows[0].created_at } });
      }
      return res.status(400).json({ error: 'unknown action' });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
