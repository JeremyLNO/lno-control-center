// WhatsApp alerts via CallMeBot (https://www.callmebot.com/blog/free-api-whatsapp-messages/).
// No server to host: each recipient opts in once and gets their own personal api key,
// then we send a plain HTTPS GET. The api key is decrypted only here, server-side.
//   GET https://api.callmebot.com/whatsapp.php?phone=<intl-no-plus>&text=<urlenc>&apikey=<key>
// Limitations: send-only (no inbound/ACK replies) and text-only (no file attachments).
import { query } from './db.js';
import { decrypt } from './crypto.js';
import { DEFAULT_MATRIX, WA_ROLES } from './constants.js';

const CALLMEBOT_URL = 'https://api.callmebot.com/whatsapp.php';

// "new report" notice sent to opted-in shareholders (CallMeBot is text-only — they download the PDF)
export const REPORT_AVAILABLE = '📄 A new LNO report is available. Open the Control Center ▸ Reports to download it.';

export async function getOpenWAConfig() {
  const { rows } = await query("SELECT value FROM app_config WHERE key='openwa'");
  return rows[0] ? rows[0].value : {};
}

// Low-level send to one recipient (phone + that recipient's CallMeBot api key).
// Every attempt is logged to wa_log (best-effort) for the admin WhatsApp message log.
export async function sendCallMeBot(phone, apikey, message) {
  const num = String(phone || '').replace(/[^0-9]/g, '');
  if (!num) return { ok: false, skipped: 'no-phone' };
  if (!apikey) return { ok: false, skipped: 'no-apikey' };
  let result;
  try {
    const url = `${CALLMEBOT_URL}?phone=${num}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apikey)}`;
    const r = await fetch(url);
    const body = await r.text().catch(() => '');
    // CallMeBot returns HTTP 200 even on failure (reason in the body), so confirm success
    const ok = r.ok && /queued|sent|success/i.test(body);
    result = { ok, status: r.status, response: body.slice(0, 400) };
  } catch (e) {
    result = { ok: false, status: null, response: String(e.message || e) };
  }
  try {
    await query('INSERT INTO wa_log (phone,message,ok,status,response) VALUES ($1,$2,$3,$4,$5)',
      [phone, String(message || '').slice(0, 1000), !!result.ok, result.status || null, (result.response || '').slice(0, 400)]);
  } catch (e) { /* logging is best-effort */ }
  return { ok: result.ok, status: result.status };
}

// CallMeBot is text-only — no document attachment. Kept so callers don't break; the
// monthly PDF stays downloadable from the Reports page.
export async function sendFile() { return { ok: false, skipped: 'callmebot-no-files' }; }

// Which roles receive a given message type (admin-configurable matrix; falls back to defaults).
export async function rolesForType(cfg, type) {
  const matrix = (cfg && cfg.notifMatrix && typeof cfg.notifMatrix === 'object') ? cfg.notifMatrix : DEFAULT_MATRIX;
  const roles = Array.isArray(matrix[type]) ? matrix[type] : [];
  return roles.filter(r => WA_ROLES.includes(r));
}

// Recipients for a message type = active opted-in users (phone + own CallMeBot key) whose
// role is enabled for that type in the matrix. Returns {phone, apikey} pairs.
export async function getRecipientsForType(cfg, type) {
  const roles = await rolesForType(cfg, type);
  if (!roles.length) return [];
  const ph = roles.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await query(
    `SELECT phone, wa_apikey FROM users WHERE active=true AND notify=true AND phone IS NOT NULL AND phone <> ''
       AND wa_apikey IS NOT NULL AND wa_apikey <> '' AND role IN (${ph})`, roles);
  const out = []; const seen = new Set();
  for (const r of rows) {
    const k = String(r.phone || '').replace(/[^0-9]/g, '');
    if (!k || seen.has(k)) continue;
    try { const ak = decrypt(r.wa_apikey); if (ak) { seen.add(k); out.push({ phone: r.phone, apikey: ak }); } } catch (e) {}
  }
  return out;
}

// Send a message of `type` to every role enabled for it in the matrix. Never throws.
export async function notify(message, { type } = {}) {
  try {
    const cfg = await getOpenWAConfig();
    if (!cfg.enabled) return { sent: 0, skipped: 'disabled' };
    if (!type) return { sent: 0, skipped: 'no-type' };
    const tos = await getRecipientsForType(cfg, type);
    let sent = 0;
    for (const t of tos) { const r = await sendCallMeBot(t.phone, t.apikey, message); if (r.ok) sent++; }
    return { sent, total: tos.length };
  } catch (e) {
    return { sent: 0, error: String(e.message || e) };
  }
}
