// Recorded daily equity history (written by the daily cron). Any authenticated user.
import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';

export default async function handler(req, res) {
  const a = requireAuth(req, res); if (!a) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  try {
    const limit = Math.min(parseInt(req.query?.limit || '365', 10) || 365, 1000);
    const { rows } = await query('SELECT day,equity,pnl_day,metrics FROM equity_snapshots ORDER BY day ASC LIMIT $1', [limit]);
    res.status(200).json({ snapshots: rows.map(r => ({
      day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
      equity: Number(r.equity), pnlDay: Number(r.pnl_day), metrics: r.metrics || {},
    })) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
