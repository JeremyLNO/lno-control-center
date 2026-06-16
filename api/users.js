// User administration (admin only). Internal roles sign in with Google (@lno.company,
// no usable password). Shareholders have EXTERNAL emails so an admin creates them with a
// policy-checked password (they can't use Google sign-in).
import { query } from './_lib/db.js';
import { requireAdmin, hashPassword, sanitizeUser, passwordIssues } from './_lib/auth.js';
import { ROLE_PERMS } from './_lib/constants.js';

export default async function handler(req, res) {
  const a = requireAdmin(req, res); if (!a) return;
  try {
    if (req.method === 'GET') {
      if (req.query?.logins) {
        let rows = [];
        try { rows = (await query('SELECT username,ip,method,created_at FROM login_events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 12', [req.query.logins])).rows; } catch (e) {}
        return res.status(200).json({ logins: rows.map(r => ({ ip: r.ip, method: r.method, createdAt: r.created_at })) });
      }
      const { rows } = await query('SELECT * FROM users ORDER BY created_at ASC');
      return res.status(200).json({ users: rows.map(sanitizeUser) });
    }
    const body = req.body || {};

    if (req.method === 'POST') {
      // the email IS the identity (no username concept)
      const email = String(body.email || '').trim();
      const { firstName = '', lastName = '', role = 'viewer', password } = body;
      const isShareholder = role === 'shareholder';
      if (isShareholder) {
        // external emails are allowed for shareholders; a valid password is required
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
        const issues = passwordIssues(password);
        if (issues.length) return res.status(400).json({ error: 'Password needs ' + issues.join(', ') });
      } else {
        if (!email.endsWith('@lno.company')) return res.status(400).json({ error: 'Email must end with @lno.company' });
      }
      const exists = await query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
      if (exists.rows[0]) return res.status(409).json({ error: 'An account with this email already exists' });
      const id = 'u' + Date.now();
      const perms = ROLE_PERMS[role] || ROLE_PERMS.viewer;
      // shareholders sign in with email + password; internal roles use Google (no usable password)
      const provider = isShareholder ? 'password' : 'google';
      const hash = isShareholder ? await hashPassword(password) : await hashPassword('google:' + id + ':' + Math.random());
      await query(
        `INSERT INTO users (id,username,email,first_name,last_name,role,active,permissions,password_hash,auth_provider)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7::jsonb,$8,$9)`,
        [id, email, email, firstName, lastName, role, JSON.stringify(perms), hash, provider]
      );
      const { rows } = await query('SELECT * FROM users WHERE id=$1', [id]);
      return res.status(201).json({ user: sanitizeUser(rows[0]) });
    }

    if (req.method === 'PATCH') {
      const { id, ...patch } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (patch.role) patch.permissions = ROLE_PERMS[patch.role] || ROLE_PERMS.viewer; // role change resets perms
      const map = { firstName: 'first_name', lastName: 'last_name', active: 'active', role: 'role', permissions: 'permissions' };
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
