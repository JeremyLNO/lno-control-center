// Auth: GET = current user (me); POST {action:login|google|logout|changePassword}.
import { query } from './_lib/db.js';
import { verifyPassword, signToken, hashPassword, requireAuth, sanitizeUser } from './_lib/auth.js';
import { verifyGoogleToken, ALLOWED_DOMAIN } from './_lib/google.js';
import { ROLE_PERMS } from './_lib/constants.js';
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

      if (action === 'google') {
        if (!body.credential) return res.status(400).json({ error: 'Missing Google credential' });
        let payload;
        try { payload = await verifyGoogleToken(body.credential); }
        catch (e) { return res.status(401).json({ error: 'Google sign-in could not be verified' }); }
        const email = String(payload.email || '').toLowerCase();
        const domain = email.split('@')[1] || '';
        // hard domain restriction: verified email, on the allowed domain, matching hd when present
        if (!payload.email_verified || domain !== ALLOWED_DOMAIN || (payload.hd && String(payload.hd).toLowerCase() !== ALLOWED_DOMAIN))
          return res.status(403).json({ error: `Sign-in is restricted to @${ALLOWED_DOMAIN} accounts` });
        const username = email.split('@')[0];
        const firstName = payload.given_name || '';
        const lastName = payload.family_name || '';
        // identity is the email; first sign-in provisions a viewer account
        let { rows } = await query('SELECT * FROM users WHERE lower(email)=$1 LIMIT 1', [email]);
        let u = rows[0];
        if (!u) {
          const id = 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          const unusable = await hashPassword('google:' + id + ':' + Math.random());
          await query(
            `INSERT INTO users (id,username,email,first_name,last_name,role,active,permissions,phone,notify,password_hash,auth_provider)
             VALUES ($1,$2,$3,$4,$5,'viewer',true,$6::jsonb,'',false,$7,'google')`,
            [id, username, email, firstName, lastName, JSON.stringify(ROLE_PERMS.viewer), unusable]
          );
          u = (await query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
        } else {
          if (!u.active) return res.status(403).json({ error: 'This account has been disabled' });
          // save the latest first/last name from Google on every sign-in
          await query('UPDATE users SET first_name=$1, last_name=$2, auth_provider=$3, failed_attempts=0 WHERE id=$4',
            [firstName || u.first_name, lastName || u.last_name, 'google', u.id]);
          u = (await query('SELECT * FROM users WHERE id=$1', [u.id])).rows[0];
        }
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
