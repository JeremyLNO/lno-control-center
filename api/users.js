// User administration (admin only). Internal roles sign in with Google (@lno.company,
// no usable password). Shareholders have EXTERNAL emails and sign in with an emailed
// one-time code (see api/auth.js requestOtp/verifyOtp) — no password at all.
import { query } from './_lib/db.js';
import { requireAdmin, hashPassword, sanitizeUser, passwordIssues } from './_lib/auth.js';
import { ROLE_PERMS } from './_lib/constants.js';
import { audit, recentAudit } from './_lib/audit.js';

// There must always be at least one active admin — used to block the last one from being
// deactivated, demoted, or deleted (whether by themselves or another admin).
async function isLastActiveAdmin(id) {
  const target = (await query('SELECT role,active FROM users WHERE id=$1', [id])).rows[0];
  if (!target || target.role !== 'admin' || !target.active) return false;
  const { rows } = await query("SELECT count(*)::int AS n FROM users WHERE role='admin' AND active=true AND id<>$1", [id]);
  return rows[0].n === 0;
}

export default async function handler(req, res) {
  const a = requireAdmin(req, res); if (!a) return;
  try {
    if (req.method === 'GET') {
      if (req.query?.audit) {
        try { return res.status(200).json({ audit: await recentAudit(req.query.limit || 100) }); }
        catch (e) { return res.status(200).json({ audit: [] }); }
      }
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
      const { firstName = '', lastName = '', role = 'viewer' } = body;
      const isShareholder = role === 'shareholder';
      if (isShareholder) {
        // external emails are allowed for shareholders — no password to validate, they sign
        // in with an emailed one-time code
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'A valid email is required' });
      } else {
        if (!email.endsWith('@lno.company')) return res.status(400).json({ error: 'Email must end with @lno.company' });
      }
      const exists = await query('SELECT 1 FROM users WHERE lower(email)=lower($1)', [email]);
      if (exists.rows[0]) return res.status(409).json({ error: 'An account with this email already exists' });
      const id = 'u' + Date.now();
      const perms = ROLE_PERMS[role] || ROLE_PERMS.viewer;
      // shareholders sign in with an emailed code; internal roles use Google — neither has a
      // usable password, so both get a random unusable hash
      const provider = isShareholder ? 'otp' : 'google';
      const hash = await hashPassword(provider + ':' + id + ':' + Math.random());
      await query(
        `INSERT INTO users (id,username,email,first_name,last_name,role,active,permissions,password_hash,auth_provider)
         VALUES ($1,$2,$3,$4,$5,$6,true,$7::jsonb,$8,$9)`,
        [id, email, email, firstName, lastName, role, JSON.stringify(perms), hash, provider]
      );
      await audit(req, a, 'user.create', email, { role, provider });
      // Employee Fund shares are no longer auto-granted on hire — an admin assigns a real
      // detected contribution to this employee once one lands (see employeeFund.js).
      const { rows } = await query('SELECT * FROM users WHERE id=$1', [id]);
      return res.status(201).json({ user: sanitizeUser(rows[0]) });
    }

    if (req.method === 'PATCH') {
      const { id, password, ...patch } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const demotesOrDeactivates = (patch.role && patch.role !== 'admin') || patch.active === false;
      if (demotesOrDeactivates && await isLastActiveAdmin(id)) {
        return res.status(400).json({ error: 'At least one active admin is required — promote or activate another admin first.' });
      }
      if (patch.role) patch.permissions = ROLE_PERMS[patch.role] || ROLE_PERMS.viewer; // role change resets perms
      const map = { firstName: 'first_name', lastName: 'last_name', active: 'active', role: 'role', permissions: 'permissions' };
      const sets = [], vals = []; let i = 1;
      for (const k of Object.keys(patch)) {
        if (!(k in map)) continue;
        if (k === 'permissions') { sets.push(`permissions=$${i}::jsonb`); vals.push(JSON.stringify(patch[k])); }
        else { sets.push(`${map[k]}=$${i}`); vals.push(patch[k]); }
        i++;
      }
      // admin-set a new password — only accounts still on the legacy 'password' provider
      // (the seeded admin, break-glass) have one to set; allow-listed rather than
      // block-listed so any account type other than 'password' (google, otp, and anything
      // added later) is rejected by default instead of silently allowed.
      if (typeof password === 'string' && password !== '') {
        const tgt = (await query('SELECT auth_provider FROM users WHERE id=$1', [id])).rows[0];
        if (!tgt) return res.status(404).json({ error: 'user not found' });
        if ((tgt.auth_provider || 'password') !== 'password') return res.status(400).json({ error: 'This account does not sign in with a password' });
        const issues = passwordIssues(password);
        if (issues.length) return res.status(400).json({ error: 'Password needs ' + issues.join(', ') });
        sets.push(`password_hash=$${i}`); vals.push(await hashPassword(password)); i++;
      }
      if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
      vals.push(id);
      await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i}`, vals);
      await audit(req, a, 'user.update', id, { fields: Object.keys(patch), passwordSet: typeof password === 'string' && password !== '' });
      const { rows } = await query('SELECT * FROM users WHERE id=$1', [id]);
      return res.status(200).json({ user: sanitizeUser(rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = body.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      if (id === a.id) return res.status(400).json({ error: 'cannot delete yourself' });
      if (await isLastActiveAdmin(id)) return res.status(400).json({ error: 'At least one active admin is required — promote or activate another admin first.' });
      await query('DELETE FROM users WHERE id=$1', [id]);
      await audit(req, a, 'user.delete', id, {});
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
