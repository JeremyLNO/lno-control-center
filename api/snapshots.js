// Recorded daily equity history (written by the daily cron) + report archive.
//   GET                  -> equity snapshots (any auth)
//   GET ?reports=list    -> archived report metadata, filtered to kinds the caller's role
//                           can view (view_reports_daily/weekly/monthly — see rolePerms.js)
//   GET ?report=<id>     -> a single archived report's PDF (base64); 403 if the caller's
//                           role lacks view_reports_<kind> for that report's kind
//   POST {action:'generateReport', kind:'daily'|'weekly'|'monthly'} -> build + store a report
//     now (admin). daily/weekly auto-verify (internal-only); monthly stays not_verified.
//   POST {action:'verifyReport', id} -> mark verified (admin); if the report's kind is
//     shareholder-facing (monthly), THIS is what notifies shareholders — not generation.
//   POST {action:'unverifyReport', id} -> revert a verified report back to not_verified
//     (admin) — does not un-send any WhatsApp/email already sent, just resets the flag.
//   POST {action:'deleteReport', id} -> permanently remove an archived report (admin).
//   POST {action:'testEmail'|'testWhatsApp'} -> send the current daily report to the
//     REQUESTING ADMIN ONLY (their own email/phone) — Reports page "send test" buttons.
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';
import { riskMetrics } from './_lib/metrics.js';
import { buildReportData, buildDailyReportData } from './_lib/portfolio.js';
import { buildMonthlyPdf, buildWeeklyPdf, buildDailyPdf } from './_lib/report.js';
import { notify, REPORT_AVAILABLE, getOpenWAConfig, getApiKey, sendTextMeBot } from './_lib/notify.js';
import { dailyDigestText } from './_lib/notifyText.js';
import { sendDailyReportEmail, dailyReportHtml, weeklyReportHtml, monthlyReportHtml } from './_lib/mailer.js';
import { buildWeeklyReview, buildMonthlyReview } from './_lib/weeklyReport.js';
import { permsForRole } from './_lib/rolePerms.js';
import { DIMENSIONS, UNAVAILABLE, GRANULARITIES, fetchTrades, groupBy, bucketByPeriod } from './_lib/analytics.js';
import { getTradeDetail } from './_lib/tradeDetail.js';

// Query-string -> filter object for the analysis engine. List filters arrive comma-separated
// (?symbol=BTCUSDT,ETHUSDT); an absent or empty parameter means "no constraint", never "match
// nothing" — so a half-filled filter bar widens results instead of blanking the page.
function parseFilters(q = {}) {
  const list = (k) => (q[k] ? String(q[k]).split(',').filter(Boolean) : undefined);
  const num = (k) => (q[k] != null && q[k] !== '' ? Number(q[k]) : undefined);
  return {
    from: q.from || undefined, to: q.to || undefined,
    symbol: list('symbol'), direction: list('direction'), exchange: list('exchange'), fund: list('fund'),
    hour: list('hour'), dow: list('dow'),
    minDuration: num('minDuration'), maxDuration: num('maxDuration'),
    minLeverage: num('minLeverage'), maxLeverage: num('maxLeverage'),
    includeOpen: q.includeOpen === '1',
  };
}

// Which report kinds are ever shown/sent to shareholders — only these need the shareholder
// "new report available" notice fired on verification. Daily/weekly are internal-only.
const SHAREHOLDER_KINDS = new Set(['monthly']);
const DAYS_FOR_KIND = { daily: 1, weekly: 7, monthly: 30 };

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const isAdmin = a.role === 'admin';
      const canSeeKind = async (kind) => isAdmin || (await permsForRole(a.role)).includes('view_reports_' + kind);

      // Cross-dimension analysis engine (Analysis page). Lives here rather than in a new
      // api/*.js file because Vercel Hobby caps the project at 12 serverless functions and
      // it is already exactly at that limit — snapshots.js is the analytics/reporting home.
      //   GET ?analysis=1&group=<dim>[&compare=<dim>][&filters...] -> KPI block per bucket
      //   GET ?analysis=1&calendar=day|week|month|year -> KPI block per calendar period
      //   GET ?analysis=1&list=1[&limit&offset] -> paginated closed round trips
      //   GET ?analysis=1&trade=<exchange:symbol:openTradeId> -> one position, in full
      //   GET ?analysis=meta -> available dimensions, filter option values, unavailable KPIs
      if (req.query?.analysis) {
        if (!isAdmin && !(await permsForRole(a.role)).includes('view_trades')) {
          return res.status(403).json({ error: 'forbidden' });
        }
        if (req.query.analysis === 'meta') {
          const { rows: opts } = await query(
            `SELECT DISTINCT symbol, exchange, direction, fund_id FROM trades`
          );
          const uniq = (k) => [...new Set(opts.map(r => r[k]).filter(Boolean))].sort();
          const { rows: span } = await query('SELECT MIN(closed_at) AS a, MAX(closed_at) AS b, COUNT(*)::int AS n FROM trades WHERE closed_at IS NOT NULL');
          return res.status(200).json({
            dimensions: Object.entries(DIMENSIONS).map(([key, d]) => ({ key, label: d.label, order: d.order || null })),
            unavailable: UNAVAILABLE,
            options: { symbol: uniq('symbol'), exchange: uniq('exchange'), direction: uniq('direction'), fund: uniq('fund_id') },
            span: { from: span[0]?.a || null, to: span[0]?.b || null, trades: span[0]?.n || 0 },
          });
        }
        // One position, in full: fills, funding, declared intent, MAE/MFE, linked alerts.
        // The single place to audit a trade's whole life cycle.
        if (req.query.trade) {
          const detail = await getTradeDetail(String(req.query.trade));
          if (!detail) return res.status(404).json({ error: 'trade not found' });
          return res.status(200).json(detail);
        }
        const f = parseFilters(req.query);
        const trades = await fetchTrades(f);
        // Paginated list of round trips, newest first — the index that leads into the detail
        // page. Paged server-side at 50 like every other table in the app.
        if (req.query.list) {
          const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
          const offset = Math.max(Number(req.query.offset) || 0, 0);
          const page = [...trades].reverse().slice(offset, offset + limit);
          return res.status(200).json({
            total: trades.length,
            trades: page.map(t => ({
              id: `${t.exchange}:${t.symbol}:${t.open_trade_id}`,
              symbol: t.symbol, direction: t.direction, qty: t.qty,
              entryPrice: t.entry_price == null ? null : Number(t.entry_price),
              exitPrice: t.exit_price == null ? null : Number(t.exit_price),
              netPnl: t.net_pnl, grossPnl: t.gross_pnl, commission: t.commission, funding: t.funding,
              openedAt: t.opened_at, closedAt: t.closed_at, durationS: t.duration_s,
              leverage: t.leverage, version: t.version_label || null, fillCount: t.fill_count,
            })),
          });
        }
        // Calendar view: same KPI block, keyed by calendar period instead of by dimension.
        //   GET ?analysis=1&calendar=day|week|month|year[&filters...]
        if (req.query.calendar) {
          const g = String(req.query.calendar);
          if (!GRANULARITIES.includes(g)) return res.status(400).json({ error: 'unknown granularity' });
          return res.status(200).json(bucketByPeriod(trades, g));
        }
        const group = String(req.query.group || 'symbol');
        if (!DIMENSIONS[group]) return res.status(400).json({ error: 'unknown dimension' });
        const out = groupBy(trades, group);
        // An optional second axis turns the flat breakdown into a matrix — "which weekday is
        // this bot bad on" is a question neither axis answers alone.
        if (req.query.compare && DIMENSIONS[req.query.compare]) {
          const c = String(req.query.compare);
          out.compare = c;
          out.matrix = out.rows.map(r => ({
            key: r.key,
            cells: groupBy(trades.filter(t => String(DIMENSIONS[group].of(t) ?? 'unknown') === r.key), c).rows,
          }));
        }
        return res.status(200).json(out);
      }

      if (req.query?.reports === 'list') {
        const { rows } = await query('SELECT id,kind,period_label,equity,pnl,status,verified_by,verified_at,created_at,(html_body IS NOT NULL) AS has_html FROM reports ORDER BY created_at DESC LIMIT 200');
        const rolePerms = isAdmin ? null : await permsForRole(a.role);
        const allowed = rows.filter(r => isAdmin || rolePerms.includes('view_reports_' + r.kind));
        return res.status(200).json({ reports: allowed.map(r => ({
          id: Number(r.id), kind: r.kind, periodLabel: r.period_label,
          equity: Number(r.equity), pnl: Number(r.pnl), createdAt: r.created_at,
          status: r.status || 'verified', verifiedBy: r.verified_by || null, verifiedAt: r.verified_at || null,
          hasHtml: !!r.has_html,
        })) });
      }
      if (req.query?.report) {
        const { rows } = await query('SELECT pdf_base64,html_body,period_label,kind FROM reports WHERE id=$1', [req.query.report]);
        if (!rows.length) return res.status(404).json({ error: 'report not found' });
        if (!(await canSeeKind(rows[0].kind))) return res.status(403).json({ error: 'forbidden' });
        // ?format=html previews the EXACT body that was emailed, rather than a second
        // rendering of the same numbers that could drift from what recipients received.
        // Reports archived before this was stored have no body — say so instead of
        // fabricating one.
        if (req.query.format === 'html') {
          if (!rows[0].html_body) return res.status(404).json({ error: 'no html preview stored for this report' });
          return res.status(200).json({ html: rows[0].html_body, kind: rows[0].kind, periodLabel: rows[0].period_label });
        }
        return res.status(200).json({ pdfBase64: rows[0].pdf_base64, filename: `lno-${rows[0].kind}-report-${rows[0].period_label}.pdf` });
      }

      const limit = Math.min(parseInt(req.query?.limit || '365', 10) || 365, 1000);
      // Take the most RECENT `limit` days, then flip back to chronological order for the
      // clients (every consumer — equity curve, PnL calendar, drawdown, risk metrics —
      // assumes oldest-first). `ORDER BY day ASC LIMIT n` would have returned the OLDEST n
      // days instead, silently freezing every chart once history passed `limit` rows.
      const { rows } = await query('SELECT day,equity,pnl_day,metrics FROM equity_snapshots ORDER BY day DESC LIMIT $1', [limit]);
      rows.reverse();
      return res.status(200).json({ snapshots: rows.map(r => ({
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
        equity: Number(r.equity), pnlDay: Number(r.pnl_day), metrics: r.metrics || {},
      })) });
    }

    if (req.method === 'POST') {
      const a = requireAdmin(req, res); if (!a) return;
      if (req.body?.action === 'generateReport') {
        const kind = Object.keys(DAYS_FOR_KIND).includes(req.body?.kind) ? req.body.kind : 'monthly';
        const data = await buildReportData(DAYS_FOR_KIND[kind]);
        const label = data.dateLabel;
        // A report generated by hand must be the SAME artefact the cron produces — same
        // review attached to the PDF, same stored HTML body. Otherwise "Generate now" would
        // quietly produce a thinner report with no preview, which is exactly what it used to
        // do: every manually generated row showed a disabled HTML button.
        let b64, html = null;
        if (kind === 'daily') {
          const d = { equity: data.equity, pnlDay: data.pnl, pctDay: data.pct, openPnl: data.openPnl, exposure: data.exposure, funds: data.funds, positions: data.positions, incidentCount: data.incidentCount, dateLabel: label, series: data.series };
          b64 = await buildDailyPdf(d);
          html = dailyReportHtml(d);
        } else if (kind === 'weekly') {
          // The review is the substance of the weekly; if it cannot be built the PDF is still
          // worth archiving, so the failure degrades the report rather than losing it.
          let review = null;
          try { review = await buildWeeklyReview(); } catch (e) {}
          b64 = await buildWeeklyPdf({ equity: data.equity, pnl7: data.pnl, openPnl: data.openPnl, exposure: data.exposure, funds: data.funds, positions: data.positions, dateLabel: label, series: data.series, review });
          if (review) html = weeklyReportHtml(review);
        } else {
          const snaps = (await query('SELECT equity FROM equity_snapshots ORDER BY day ASC')).rows;
          const m = riskMetrics(snaps.map(r => ({ equity: Number(r.equity) })));
          let review = null;
          try { review = await buildMonthlyReview(); } catch (e) {}
          const d = { review, equity: data.equity, pnl30: data.pnl, openPnl: data.openPnl, exposure: data.exposure, maxDrawdownPct: m.maxDrawdownPct, ddDurationDays: m.ddDurationDays, sharpe: m.sharpe, sortino: m.sortino, funds: data.funds, positions: data.positions, dateLabel: label, series: data.series };
          b64 = await buildMonthlyPdf(d);
          html = monthlyReportHtml(d);
        }
        let rows;
        if (kind === 'monthly') {
          // status stays the column default ('not_verified') — an admin must verify the
          // shareholder-facing kind (see 'verifyReport' below) before shareholders hear about it.
          ({ rows } = await query('INSERT INTO reports (kind,period_label,equity,pnl,pdf_base64,html_body) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,created_at,status',
            [kind, label, Math.round(data.equity), Math.round(data.pnl), b64, html]));
        } else {
          // daily/weekly are internal-only — no shareholder is ever waiting on them.
          ({ rows } = await query(`INSERT INTO reports (kind,period_label,equity,pnl,pdf_base64,html_body,status,verified_by,verified_at)
             VALUES ($1,$2,$3,$4,$5,$6,'verified',$7,now()) RETURNING id,created_at,status`,
            [kind, label, Math.round(data.equity), Math.round(data.pnl), b64, html, a.username || a.id]));
        }
        return res.status(200).json({ ok: true, report: { id: Number(rows[0].id), kind, periodLabel: label, equity: Math.round(data.equity), pnl: Math.round(data.pnl), createdAt: rows[0].created_at, status: rows[0].status } });
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
      if (req.body?.action === 'unverifyReport') {
        const id = req.body?.id; if (!id) return res.status(400).json({ error: 'id required' });
        const { rows } = await query('SELECT status FROM reports WHERE id=$1', [id]);
        if (!rows.length) return res.status(404).json({ error: 'report not found' });
        if (rows[0].status !== 'verified') return res.status(400).json({ error: 'not verified' });
        // resets the flag only — a WhatsApp/email already sent on verification can't be
        // un-sent; this is for "I verified the wrong report" / re-review, not damage control.
        await query("UPDATE reports SET status='not_verified', verified_by=NULL, verified_at=NULL WHERE id=$1", [id]);
        const { rows: fresh } = await query('SELECT id,kind,period_label,equity,pnl,status,verified_by,verified_at,created_at FROM reports WHERE id=$1', [id]);
        const r = fresh[0];
        return res.status(200).json({ ok: true, report: {
          id: Number(r.id), kind: r.kind, periodLabel: r.period_label, equity: Number(r.equity), pnl: Number(r.pnl),
          createdAt: r.created_at, status: r.status, verifiedBy: r.verified_by, verifiedAt: r.verified_at,
        } });
      }
      if (req.body?.action === 'deleteReport') {
        const id = req.body?.id; if (!id) return res.status(400).json({ error: 'id required' });
        // check-then-delete rather than trusting DELETE's own row count — that's reported
        // under different keys (rowCount vs affectedRows) across drivers/environments.
        const { rows } = await query('SELECT id FROM reports WHERE id=$1', [id]);
        if (!rows.length) return res.status(404).json({ error: 'report not found' });
        await query('DELETE FROM reports WHERE id=$1', [id]);
        return res.status(200).json({ ok: true, id: Number(id) });
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
