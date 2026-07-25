// WhatsApp alerts via TextMeBot (https://www.textmebot.com/).
// One account API key for the whole firm sends to any recipient phone number.
//   GET https://api.textmebot.com/send.php?recipient=<intl-phone>&apikey=<key>&text=<urlenc>&json=yes
// The account key is decrypted only here (server-side), or read from TEXTMEBOT_APIKEY.
// Limitations: text-only here (no file attachments — sendFile is a no-op stub).
import { query } from './db.js';
import { decrypt } from './crypto.js';
import { DEFAULT_MATRIX, WA_ROLES } from './constants.js';
import { reportAvailableText } from './notifyText.js';
import { permsForRole } from './rolePerms.js';

// Report content (daily/weekly/monthly) is additionally gated by the matching
// view_reports_* Rules-page permission — without this, the WhatsApp notification matrix
// and the internal-email recipient list were a second, disconnected permission system: a
// role could be unchecked for "Daily Reports" on the Rules page yet still be enabled for
// 'daily' in the WhatsApp matrix (or just be 'viewer', the hardcoded internal-email role
// list) and keep receiving the report regardless. Only applies to report types — other
// message types (login/breach/stale/api_error/...) have no view_reports_* equivalent.
const REPORT_TYPE_PERM = { daily: 'view_reports_daily', weekly: 'view_reports_weekly', monthly: 'view_reports_monthly' };
export async function rolesWithReportAccess(roles, type) {
  const perm = REPORT_TYPE_PERM[type];
  if (!perm) return roles;
  const kept = [];
  for (const r of roles) { if ((await permsForRole(r)).includes(perm)) kept.push(r); }
  return kept;
}

const TEXTMEBOT_URL = 'https://api.textmebot.com/send.php';

// "new report" notice sent to opted-in shareholders (text-only — they download the PDF).
// A function of (lang) so notify() can render it in each recipient's own language —
// pass it straight through, same as any other notify() message builder.
export const REPORT_AVAILABLE = reportAvailableText;

export async function getOpenWAConfig() {
  const { rows } = await query("SELECT value FROM app_config WHERE key='openwa'");
  return rows[0] ? rows[0].value : {};
}

// The global TextMeBot account key: decrypted from the openwa config (apiKeyEnc),
// falling back to the TEXTMEBOT_APIKEY env var. Never returned to the client.
export function getApiKey(cfg) {
  try { if (cfg && cfg.apiKeyEnc) return decrypt(cfg.apiKeyEnc); } catch (e) {}
  return process.env.TEXTMEBOT_APIKEY || '';
}

// Low-level send to one recipient phone using the firm's TextMeBot account key.
// Every attempt is logged to wa_log (best-effort) for the admin WhatsApp message log.
export async function sendTextMeBot(phone, message, apikey) {
  const recipient = encodeURIComponent(String(phone || '').replace(/\s/g, ''));
  if (!recipient) return { ok: false, skipped: 'no-phone' };
  if (!apikey) return { ok: false, skipped: 'no-apikey' };
  let result;
  try {
    const url = `${TEXTMEBOT_URL}?recipient=${recipient}&apikey=${encodeURIComponent(apikey)}&text=${encodeURIComponent(message)}&json=yes`;
    const r = await fetch(url);
    const body = await r.text().catch(() => '');
    // No guaranteed schema — treat HTTP-ok + a success-ish body as delivered.
    const ok = r.ok && /success|sent|queued/i.test(body);
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

// TextMeBot can attach a document via &document=<url>, but that's not wired up here.
// Kept so callers don't break; the monthly PDF stays downloadable from the Reports page.
export async function sendFile() { return { ok: false, skipped: 'no-files' }; }

// Which roles receive a given message type (admin-configurable matrix; falls back to defaults).
export async function rolesForType(cfg, type) {
  const matrix = (cfg && cfg.notifMatrix && typeof cfg.notifMatrix === 'object') ? cfg.notifMatrix : DEFAULT_MATRIX;
  const roles = Array.isArray(matrix[type]) ? matrix[type] : [];
  return rolesWithReportAccess(roles.filter(r => WA_ROLES.includes(r)), type);
}

// Recipients for a message type = active opted-in users (with a phone) whose role is
// enabled for that type in the matrix. The firm's single key sends to all of them.
// Returns an array of {phone, language}, deduped by phone digits.
export async function getRecipientsForType(cfg, type) {
  const roles = await rolesForType(cfg, type);
  if (!roles.length) return [];
  const ph = roles.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await query(
    `SELECT phone, language FROM users WHERE active=true AND notify=true AND phone IS NOT NULL AND phone <> ''
       AND role IN (${ph})`, roles);
  const out = []; const seen = new Set();
  for (const r of rows) {
    const k = String(r.phone || '').replace(/[^0-9]/g, '');
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push({ phone: r.phone, language: r.language || 'en' });
  }
  return out;
}

// Active users' emails for a set of roles — used for operational alert emails (API errors,
// new sign-ups), which have no per-user opt-in the way WhatsApp does (every internal user
// already gets transactional emails like OTP codes without an opt-out).
export async function getUsersByRole(roles) {
  if (!roles || !roles.length) return [];
  const ph = roles.map((_, i) => `$${i + 1}`).join(',');
  const { rows } = await query(`SELECT email, first_name, last_name, language FROM users WHERE active=true AND role IN (${ph})`, roles);
  return rows.map(r => ({ email: r.email, firstName: r.first_name || '', lastName: r.last_name || '', language: r.language || 'en' }));
}

// Send a message of `type` to every role enabled for it in the matrix. Never throws.
// `messageOrFn` is either a plain string (sent as-is to everyone) or a function of
// (language) => string, called once per recipient so each gets it in their own
// users.language — see api/_lib/notifyText.js for the builders.
export async function notify(messageOrFn, { type } = {}) {
  try {
    const cfg = await getOpenWAConfig();
    if (!cfg.enabled) return { sent: 0, skipped: 'disabled' };
    if (!type) return { sent: 0, skipped: 'no-type' };
    const apikey = getApiKey(cfg);
    if (!apikey) return { sent: 0, skipped: 'no-apikey' };
    const tos = await getRecipientsForType(cfg, type);
    let sent = 0;
    for (const { phone, language } of tos) {
      const message = typeof messageOrFn === 'function' ? messageOrFn(language) : messageOrFn;
      const r = await sendTextMeBot(phone, message, apikey); if (r.ok) sent++;
    }
    return { sent, total: tos.length };
  } catch (e) {
    return { sent: 0, error: String(e.message || e) };
  }
}
