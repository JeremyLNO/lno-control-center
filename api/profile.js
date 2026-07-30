// Self-service profile update (any authenticated user). Username & email are NOT
// editable here (username is admin-only; email is read-only).
import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { sanitizeUserWithPerms } from './_lib/rolePerms.js';
import { getOpenWAConfig, getApiKey, sendTextMeBot } from './_lib/notify.js';
import { welcomeText } from './_lib/notifyText.js';
import { SUPPORTED_LANGS } from './_lib/constants.js';

export default async function handler(req, res) {
  const a = requireAuth(req, res); if (!a) return;

  // Colleague directory: the minimum needed to @mention someone or assign them a comment.
  // Deliberately NOT the admin user list — no role, no phone, no login history, no status,
  // just who exists and what to call them. Any signed-in user can see who their colleagues
  // are; that is already visible on every comment they write.
  if (req.method === 'GET' && req.query?.directory) {
    const { rows } = await query(
      `SELECT id, username, email, first_name, last_name, avatar FROM users
       WHERE active ORDER BY username ASC`
    );
    return res.status(200).json({ users: rows.map(u => ({
      id: u.id, username: u.username,
      name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username,
      handle: String(u.email || '').split('@')[0] || u.username,
      avatar: u.avatar || null,
    })) });
  }

  if (req.method !== 'PATCH') return res.status(405).json({ error: 'method not allowed' });
  try {
    const body = req.body || {};
    if ('language' in body && !SUPPORTED_LANGS.includes(body.language)) return res.status(400).json({ error: 'unsupported language' });
    // snapshot BEFORE the update so we can detect a notify OFF -> ON transition
    const before = (await query('SELECT notify FROM users WHERE id=$1', [a.id])).rows[0] || {};
    const map = { firstName: 'first_name', lastName: 'last_name', phone: 'phone', notify: 'notify', avatar: 'avatar', language: 'language' };
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
      try { const apikey = getApiKey(await getOpenWAConfig()); if (apikey) await sendTextMeBot(u.phone, welcomeText(u.language), apikey); } catch (e) {}
    }
    res.status(200).json({ user: await sanitizeUserWithPerms(u) });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
