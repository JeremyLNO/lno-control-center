// User administration (admin only). Passwords are never accepted/returned here —
// new users get a bcrypt-hashed default password server-side.
import { query } from './_lib/db.js';
import { requireAdmin, hashPassword, sanitizeUser } from './_lib/auth.js';
import { ROLE_PERMS } from './_lib/constants.js';

export default async function handler(req, res) {
  const a = requireAdmin(req, res); if (!a) return;
  try {
    if (req.method === 'GET') {
      const { rows } = await query('SELECT * FROM users ORDER BY created_at ASC');
      return res.status(200).json({ users: rows.map(sanitizeUser) });
    }
    const body = req.body || {};

    if (req.method === 'POST') {
      const { username, email, firstName = '', lastName = '', role = 'viewer' } = body;
      if (!username || !String(username).trim()) return res.status(400).json({ error: 'Username is required' });
      if (!String(email || '').endsWith('@lno.company')) return res.status(400).json({ error: 'Email must end with @lno.company' });
      const exists = await query('SELECT 1 FROM users WHERE username=$1', [String(username).trim()]);
      if (exists.rows[0]) return res.status(409).json({ error: 'Username must be unique' });
      const id = 'u' + Date.now();
      const perms = ROLE_PERMS[role] || ROLE_PERMS.viewer;
      // pre-provisioned accounts sign in with Google (@lno.company) — no usable password
      const unusable = await hashPassword('google:' + id + ':' + Math.random());
      await query(
        `INSERT INTO users (id,username,email,first_name,last_name,role,active,permissions,password_hash,auth_provider)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7::jsonb,$8,'google')`,
        [id, String(username).trim(), email, firstName, lastName, role, JSON.stringify(perms), unusable]
      );
      const { rows } = await query('SELECT * FROM users WHERE id=$1', [id]);
      return res.status(201).json({ user: sanitizeUser(rows[0]) });
    }

    if (req.method === 'PATCH') {
      const { id, ...patch } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (patch.role) patch.permissions = ROLE_PERMS[patch.role] || ROLE_PERMS.viewer; // role change resets perms
      const map = { username: 'username', firstName: 'first_name', lastName: 'last_name', active: 'active', role: 'role', permissions: 'permissions' };
      const sets = [], vals = []; let i = 1;
      for (const k of Object.keys(patch)) {
        if (!(k in map)) continue;
        if (k === 'permissions') { sets.push(`permissions=$${i}::jsonb`); vals.push(JSON.stringify(patch[k])); }
        else { sets.push(`${map[k]}=$${i}`); vals.push(patch[k]); }
        i++;
      }
      if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
      vals.push(id);
      await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i}`, vals);
      const { rows } = await query('SELECT * FROM users WHERE id=$1', [id]);
      return res.status(200).json({ user: sanitizeUser(rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = body.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (id === a.id) return res.status(400).json({ error: 'cannot delete yourself' });
      await query('DELETE FROM users WHERE id=$1', [id]);
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
