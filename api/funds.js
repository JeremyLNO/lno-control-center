// Funds: GET for any authenticated user; PUT (replace-all) for admins.
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';

const out = (rows) => rows.map(r => ({ id: r.id, name: r.name, color: r.color, bots: r.bots || [] }));

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const { rows } = await query('SELECT * FROM funds ORDER BY sort ASC');
      return res.status(200).json({ funds: out(rows) });
    }
    if (req.method === 'PUT') {
      const a = requireAdmin(req, res); if (!a) return;
      const funds = req.body?.funds;
      if (!Array.isArray(funds) || !funds.length) return res.status(400).json({ error: 'funds array required' });
      await query('DELETE FROM funds');
      let sort = 0;
      for (const f of funds) {
        await query('INSERT INTO funds (id,name,color,bots,sort) VALUES ($1,$2,$3,$4::jsonb,$5)',
          [f.id, f.name, f.color, JSON.stringify(f.bots || []), sort++]);
      }
      const { rows } = await query('SELECT * FROM funds ORDER BY sort ASC');
      return res.status(200).json({ funds: out(rows) });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
