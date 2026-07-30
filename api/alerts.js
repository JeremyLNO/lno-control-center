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
import { listComments, createComment, updateComment, deleteComment, listMentions, markMentionsRead,
         listReviews, upsertReview, entityLink, ENTITY_TYPES } from './_lib/comments.js';
import { sendMentionEmail } from './_lib/mailer.js';

// Writing anywhere in the discussion layer needs 'manage_comments'; reading follows the same
// gate as the trade data it hangs off. Kept as one helper so the two can never drift.
const canRead = async (a) => a.role === 'admin' || (await permsForRole(a.role)).includes('view_trades');
const canWrite = async (a) => a.role === 'admin' || (await permsForRole(a.role)).includes('manage_comments');

// Fire-and-forget mention notifications. A failing mailer must never cost the comment that
// was just written, so this is awaited only far enough to swallow its own errors.
async function notifyMentions(mentioned, { author, body, entityType, entityId }) {
  for (const u of mentioned || []) {
    try {
      await sendMentionEmail(u.email, {
        authorName: author,
        excerpt: String(body).slice(0, 300),
        link: entityLink(entityType, entityId),
        entityLabel: `${entityType} · ${entityId}`,
      });
    } catch (e) { /* the mention row is recorded either way — the bell still shows it */ }
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;

      // Detected behavioural anomalies (see api/_lib/anomalies.js). Folded into this endpoint
      // rather than a new api/*.js file — Vercel Hobby's 12-function cap is already reached,
      // and an anomaly is the pattern-level sibling of the alerts served here.
      //   GET ?anomalies=1[&status=open|resolved|all][&severity=][&code=][&limit&offset]
      // Discussion layer: comments, incident reviews and the current user's mentions.
      //   GET ?comments=1&entityType=&entityId=   -> thread for one entity
      //   GET ?reviews=1[&entityType&entityId]    -> incident reviews
      //   GET ?mentions=1[&all=1]                 -> the CALLER's mentions (never anyone else's)
      if (req.query?.comments) {
        if (!(await canRead(a))) return res.status(403).json({ error: 'forbidden' });
        return res.status(200).json({
          comments: await listComments({
            entityType: req.query.entityType || null, entityId: req.query.entityId || null,
            assigneeId: req.query.assignee || null, status: req.query.status || null,
          }),
          canWrite: await canWrite(a),
        });
      }
      if (req.query?.reviews) {
        if (!(await canRead(a))) return res.status(403).json({ error: 'forbidden' });
        return res.status(200).json({
          reviews: await listReviews({ entityType: req.query.entityType || null, entityId: req.query.entityId || null, status: req.query.status || null }),
          canWrite: await canWrite(a),
        });
      }
      if (req.query?.mentions) {
        // Scoped to the authenticated user by construction — there is no parameter that could
        // ask for someone else's notifications.
        return res.status(200).json({ mentions: await listMentions(a.id, { unreadOnly: req.query.all !== '1' }) });
      }

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
      const COMMENT_ACTIONS = new Set(['addComment', 'updateComment', 'deleteComment', 'saveReview', 'readMentions']);
      if (COMMENT_ACTIONS.has(req.body?.action)) {
        const auth = requireAuth(req, res); if (!auth) return;
        // Marking your OWN mentions read is not a write on shared state, so it needs no
        // permission beyond being signed in.
        if (req.body.action === 'readMentions') {
          return res.status(200).json(await markMentionsRead(auth.id, req.body.ids || null));
        }
        if (!(await canWrite(auth))) return res.status(403).json({ error: 'forbidden' });
        try {
          const author = auth.username || auth.id;
          if (req.body.action === 'addComment') {
            const { id, mentioned } = await createComment({ ...req.body, author: { id: auth.id, name: author } });
            await notifyMentions(mentioned, { author, body: req.body.body, entityType: req.body.entityType, entityId: req.body.entityId });
            return res.status(200).json({ id, mentioned: mentioned.map(u => u.username) });
          }
          if (req.body.action === 'updateComment') {
            if (!req.body.id) return res.status(400).json({ error: 'id required' });
            const out = await updateComment(req.body.id, req.body, auth);
            if (!out) return res.status(400).json({ error: 'nothing to update' });
            await notifyMentions(out.mentioned, { author, body: req.body.body, entityType: req.body.entityType, entityId: req.body.entityId });
            return res.status(200).json({ ok: true, mentioned: out.mentioned.map(u => u.username) });
          }
          if (req.body.action === 'deleteComment') {
            if (!req.body.id) return res.status(400).json({ error: 'id required' });
            return res.status(200).json(await deleteComment(req.body.id));
          }
          const review = await upsertReview(req.body, auth);
          if (!review) return res.status(400).json({ error: 'nothing to update' });
          return res.status(200).json({ review });
        } catch (e) {
          return res.status(400).json({ error: String(e.message || e) });
        }
      }
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
