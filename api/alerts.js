// Recent critical alerts + ack status. GET (any auth) lists; POST (admin) acks one.
//   ?type=<breach|api_error> -> filter to one alert type. 'breach' = a portfolio performance
//   threshold crossed (drawdown/daily PnL) — not a service problem. 'api_error' = an exchange
//   API/data-feed failure — a real service-health incident. System Status' full history table
//   asks for everything; the Live page's "incident" status/list asks for api_error only, since
//   an incident there means "is the service healthy", not "is the portfolio down".
//   ?offset=<n> -> page through history 50-at-a-time (System Status' table); ?date=YYYY-MM-DD
//   -> restrict to that calendar day (server-side, so paging stays correct with the filter on).
//   `total` in the response is the full matching count (ignoring limit/offset), for "N of M".
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';
import { permsForRole } from './_lib/rolePerms.js';
import { listAnomalies, ackAnomaly, runDetection } from './_lib/anomalies.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;

      // Detected behavioural anomalies (see api/_lib/anomalies.js). Folded into this endpoint
      // rather than a new api/*.js file — Vercel Hobby's 12-function cap is already reached,
      // and an anomaly is the pattern-level sibling of the alerts served here.
      //   GET ?anomalies=1[&status=open|resolved|all][&severity=][&code=][&limit&offset]
      if (req.query?.anomalies) {
        if (a.role !== 'admin' && !(await permsForRole(a.role)).includes('view_trades')) {
          return res.status(403).json({ error: 'forbidden' });
        }
        return res.status(200).json(await listAnomalies({
          status: ['open', 'resolved', 'all'].includes(req.query.status) ? req.query.status : 'open',
          severity: ['critical', 'warning', 'info'].includes(req.query.severity) ? req.query.severity : null,
          code: req.query.code || null,
          limit: Math.min(Math.max(Number(req.query.limit) || 50, 1), 200),
          offset: Math.max(Number(req.query.offset) || 0, 0),
        }));
      }
      // limit=30 (default) for the Live/Activity "recent incidents" widgets; the System
      // Status page's full history table pages through 50 at a time via ?limit=50&offset=N.
      const limit = Math.min(Math.max(Number(req.query?.limit) || 30, 1), 500);
      const offset = Math.max(Number(req.query?.offset) || 0, 0);
      const type = ['breach', 'api_error'].includes(req.query?.type) ? req.query.type : null;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query?.date || '') ? req.query.date : null;
      const where = []; const params = [];
      if (type) { params.push(type); where.push(`type=$${params.length}`); }
      if (date) { params.push(date); where.push(`created_at::date=$${params.length}::date`); }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: cnt } = await query(`SELECT count(*)::int AS n FROM alerts ${whereSql}`, params);
      params.push(limit); const limitIdx = params.length;
      params.push(offset); const offsetIdx = params.length;
      const { rows } = await query(
        `SELECT id,type,code,summary,created_at,acked_at,acked_by FROM alerts ${whereSql} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params
      );
      return res.status(200).json({ total: cnt[0]?.n || 0, alerts: rows.map(r => ({
        id: Number(r.id), type: r.type || 'breach', code: r.code, summary: r.summary,
        createdAt: r.created_at, ackedAt: r.acked_at, ackedBy: r.acked_by || null,
        durationSec: r.acked_at ? Math.round((new Date(r.acked_at).getTime() - new Date(r.created_at).getTime()) / 1000) : null,
      })) });
    }
    if (req.method === 'POST') {
      const a = requireAdmin(req, res); if (!a) return;
      // Run the detectors on demand. They also run from the daily cron; this is the 'check
      // now' button, and the path the tests exercise.
      if (req.body?.action === 'detectAnomalies') return res.status(200).json(await runDetection());
      if (req.body?.action === 'ackAnomaly') {
        if (!req.body.id) return res.status(400).json({ error: 'id required' });
        const an = await ackAnomaly(req.body.id, a.username || 'admin');
        if (!an) return res.status(404).json({ error: 'anomaly not found' });
        return res.status(200).json({ anomaly: an });
      }
      const id = req.body?.id; if (!id) return res.status(400).json({ error: 'id required' });
      await query('UPDATE alerts SET acked_at=now(), acked_by=$1 WHERE id=$2 AND acked_at IS NULL', [a.username || 'admin', id]);
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
