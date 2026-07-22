// Recent critical alerts + ack status. GET (any auth) lists; POST (admin) acks one.
//   ?type=<breach|api_error> -> filter to one alert type. 'breach' = a portfolio performance
//   threshold crossed (drawdown/daily PnL) — not a service problem. 'api_error' = an exchange
//   API/data-feed failure — a real service-health incident. System Status' full history table
//   asks for everything; the Live page's "incident" status/list asks for api_error only, since
//   an incident there means "is the service healthy", not "is the portfolio down".
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      // limit=30 (default) for the Live/Activity "recent incidents" widgets; the System
      // Status page's full history table asks for more via ?limit=300.
      const limit = Math.min(Math.max(Number(req.query?.limit) || 30, 1), 500);
      const type = ['breach', 'api_error'].includes(req.query?.type) ? req.query.type : null;
      const { rows } = type
        ? (await query('SELECT id,type,code,summary,created_at,acked_at,acked_by FROM alerts WHERE type=$1 ORDER BY created_at DESC LIMIT $2', [type, limit]))
        : (await query('SELECT id,type,code,summary,created_at,acked_at,acked_by FROM alerts ORDER BY created_at DESC LIMIT $1', [limit]));
      return res.status(200).json({ alerts: rows.map(r => ({
        id: Number(r.id), type: r.type || 'breach', code: r.code, summary: r.summary,
        createdAt: r.created_at, ackedAt: r.acked_at, ackedBy: r.acked_by || null,
        durationSec: r.acked_at ? Math.round((new Date(r.acked_at).getTime() - new Date(r.created_at).getTime()) / 1000) : null,
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
