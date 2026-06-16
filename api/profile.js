// Self-service profile update (any authenticated user). Username & email are NOT
// editable here (username is admin-only; email is read-only).
import { query } from './_lib/db.js';
import { requireAuth, sanitizeUser } from './_lib/auth.js';
import { encrypt } from './_lib/crypto.js';
import { sendCallMeBot } from './_lib/notify.js';

const WELCOME = '🎉 Welcome to LNO Control Center alerts! Your WhatsApp is set up — you\'ll receive your alerts right here.';

export default async function handler(req, res) {
  const a = requireAuth(req, res); if (!a) return;
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'method not allowed' });
  try {
    const body = req.body || {};
    const map = { firstName: 'first_name', lastName: 'last_name', phone: 'phone', notify: 'notify', avatar: 'avatar' };
    const sets = [], vals = []; let i = 1;
    for (const k of Object.keys(map)) {
      if (k in body) { sets.push(`${map[k]}=$${i}`); vals.push(body[k]); i++; }
    }
    // personal CallMeBot key — stored encrypted; blank means "keep unchanged"
    if (typeof body.waApikey === 'string' && body.waApikey !== '') { sets.push(`wa_apikey=$${i}`); vals.push(encrypt(body.waApikey)); i++; }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(a.id);
    await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i}`, vals);
    const { rows } = await query('SELECT * FROM users WHERE id=$1', [a.id]);
    // welcome message: when a user (re)sets their CallMeBot key and has a phone, confirm it works
    if (typeof body.waApikey === 'string' && body.waApikey !== '' && rows[0].phone) {
      try { await sendCallMeBot(rows[0].phone, body.waApikey, WELCOME); } catch (e) {}
    }
    res.status(200).json({ user: sanitizeUser(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
