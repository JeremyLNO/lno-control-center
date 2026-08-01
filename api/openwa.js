// WhatsApp alerts (TextMeBot) config + alert rules + per-type/per-role routing.
// Admins, or any role granted 'manage_whatsapp' — the raw API key is never returned to
// anyone (only apiKeyMasked/hasApiKey), so there's no admin-vs-manager response-shape split
// needed here, unlike exchanges.js.
//   GET  -> config (+ ?log=1 -> sent-messages log)
//   PUT  -> update enabled / API key / thresholds / alert rules / notification matrix
//   POST -> {action:'test', message?}  send a test WhatsApp to the requesting user's own number
// One firm-wide TextMeBot account key sends to users who enabled WhatsApp in their profile.
import { query } from './_lib/db.js';
import { requireAuth } from './_lib/auth.js';
import { encrypt, decrypt, mask } from './_lib/crypto.js';
import { sendTextMeBot, getApiKey } from './_lib/notify.js';
import { welcomeText } from './_lib/notifyText.js';
import { DEFAULT_MATRIX, WA_ROLES, WA_MSG_TYPES } from './_lib/constants.js';
import { permsForRole } from './_lib/rolePerms.js';
import { audit } from './_lib/audit.js';
import { getLightsConfig, publicLightsConfig, saveLightsConfig, goveeDevices, hueLights, hueExchangeCode, syncLights, colorForPnl } from './_lib/lights.js';
import { buildPortfolio } from './_lib/portfolio.js';

async function getCfg() {
  const { rows } = await query(`SELECT value FROM app_config WHERE key='openwa'`);
  return rows[0] ? rows[0].value : {};
}
async function setCfg(v) {
  await query(`INSERT INTO app_config (key,value) VALUES ('openwa',$1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`, [JSON.stringify(v)]);
}
// Sanitize an incoming matrix to known types/roles only.
function cleanMatrix(m) {
  const out = {};
  for (const t of WA_MSG_TYPES) {
    const roles = (m && Array.isArray(m[t])) ? m[t].filter(r => WA_ROLES.includes(r)) : (DEFAULT_MATRIX[t] || []);
    out[t] = [...new Set(roles)];
  }
  return out;
}
function pub(cfg) {
  return {
    enabled: !!cfg.enabled,
    hasApiKey: !!(cfg.apiKeyEnc || process.env.TEXTMEBOT_APIKEY),
    apiKeyMasked: cfg.apiKeyEnc ? mask(decrypt(cfg.apiKeyEnc)) : (process.env.TEXTMEBOT_APIKEY ? '••••' : ''),
    drawdownPct: cfg.drawdownPct ?? 10, pnlDayThreshold: cfg.pnlDayThreshold ?? -5000,
    dailyReport: cfg.dailyReport ?? true,
    alertRules: Array.isArray(cfg.alertRules) ? cfg.alertRules : [],
    notifMatrix: cleanMatrix(cfg.notifMatrix),
  };
}

export default async function handler(req, res) {
  const a = requireAuth(req, res); if (!a) return;

  // Smart-lights config shares this function purely because of the 12-serverless-function
  // cap — it is a separate feature with a STRICTER gate (admin only, never manage_whatsapp),
  // so it is handled before that permission check rather than inside it.
  if (req.query?.lights || req.body?.lights || String(req.body?.action || '').startsWith('lights') || String(req.body?.action || '').startsWith('govee') || String(req.body?.action || '').startsWith('hue')) {
    if (a.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    try { return await handleLights(req, res, a); }
    catch (e) { return res.status(500).json({ error: String(e.message || e) }); }
  }

  if (a.role !== 'admin' && !(await permsForRole(a.role)).includes('manage_whatsapp')) return res.status(403).json({ error: 'forbidden' });
  try {
    if (req.method === 'GET') {
      if (req.query?.log) {
        // Paged 50-at-a-time (?limit&?offset); ?status=ok|fail and ?q=<free text, matches
        // recipient/phone/message> filter server-side so paging stays correct while a filter
        // is active — resolves the recipient's name from their phone (digits-only match).
        const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 500);
        const offset = Math.max(Number(req.query?.offset) || 0, 0);
        const statusF = ['ok', 'fail'].includes(req.query?.status) ? req.query.status : null;
        const q = String(req.query?.q || '').trim();
        const nameExpr = `(SELECT NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '')
               FROM users u
               WHERE u.phone <> '' AND regexp_replace(u.phone,'[^0-9]','','g') = regexp_replace(w.phone,'[^0-9]','','g')
               LIMIT 1)`;
        const where = []; const params = [];
        if (statusF) { params.push(statusF === 'ok'); where.push(`w.ok=$${params.length}`); }
        if (q) { params.push('%' + q + '%'); const p = params.length; where.push(`(${nameExpr} ILIKE $${p} OR w.phone ILIKE $${p} OR w.message ILIKE $${p})`); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = (await query(`SELECT count(*)::int AS n FROM wa_log w ${whereSql}`, params)).rows[0]?.n || 0;
        const qparams = [...params, limit, offset];
        const { rows } = await query(`
          SELECT w.id, w.phone, w.message, w.ok, w.status, w.response, w.created_at, ${nameExpr} AS recipient_name
          FROM wa_log w ${whereSql}
          ORDER BY w.created_at DESC LIMIT $${qparams.length - 1} OFFSET $${qparams.length}`, qparams);
        return res.status(200).json({ total, log: rows.map(r => ({
          id: Number(r.id), recipientName: r.recipient_name || null, phone: r.phone,
          message: r.message, ok: r.ok, status: r.status, response: r.response, createdAt: r.created_at,
        })) });
      }
      return res.status(200).json({ config: pub(await getCfg()) });
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const cfg = await getCfg();
      const next = {
        ...cfg,
        enabled: body.enabled ?? cfg.enabled ?? false,
        drawdownPct: body.drawdownPct ?? cfg.drawdownPct ?? 10,
        pnlDayThreshold: body.pnlDayThreshold ?? cfg.pnlDayThreshold ?? -5000,
        dailyReport: body.dailyReport ?? cfg.dailyReport ?? true,
        alertRules: Array.isArray(body.alertRules) ? body.alertRules : (cfg.alertRules || []),
        notifMatrix: body.notifMatrix ? cleanMatrix(body.notifMatrix) : cleanMatrix(cfg.notifMatrix),
      };
      // Firm-wide TextMeBot account key — stored encrypted; blank means "keep existing".
      const keyChanged = typeof body.apiKey === 'string' && body.apiKey.trim() !== '';
      if (keyChanged) next.apiKeyEnc = encrypt(body.apiKey.trim());
      delete next.defaultSender; // legacy default-recipient field removed
      await setCfg(next);
      await audit(req, a, 'whatsapp.config', null, { enabled: next.enabled, apiKeyChanged: keyChanged, dailyReport: next.dailyReport });
      return res.status(200).json({ config: pub(next) });
    }

    if (req.method === 'POST') {
      const cfg = await getCfg();
      if (!cfg.enabled) return res.status(400).json({ error: 'WhatsApp alerts are disabled' });
      // test goes to the requesting admin's OWN WhatsApp number (set in their profile),
      // sent via the firm's single TextMeBot account key.
      const { rows } = await query('SELECT phone, language FROM users WHERE id=$1', [a.id]);
      const phone = rows[0] && rows[0].phone;
      if (!phone) return res.status(400).json({ error: 'Add your WhatsApp number in your Profile first' });
      const apikey = getApiKey(cfg);
      if (!apikey) return res.status(400).json({ error: 'Set the TextMeBot API key first' });
      const message = (req.body && req.body.message) || welcomeText(rows[0] && rows[0].language);
      const r = await sendTextMeBot(phone, message, apikey);
      return res.status(r.ok ? 200 : 502).json(r);
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}


/// Smart lights (Govee / Philips Hue) — admin only. See api/_lib/lights.js for why Hue goes
/// through Philips' remote API rather than the bridge on the desk's own network.
async function handleLights(req, res, a) {
  if (req.method === 'GET') {
    return res.status(200).json({ lights: publicLightsConfig(await getLightsConfig()) });
  }
  if (req.method === 'PUT') {
    const next = await saveLightsConfig(req.body.lights || {});
    await audit(req, a, 'lights.config', null, { enabled: next.enabled, govee: next.govee.enabled, hue: next.hue.enabled });
    return res.status(200).json({ lights: publicLightsConfig(next) });
  }
  if (req.method === 'POST') {
    const action = req.body?.action;
    if (action === 'goveeDevices') {
      const cfg = await getLightsConfig();
      // The key just typed into the form takes precedence over the stored one: this is how
      // an admin checks a NEW key before saving it.
      const key = (req.body.apiKey || '').trim() || (cfg.govee.apiKey ? decrypt(cfg.govee.apiKey) : '');
      if (!key) return res.status(400).json({ error: 'Govee API key required' });
      return res.status(200).json({ devices: await goveeDevices(key) });
    }
    if (action === 'hueLights') {
      return res.status(200).json({ lights: await hueLights(await getLightsConfig()) });
    }
    if (action === 'hueExchange') {
      if (!req.body.code) return res.status(400).json({ error: 'code required' });
      await hueExchangeCode(String(req.body.code));
      await audit(req, a, 'lights.hueLinked', null, {});
      return res.status(200).json({ lights: publicLightsConfig(await getLightsConfig()) });
    }
    if (action === 'lightsTest') {
      // Test against the REAL open P&L, not a made-up value: the point of the button is to
      // answer "what will my lamp do right now", and a fake number cannot answer that.
      const port = await buildPortfolio();
      const cfg = await getLightsConfig();
      const out = await syncLights(port.openPnl, { force: true });
      return res.status(200).json({ ...out, openPnl: port.openPnl, expected: colorForPnl(port.openPnl, cfg) });
    }
    return res.status(400).json({ error: 'unknown action' });
  }
  return res.status(405).json({ error: 'method not allowed' });
}
