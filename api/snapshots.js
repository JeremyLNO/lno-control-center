// Recorded daily equity history (written by the daily cron) + report archive.
//   GET                  -> equity snapshots (any auth)
//   GET ?reports=list    -> archived report metadata, filtered to kinds the caller's role
//                           can view (view_reports_daily/weekly/monthly — see rolePerms.js)
//   GET ?report=<id>     -> a single archived report's PDF (base64); 403 if the caller's
//                           role lacks view_reports_<kind> for that report's kind
//   POST {action:'generateReport'} -> build + store a monthly report now (admin), not_verified
//   POST {action:'verifyReport', id} -> mark verified (admin); if the report's kind is
//     shareholder-facing (monthly), THIS is what notifies shareholders — not generation.
//   POST {action:'testEmail'|'testWhatsApp'} -> send the current daily report to the
//     REQUESTING ADMIN ONLY (their own email/phone) — Reports page "send test" buttons.
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';
import { riskMetrics } from './_lib/metrics.js';
import { buildPortfolio, buildDailyReportData } from './_lib/portfolio.js';
import { buildMonthlyPdf } from './_lib/report.js';
import { notify, REPORT_AVAILABLE, getOpenWAConfig, getApiKey, sendTextMeBot } from './_lib/notify.js';
import { dailyDigestText } from './_lib/notifyText.js';
import { sendDailyReportEmail } from './_lib/mailer.js';
import { permsForRole } from './_lib/rolePerms.js';

// Which report kinds are ever shown/sent to shareholders — only these need the shareholder
// "new report available" notice fired on verification. Daily reports are internal-only.
const SHAREHOLDER_KINDS = new Set(['monthly']);

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const isAdmin = a.role === 'admin';
      const canSeeKind = async (kind) => isAdmin || (await permsForRole(a.role)).includes('view_reports_' + kind);

      if (req.query?.reports === 'list') {
        const { rows } = await query('SELECT id,kind,period_label,equity,pnl,status,verified_by,verified_at,created_at FROM reports ORDER BY created_at DESC LIMIT 200');
        const rolePerms = isAdmin ? null : await permsForRole(a.role);
        const allowed = rows.filter(r => isAdmin || rolePerms.includes('view_reports_' + r.kind));
        return res.status(200).json({ reports: allowed.map(r => ({
          id: Number(r.id), kind: r.kind, periodLabel: r.period_label,
          equity: Number(r.equity), pnl: Number(r.pnl), createdAt: r.created_at,
          status: r.status || 'verified', verifiedBy: r.verified_by || null, verifiedAt: r.verified_at || null,
        })) });
      }
      if (req.query?.report) {
        const { rows } = await query('SELECT pdf_base64,period_label,kind FROM reports WHERE id=$1', [req.query.report]);
        if (!rows.length) return res.status(404).json({ error: 'report not found' });
        if (!(await canSeeKind(rows[0].kind))) return res.status(403).json({ error: 'forbidden' });
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
        const port = await buildPortfolio();
        const snaps = (await query('SELECT equity FROM equity_snapshots ORDER BY day ASC')).rows;
        const series = snaps.map(r => ({ equity: Number(r.equity) }));
        const m = riskMetrics(series);
        const eq = series.map(x => x.equity);
        const pnl30 = eq.length ? eq[eq.length - 1] - eq[Math.max(0, eq.length - 1 - 30)] : 0;
        const label = new Date().toISOString().slice(0, 10);
        const b64 = await buildMonthlyPdf({ equity: port.equity, pnl30, openPnl: port.openPnl, exposure: port.exposure, maxDrawdownPct: m.maxDrawdownPct, ddDurationDays: m.ddDurationDays, sharpe: m.sharpe, sortino: m.sortino, funds: port.funds, dateLabel: label });
        // status stays the column default ('not_verified') — an admin must verify a
        // shareholder-facing report (see 'verifyReport' below) before shareholders hear about it.
        const { rows } = await query('INSERT INTO reports (kind,period_label,equity,pnl,pdf_base64) VALUES ($1,$2,$3,$4,$5) RETURNING id,created_at,status',
          ['monthly', label, Math.round(port.equity), Math.round(pnl30), b64]);
        return res.status(200).json({ ok: true, report: { id: Number(rows[0].id), kind: 'monthly', periodLabel: label, equity: Math.round(port.equity), pnl: Math.round(pnl30), createdAt: rows[0].created_at, status: rows[0].status } });
      }
      if (req.body?.action === 'verifyReport') {
        const id = req.body?.id; if (!id) return res.status(400).json({ error: 'id required' });
        const { rows } = await query('SELECT * FROM reports WHERE id=$1', [id]);
        if (!rows.length) return res.status(404).json({ error: 'report not found' });
        const rep = rows[0];
        if (rep.status === 'verified') return res.status(400).json({ error: 'already verified' });
        await query("UPDATE reports SET status='verified', verified_by=$2, verified_at=now() WHERE id=$1", [id, a.username || a.id]);
        // shareholder-facing kinds only find out about a report once it's verified — this
        // used to fire automatically at generation time.
        let shareholdersNotified = 0;
        if (SHAREHOLDER_KINDS.has(rep.kind)) { const r2 = await notify(REPORT_AVAILABLE, { type: 'new_report' }); shareholdersNotified = r2.sent || 0; }
        const { rows: fresh } = await query('SELECT id,kind,period_label,equity,pnl,status,verified_by,verified_at,created_at FROM reports WHERE id=$1', [id]);
        const r = fresh[0];
        return res.status(200).json({ ok: true, shareholdersNotified, report: {
          id: Number(r.id), kind: r.kind, periodLabel: r.period_label, equity: Number(r.equity), pnl: Number(r.pnl),
          createdAt: r.created_at, status: r.status, verifiedBy: r.verified_by, verifiedAt: r.verified_at,
        } });
      }
      if (req.body?.action === 'testEmail') {
        const { rows } = await query('SELECT email FROM users WHERE id=$1', [a.id]);
        const email = rows[0]?.email;
        if (!email) return res.status(400).json({ error: 'no email on file for your account' });
        const data = await buildDailyReportData();
        await sendDailyReportEmail(email, data);
        return res.status(200).json({ ok: true, email });
      }
      if (req.body?.action === 'testWhatsApp') {
        const { rows } = await query('SELECT phone, language FROM users WHERE id=$1', [a.id]);
        const phone = rows[0]?.phone;
        if (!phone) return res.status(400).json({ error: 'no phone number on file — set one in Profile' });
        const cfg = await getOpenWAConfig();
        const apikey = getApiKey(cfg);
        if (!apikey) return res.status(400).json({ error: 'WhatsApp is not configured (no API key set on the WhatsApp page)' });
        const data = await buildDailyReportData();
        const message = dailyDigestText(rows[0].language || 'en', {
          equity: data.equity, pnlDay: data.pnlDay, pctDay: data.pctDay,
          openCount: data.positions.length, incidentCount: data.incidentCount,
        });
        const r = await sendTextMeBot(phone, message, apikey);
        if (!r.ok) return res.status(502).json({ error: 'WhatsApp send failed', detail: r });
        return res.status(200).json({ ok: true, phone });
      }
      return res.status(400).json({ error: 'unknown action' });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
