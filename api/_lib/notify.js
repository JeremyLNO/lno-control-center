// OpenWA send + recipient routing. Used by login-failure alerts, the alert cron,
// and the manual test button. The api key is decrypted only here, server-side.
import { query } from './db.js';
import { decrypt } from './crypto.js';

export async function getOpenWAConfig() {
  const { rows } = await query("SELECT value FROM app_config WHERE key='openwa'");
  return rows[0] ? rows[0].value : {};
}

export async function sendOpenWA(cfg, to, message) {
  if (!cfg || !cfg.enabled) return { ok: false, skipped: 'disabled' };
  if (!cfg.apiUrl) return { ok: false, skipped: 'no-url' };
  const num = String(to || '').replace(/[^0-9]/g, '');
  if (!num) return { ok: false, skipped: 'no-recipient' };
  const key = cfg.apiKeyEnc ? decrypt(cfg.apiKeyEnc) : '';
  try {
    const r = await fetch(cfg.apiUrl.replace(/\/$/, '') + '/sendText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
      body: JSON.stringify({ args: { to: num + '@c.us', content: message } }),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// Send a file (e.g. PDF report) as a WhatsApp document via OpenWA's /sendFile.
export async function sendFile(cfg, to, base64, filename, caption) {
  if (!cfg || !cfg.enabled || !cfg.apiUrl) return { ok: false, skipped: 'disabled' };
  const num = String(to || '').replace(/[^0-9]/g, '');
  if (!num) return { ok: false, skipped: 'no-recipient' };
  const key = cfg.apiKeyEnc ? decrypt(cfg.apiKeyEnc) : '';
  try {
    const r = await fetch(cfg.apiUrl.replace(/\/$/, '') + '/sendFile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) },
      body: JSON.stringify({ args: { to: num + '@c.us', file: 'data:application/pdf;base64,' + base64, filename, caption: caption || '' } }),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// Recipients = default recipient + active users who opted in (notify=true with a phone).
// adminsOnly restricts the per-user set to admins (used for security alerts).
export async function getRecipients({ adminsOnly = false, includeDefault = true } = {}) {
  const out = new Set();
  const cfg = await getOpenWAConfig();
  if (includeDefault && cfg.defaultSender) out.add(cfg.defaultSender);
  const sql = `SELECT phone FROM users WHERE active=true AND notify=true AND phone IS NOT NULL AND phone <> ''`
    + (adminsOnly ? " AND role='admin'" : '');
  const { rows } = await query(sql);
  rows.forEach(r => { if (r.phone) out.add(r.phone); });
  return [...out];
}

// Send one message to every routed recipient. Never throws.
export async function notify(message, opts = {}) {
  try {
    const cfg = await getOpenWAConfig();
    if (!cfg.enabled) return { sent: 0, skipped: 'disabled' };
    const tos = await getRecipients(opts);
    let sent = 0;
    for (const to of tos) { const r = await sendOpenWA(cfg, to, message); if (r.ok) sent++; }
    return { sent, total: tos.length };
  } catch (e) {
    return { sent: 0, error: String(e.message || e) };
  }
}
