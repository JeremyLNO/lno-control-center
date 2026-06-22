// Self-service profile update (any authenticated user). Username & email are NOT
// editable here (username is admin-only; email is read-only).
import { query } from './_lib/db.js';
import { requireAuth, sanitizeUser } from './_lib/auth.js';
import { getOpenWAConfig, getApiKey, sendTextMeBot } from './_lib/notify.js';

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
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(a.id);
    await query(`UPDATE users SET ${sets.join(',')} WHERE id=$${i}`, vals);
    const { rows } = await query('SELECT * FROM users WHERE id=$1', [a.id]);
    const u = rows[0];
    // Welcome message when the user TURNS ON notifications (off -> on). Needs a phone and
    // the firm's TextMeBot account key configured to actually deliver. Best-effort.
    const turnedOn = !before.notify && u.notify;
    if (turnedOn && u.phone) {
      try { const apikey = getApiKey(await getOpenWAConfig()); if (apikey) await sendTextMeBot(u.phone, WELCOME, apikey); } catch (e) {}
    }
    res.status(200).json({ user: sanitizeUser(u) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
