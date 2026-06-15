// Recent critical alerts + ack status. GET (any auth) lists; POST (admin) acks one.
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const { rows } = await query('SELECT id,code,summary,created_at,acked_at,acked_by FROM alerts ORDER BY created_at DESC LIMIT 30');
      return res.status(200).json({ alerts: rows.map(r => ({
        id: Number(r.id), code: r.code, summary: r.summary,
        createdAt: r.created_at, ackedAt: r.acked_at, ackedBy: r.acked_by || null,
      })) });
    }
    if (req.method === 'POST') {
      const a = requireAdmin(req, res); if (!a) return;
      const id = req.body?.id; if (!id) return res.status(400).json({ error: 'id required' });
      await query('UPDATE alerts SET acked_at=now(), acked_by=$1 WHERE id=$2 AND acked_at IS NULL', [a.username || 'admin', id]);
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
