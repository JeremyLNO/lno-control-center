// Auth: GET = current user (me); POST {action:login|google|otp|logout|changePassword}.
import crypto from 'crypto';
import { query } from './_lib/db.js';
import { verifyPassword, signToken, hashPassword, hashOtpCode, requireAuth, passwordIssues, clientIp } from './_lib/auth.js';
import { verifyGoogleToken, ALLOWED_DOMAIN } from './_lib/google.js';
import { ROLE_PERMS, randomStyle2Avatar } from './_lib/constants.js';
import { sanitizeUserWithPerms } from './_lib/rolePerms.js';
import { notify, getUsersByRole, rolesForType, getOpenWAConfig } from './_lib/notify.js';
import { loginFailureText, newSignupText } from './_lib/notifyText.js';
import { sendOtpEmail, sendNewSignupEmail } from './_lib/mailer.js';

const MAX_ATTEMPTS = 5, LOCK_MINUTES = 15;

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

// Shared brute-force bookkeeping for BOTH password login and OTP verification failures —
// one lockout mechanism, not two that could drift apart. Alerts admins on the 3rd
// consecutive failure, locks the account at MAX_ATTEMPTS. Caller always responds with a
// generic error regardless of what happened here.
async function registerFailedAttempt(u) {
  const up = await query('UPDATE users SET failed_attempts=failed_attempts+1 WHERE id=$1 RETURNING failed_attempts', [u.id]);
  const n = up.rows[0]?.failed_attempts || 0;
  if (n === 3) await notify((lang) => loginFailureText(lang, u.email), { type: 'login' });
  if (n >= MAX_ATTEMPTS) { try { await query(`UPDATE users SET locked_until = now() + interval '${LOCK_MINUTES} minutes' WHERE id=$1`, [u.id]); } catch (e) {} }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const { rows } = await query('SELECT * FROM users WHERE id=$1', [a.id]);
      if (!rows[0] || !rows[0].active) return res.status(401).json({ error: 'unauthorized' });
      try { await query('UPDATE users SET last_seen_at=now(), last_ip=COALESCE($2, last_ip) WHERE id=$1', [a.id, clientIp(req)]); } catch (e) {}
      return res.status(200).json({ user: await sanitizeUserWithPerms(rows[0]) });
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      const action = body.action;

      if (action === 'login') {
        // The seeded admin account (and any other 'password'-provider account) signs in with
        // email + password — this is the internal break-glass path. Shareholders moved to
        // OTP (see 'requestOtp'/'verifyOtp' below); an account still on auth_provider='password'
        // simply isn't a shareholder (that provider is only ever assigned to the admin seed).
        const { rows } = await query('SELECT * FROM users WHERE lower(email)=lower($1)', [String(body.email || '').trim()]);
        const u = rows[0];
        // brute-force lockout (account-based): block while locked, regardless of password
        if (u && u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
          const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
          return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} min.` });
        }
        const ok = u && u.active && await verifyPassword(body.password, u.password_hash);
        if (!ok) {
          if (u) await registerFailedAttempt(u);
          return res.status(401).json({ error: 'Invalid email or password' });
        }
        const fresh = await recordLogin(u, req, 'password');
        return res.status(200).json({ token: signToken(fresh), user: await sanitizeUserWithPerms(fresh) });
      }

      // Shareholder sign-in, step 1: email -> emailed 6-digit code. Always returns {ok:true}
      // regardless of whether the account exists/qualifies, to avoid leaking which emails
      // have accounts — the only observable difference for an unknown/ineligible email is
      // that no email arrives.
      if (action === 'requestOtp') {
        const email = String(body.email || '').trim();
        // @lno.company accounts always sign in with Google — telling them so isn't an
        // enumeration leak (it's true of the whole domain, not any one account).
        if (/@lno\.company$/i.test(email)) {
          return res.status(400).json({ error: 'Use Google Sign-In for @lno.company emails.', code: 'GOOGLE_ONLY' });
        }
        const { rows } = await query('SELECT * FROM users WHERE lower(email)=lower($1)', [email]);
        const u = rows[0];
        if (u && u.active && (u.auth_provider || 'password') === 'otp') {
          try {
            // rate-limit: don't issue (or send) a new code within 60s of the last one
            const recent = await query("SELECT 1 FROM otp_codes WHERE user_id=$1 AND created_at > now() - interval '60 seconds' LIMIT 1", [u.id]);
            if (!recent.rows[0]) {
              const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
              await query(`INSERT INTO otp_codes (user_id,code_hash,expires_at) VALUES ($1,$2, now() + interval '10 minutes')`, [u.id, hashOtpCode(code)]);
              await sendOtpEmail(u.email, code).catch(() => {}); // best-effort — a mail-provider hiccup shouldn't surface here
            }
          } catch (e) { /* never leak errors on this endpoint either */ }
        }
        return res.status(200).json({ ok: true });
      }

      // Shareholder sign-in, step 2: email + code -> token. Shares the exact same
      // account-lockout mechanism as password login (registerFailedAttempt above).
      if (action === 'verifyOtp') {
        const email = String(body.email || '').trim();
        const code = String(body.code || '').trim();
        const { rows } = await query('SELECT * FROM users WHERE lower(email)=lower($1)', [email]);
        const u = rows[0];
        if (u && u.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
          const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
          return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} min.` });
        }
        let ok = false;
        if (u && u.active && (u.auth_provider || 'password') === 'otp') {
          const otpRow = (await query(
            `SELECT * FROM otp_codes WHERE user_id=$1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [u.id]
          )).rows[0];
          if (otpRow && otpRow.attempts < 5 && otpRow.code_hash === hashOtpCode(code)) {
            await query('UPDATE otp_codes SET consumed_at=now() WHERE id=$1', [otpRow.id]);
            ok = true;
          } else if (otpRow) {
            await query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [otpRow.id]);
          }
        }
        if (!ok) {
          if (u) await registerFailedAttempt(u);
          return res.status(401).json({ error: 'Invalid or expired code' });
        }
        const fresh = await recordLogin(u, req, 'otp');
        return res.status(200).json({ token: signToken(fresh), user: await sanitizeUserWithPerms(fresh) });
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
          // Google's own profile photo, when present — otherwise a random preset avatar
          // (Avatars CC, style 2 only; see api/users.js/POST for the admin-created path).
          const avatar = payload.picture || randomStyle2Avatar();
          await query(
            `INSERT INTO users (id,username,email,first_name,last_name,role,active,permissions,phone,notify,password_hash,auth_provider,avatar)
             VALUES ($1,$2,$3,$4,$5,'viewer',true,$6::jsonb,'',false,$7,'google',$8)`,
            [id, username, email, firstName, lastName, JSON.stringify(ROLE_PERMS.viewer), unusable, avatar]
          );
          u = (await query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
          // New sign-up alert — best-effort, both channels, never blocks the sign-in itself.
          const displayName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : email;
          try { await notify((lang) => newSignupText(lang, displayName, email), { type: 'new_signup' }); } catch (e) {}
          try {
            const cfg = await getOpenWAConfig();
            const admins = await getUsersByRole(await rolesForType(cfg, 'new_signup'));
            for (const a of admins) await sendNewSignupEmail(a.email, displayName, email).catch(() => {});
          } catch (e) {}
        } else {
          if (!u.active) return res.status(403).json({ error: 'This account has been disabled' });
          // save the latest first/last name from Google on every sign-in
          await query('UPDATE users SET first_name=$1, last_name=$2, auth_provider=$3, failed_attempts=0 WHERE id=$4',
            [firstName || u.first_name, lastName || u.last_name, 'google', u.id]);
          u = (await query('SELECT * FROM users WHERE id=$1', [u.id])).rows[0];
        }
        const fresh = await recordLogin(u, req, 'google');
        return res.status(200).json({ token: signToken(fresh), user: await sanitizeUserWithPerms(fresh) });
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
