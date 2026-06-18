// Bots = (exchange, symbol) pairs, auto-created from detected positions. Assign to a fund.
//   GET                      -> bots (+ a "live" equity summary)   (any auth)
//   POST {action:'sync'}     -> run the position sync now           (admin)
//   PATCH {id, fundId}       -> assign/clear a bot's fund           (admin)
//   DELETE {id}              -> remove a bot                        (admin)
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';
import { syncExchanges } from './_lib/sync.js';

const pub = (r) => ({
  id: r.id, exchange: r.exchange, symbol: r.symbol, fundId: r.fund_id || null,
  side: r.side, qty: Number(r.qty), entry: Number(r.entry), mark: Number(r.mark),
  unrealizedPnl: Number(r.unrealized_pnl), notional: Number(r.notional), leverage: Number(r.leverage),
  status: r.status, firstSeen: r.first_seen, lastSeen: r.last_seen,
});

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const { rows } = await query('SELECT * FROM bots ORDER BY exchange ASC, symbol ASC');
      const cfg = await query("SELECT value FROM app_config WHERE key='live'");
      return res.status(200).json({ bots: rows.map(pub), live: cfg.rows[0] ? cfg.rows[0].value : null });
    }

    if (req.method === 'POST') {
      const a = requireAdmin(req, res); if (!a) return;
      if (req.body?.action === 'sync') return res.status(200).json({ ok: true, ...(await syncExchanges()) });
      return res.status(400).json({ error: 'unknown action' });
    }

    if (req.method === 'PATCH') {
      const a = requireAdmin(req, res); if (!a) return;
      const { id, fundId } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      if (fundId) { const f = await query('SELECT 1 FROM funds WHERE id=$1', [fundId]); if (!f.rows[0]) return res.status(400).json({ error: 'fund not found' }); }
      await query('UPDATE bots SET fund_id=$2 WHERE id=$1', [id, fundId || null]);
      const { rows } = await query('SELECT * FROM bots WHERE id=$1', [id]);
      if (!rows[0]) return res.status(404).json({ error: 'bot not found' });
      return res.status(200).json({ bot: pub(rows[0]) });
    }

    if (req.method === 'DELETE') {
      const a = requireAdmin(req, res); if (!a) return;
      const id = req.body?.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      await query('DELETE FROM bots WHERE id=$1', [id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
