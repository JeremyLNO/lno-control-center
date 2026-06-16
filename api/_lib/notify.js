// OpenWA send + recipient routing. Used by login-failure alerts, the alert cron,
// and the manual test button. The api key is decrypted only here, server-side.
//
// Targets the OpenWA gateway at github.com/rmyndharis/OpenWA (NestJS, whatsapp-web.js):
// session-scoped REST API, `X-API-Key` auth, JSON bodies.
//   text:     POST {apiUrl}/api/sessions/{sessionId}/messages/send-text     { chatId, text }
//   document: POST {apiUrl}/api/sessions/{sessionId}/messages/send-document { chatId, document:{base64}, filename, caption }
import { query } from './db.js';
import { decrypt } from './crypto.js';

export async function getOpenWAConfig() {
  const { rows } = await query("SELECT value FROM app_config WHERE key='openwa'");
  return rows[0] ? rows[0].value : {};
}

function sessionUrl(cfg, path) {
  return cfg.apiUrl.replace(/\/$/, '') + '/api/sessions/' + encodeURIComponent(cfg.sessionId) + path;
}
function authHeaders(cfg) {
  const key = cfg.apiKeyEnc ? decrypt(cfg.apiKeyEnc) : '';
  return { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) };
}

export async function sendOpenWA(cfg, to, message) {
  if (!cfg || !cfg.enabled) return { ok: false, skipped: 'disabled' };
  if (!cfg.apiUrl) return { ok: false, skipped: 'no-url' };
  if (!cfg.sessionId) return { ok: false, skipped: 'no-session' };
  const num = String(to || '').replace(/[^0-9]/g, '');
  if (!num) return { ok: false, skipped: 'no-recipient' };
  try {
    const r = await fetch(sessionUrl(cfg, '/messages/send-text'), {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify({ chatId: num + '@c.us', text: message }),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// Send a file (e.g. PDF report) as a WhatsApp document.
export async function sendFile(cfg, to, base64, filename, caption) {
  if (!cfg || !cfg.enabled || !cfg.apiUrl || !cfg.sessionId) return { ok: false, skipped: 'disabled' };
  const num = String(to || '').replace(/[^0-9]/g, '');
  if (!num) return { ok: false, skipped: 'no-recipient' };
  try {
    const r = await fetch(sessionUrl(cfg, '/messages/send-document'), {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify({ chatId: num + '@c.us', document: { base64: 'data:application/pdf;base64,' + base64 }, filename, caption: caption || '' }),
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
