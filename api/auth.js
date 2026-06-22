// Auth: GET = current user (me); POST {action:login|google|logout|changePassword}.
import { query } from './_lib/db.js';
import { verifyPassword, signToken, hashPassword, requireAuth, sanitizeUser, passwordIssues, clientIp } from './_lib/auth.js';
import { verifyGoogleToken, ALLOWED_DOMAIN } from './_lib/google.js';
import { ROLE_PERMS } from './_lib/constants.js';
import { notify } from './_lib/notify.js';

// record a successful sign-in: reset failures, stamp last login/seen/IP, append an audit row
async function recordLogin(u, req, method) {
  const ip = clientIp(req);
  await query('UPDATE users SET failed_attempts=0 WHERE id=$1', [u.id]); // works even pre-migration
  try {
    await query('UPDATE users SET last_login_at=now(), last_seen_at=now(), last_ip=COALESCE($2, last_ip), locked_until=NULL WHERE id=$1', [u.id, ip]);
    await query('INSERT INTO login_events (user_id,username,ip,method) VALUES ($1,$2,$3,$4)', [u.id, u.email, ip, method]);
  } catch (e) { /* audit columns/table not migrated yet — don't block sign-in */ }
  return (await query('SELECT * FROM users WHERE id=$1', [u.id])).rows[0];
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const { rows } = await query('SELECT * FROM users WHERE id=$1', [a.id]);
      if (!rows[0] || !rows[0].active) return res.status(401).json({ error: 'unauthorized' });
      try { await query('UPDATE users SET last_seen_at=now(), last_ip=COALESCE($2, last_ip) WHERE id=$1', [a.id, clientIp(req)]); } catch (e) {}
      return res.status(200).json({ user: sanitizeUser(rows[0]) });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action;

      if (action === 'login') {
        const MAX_ATTEMPTS = 5, LOCK_MINUTES = 15;
        // shareholders (external email) sign in with email + password; internal users use Google
        const { rows } = await query('SELECT * FROM users WHERE lower(email)=lower($1)', [String(body.email || '').trim()]);
        const u = rows[0];
        // brute-force lockout (account-based): block while locked, regardless of password
        if (u && u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
          const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
          return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} min.` });
        }
        const ok = u && u.active && await verifyPassword(body.password, u.password_hash);
        if (!ok) {
          if (u) {
            const up = await query('UPDATE users SET failed_attempts=failed_attempts+1 WHERE id=$1 RETURNING failed_attempts', [u.id]);
            const n = up.rows[0]?.failed_attempts || 0;
            // alert admins on the 3rd consecutive failure (spec: after 3 failed attempts)
            if (n === 3) await notify(`⚠️ LNO Control Center — 3 failed login attempts for "${u.email}".`, { type: 'login' });
            // lock the account after MAX_ATTEMPTS (best-effort: column may be pre-migration)
            if (n >= MAX_ATTEMPTS) { try { await query(`UPDATE users SET locked_until = now() + interval '${LOCK_MINUTES} minutes' WHERE id=$1`, [u.id]); } catch (e) {} }
          }
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        const fresh = await recordLogin(u, req, 'password');
        return res.status(200).json({ token: signToken(fresh), user: sanitizeUser(fresh) });
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
        const username = email; // username concept removed — the email is the identity
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
        const fresh = await recordLogin(u, req, 'google');
        return res.status(200).json({ token: signToken(fresh), user: sanitizeUser(fresh) });
      }

      if (action === 'heartbeat') {
        const a = requireAuth(req, res); if (!a) return;
        try { await query('UPDATE users SET last_seen_at=now(), last_ip=COALESCE($2, last_ip) WHERE id=$1', [a.id, clientIp(req)]); } catch (e) {}
        return res.status(200).json({ ok: true });
      }

      if (action === 'changePassword') {
        const a = requireAuth(req, res); if (!a) return;
        const pwIssues = passwordIssues(body.next);
        if (pwIssues.length) return res.status(400).json({ error: 'Password needs ' + pwIssues.join(', ') });
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
