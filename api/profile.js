// Self-service profile update (any authenticated user). Username & email are NOT
// editable here (username is admin-only; email is read-only).
import { query } from './_lib/db.js';
import { requireAuth, sanitizeUser } from './_lib/auth.js';
import { encrypt, decrypt } from './_lib/crypto.js';
import { sendCallMeBot } from './_lib/notify.js';

const WELCOME = '🎉 Welcome to LNO Control Center alerts! Your WhatsApp is set up — you\'ll receive your alerts right here.';

export default async function handler(req, res) {
  const a = requireAuth(req, res); if (!a) return;
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'method not allowed' });
  try {
    const body = req.body || {};
    // snapshot BEFORE the update so we can detect a notify OFF -> ON transition
    const before = (await query('SELECT notify FROM users WHERE id=$1', [a.id])).rows[0] || {};
    const map = { firstName: 'first_name', lastName: 'last_name', phone: 'phone', notify: 'notify', avatar: 'avatar' };
    const sets = [], vals = []; let i = 1;
    for (const k of Object.keys(map)) {
      if (k in body) { sets.push(`${map[k]}=$${i}`); vals.push(body[k]); i++; }
    }
    // personal CallMeBot key — stored encrypted; blank means "keep unchanged".
    // Adding a key auto-enables WhatsApp notifications (unless notify was set explicitly).
    let keyAdded = false;
    if (typeof body.waApikey === 'string' && body.waApikey !== '') {
      sets.push(`wa_apikey=$${i}`); vals.push(encrypt(body.waApikey)); i++; keyAdded = true;
      if (!('notify' in body)) { sets.push(`notify=$${i}`); vals.push(true); i++; }
    }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(a.id);
    await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i}`, vals);
    const { rows } = await query('SELECT * FROM users WHERE id=$1', [a.id]);
    const u = rows[0];
    // Welcome message whenever the user TURNS ON notifications (off -> on) or (re)sets their
    // key. Needs a phone + a stored key to actually deliver via CallMeBot.
    const turnedOn = !before.notify && u.notify;
    if ((turnedOn || keyAdded) && u.phone && u.wa_apikey) {
      try { await sendCallMeBot(u.phone, keyAdded ? body.waApikey : decrypt(u.wa_apikey), WELCOME); } catch (e) {}
    }
    res.status(200).json({ user: sanitizeUser(u) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
