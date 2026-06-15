// Auth: GET = current user (me); POST {action:login|logout|changePassword}.
import { query } from './_lib/db.js';
import { verifyPassword, signToken, hashPassword, requireAuth, sanitizeUser } from './_lib/auth.js';
import { notify } from './_lib/notify.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const { rows } = await query('SELECT * FROM users WHERE id=$1', [a.id]);
      if (!rows[0] || !rows[0].active) return res.status(401).json({ error: 'unauthorized' });
      return res.status(200).json({ user: sanitizeUser(rows[0]) });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action;

      if (action === 'login') {
        const { rows } = await query('SELECT * FROM users WHERE username=$1', [String(body.username || '').trim()]);
        const u = rows[0];
        const ok = u && u.active && await verifyPassword(body.password, u.password_hash);
        if (!ok) {
          if (u) {
            const up = await query('UPDATE users SET failed_attempts=failed_attempts+1 WHERE id=$1 RETURNING failed_attempts', [u.id]);
            // alert admins on the 3rd consecutive failure (spec: after 3 failed attempts)
            if (up.rows[0]?.failed_attempts === 3) {
              await notify(`⚠️ LNO Control Center — 3 failed login attempts for user "${u.username}".`, { adminsOnly: true });
            }
          }
          return res.status(401).json({ error: 'Invalid username or password' });
        }
        await query('UPDATE users SET failed_attempts=0 WHERE id=$1', [u.id]);
        return res.status(200).json({ token: signToken(u), user: sanitizeUser(u) });
      }

      if (action === 'changePassword') {
        const a = requireAuth(req, res); if (!a) return;
        if (!body.next) return res.status(400).json({ error: 'New password must not be empty' });
        const { rows } = await query('SELECT * FROM users WHERE id=$1', [a.id]);
        const u = rows[0];
        if (!u || !await verifyPassword(body.current, u.password_hash))
          return res.status(400).json({ error: 'Current password is incorrect' });
        await query('UPDATE users SET password_hash=$1 WHERE id=$2', [await hashPassword(body.next), a.id]);
        return res.status(200).json({ ok: true });
      }

      if (action === 'logout') return res.status(200).json({ ok: true }); // stateless JWT
      return res.status(400).json({ error: 'unknown action' });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
