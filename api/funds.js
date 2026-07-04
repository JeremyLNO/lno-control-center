// Funds are GLOBAL entities (name + colour). Bots are assigned to a fund via bots.fund_id.
// Fund names must be unique (case-insensitive) — otherwise the Employee Fund could end up
// duplicated if an admin manually creates one named "Employee Fund" before this feature
// resolves/creates its own (see employeeFund.js's getEmployeeFundId()).
//   GET                    -> funds (+ bot counts, isEmployeeFund flag) (any auth)
//   GET ?myEquity=1        -> the caller's Employee Fund share  (any auth)
//   GET ?employeeSummary=1 -> Employee Fund totals + all shares (admin)
//   POST   -> create a fund                     (admin)
//   PATCH  -> rename / recolour / reorder       (admin)
//   DELETE -> remove a fund (unassigns its bots)(admin)
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';
import { FUND_PALETTE } from './_lib/constants.js';
import { getMyShare, getEmployeeFundSummary, peekEmployeeFundId } from './_lib/employeeFund.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

async function nameTaken(name, excludeId) {
  const { rows } = excludeId
    ? await query('SELECT 1 FROM funds WHERE lower(name)=lower($1) AND id<>$2', [name, excludeId])
    : await query('SELECT 1 FROM funds WHERE lower(name)=lower($1)', [name]);
  return !!rows[0];
}

async function listFunds() {
  const employeeFundId = await peekEmployeeFundId(); // read-only: never recreates the fund
  const { rows } = await query(`
    SELECT f.id, f.name, f.color, f.sort,
           COUNT(b.id)::int AS bot_count,
           COALESCE(SUM(CASE WHEN b.status='open' THEN 1 ELSE 0 END), 0)::int AS open_count
    FROM funds f LEFT JOIN bots b ON b.fund_id = f.id
    GROUP BY f.id, f.name, f.color, f.sort
    ORDER BY f.sort ASC, f.name ASC`);
  return rows.map(r => ({ id: r.id, name: r.name, color: r.color, sort: r.sort, botCount: r.bot_count, openCount: r.open_count, isEmployeeFund: r.id === employeeFundId }));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      if (req.query?.myEquity) return res.status(200).json(await getMyShare(a.id));
      if (req.query?.employeeSummary) { const adm = requireAdmin(req, res); if (!adm) return; return res.status(200).json(await getEmployeeFundSummary()); }
      return res.status(200).json({ funds: await listFunds() });
    }
    const body = req.body || {};

    if (req.method === 'POST') {
      const a = requireAdmin(req, res); if (!a) return;
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name required' });
      if (await nameTaken(name)) return res.status(409).json({ error: 'A fund with this name already exists' });
      const id = body.id || 'f' + Date.now();
      const color = HEX.test(body.color || '') ? body.color : FUND_PALETTE[0];
      const next = await query('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM funds');
      await query('INSERT INTO funds (id,name,color,bots,sort) VALUES ($1,$2,$3,$4::jsonb,$5)',
        [id, name, color, '[]', next.rows[0].s]);
      return res.status(201).json({ funds: await listFunds() });
    }

    if (req.method === 'PATCH') {
      const a = requireAdmin(req, res); if (!a) return;
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const sets = [], vals = []; let i = 1;
      if (typeof body.name === 'string' && body.name.trim()) {
        const name = body.name.trim();
        if (await nameTaken(name, id)) return res.status(409).json({ error: 'A fund with this name already exists' });
        sets.push(`name=$${i}`); vals.push(name); i++;
      }
      if (HEX.test(body.color || '')) { sets.push(`color=$${i}`); vals.push(body.color); i++; }
      if (typeof body.sort === 'number') { sets.push(`sort=$${i}`); vals.push(body.sort); i++; }
      if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
      vals.push(id);
      await query(`UPDATE funds SET ${sets.join(',')} WHERE id=$${i}`, vals);
      return res.status(200).json({ funds: await listFunds() });
    }

    if (req.method === 'DELETE') {
      const a = requireAdmin(req, res); if (!a) return;
      const id = body.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (id === await peekEmployeeFundId()) return res.status(400).json({ error: 'The Employee Fund can\'t be deleted — it holds every employee\'s contributed capital.' });
      await query('UPDATE bots SET fund_id=NULL WHERE fund_id=$1', [id]); // its bots become unassigned
      await query('DELETE FROM funds WHERE id=$1', [id]);
      return res.status(200).json({ funds: await listFunds() });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
