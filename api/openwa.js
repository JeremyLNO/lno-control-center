// WhatsApp alerts (CallMeBot) config + alert rules + per-type/per-role routing (admin only).
//   GET  -> config (+ ?log=1 -> sent-messages log)
//   PUT  -> update enabled / thresholds / alert rules / notification matrix
//   POST -> {action:'test', message?}  send a test WhatsApp to the requesting admin's own number
// Recipients are users who enabled WhatsApp in their profile (no standalone default recipient).
import { query } from './_lib/db.js';
import { requireAdmin } from './_lib/auth.js';
import { decrypt } from './_lib/crypto.js';
import { sendCallMeBot } from './_lib/notify.js';
import { DEFAULT_MATRIX, WA_ROLES, WA_MSG_TYPES } from './_lib/constants.js';

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
    drawdownPct: cfg.drawdownPct ?? 10, pnlDayThreshold: cfg.pnlDayThreshold ?? -5000,
    dailyReport: cfg.dailyReport ?? true,
    alertRules: Array.isArray(cfg.alertRules) ? cfg.alertRules : [],
    notifMatrix: cleanMatrix(cfg.notifMatrix),
  };
}

export default async function handler(req, res) {
  const a = requireAdmin(req, res); if (!a) return;
  try {
    if (req.method === 'GET') {
      if (req.query?.log) {
        // resolve the recipient's name from their phone (digits-only match); newest first
        const { rows } = await query(`
          SELECT w.id, w.phone, w.message, w.ok, w.status, w.response, w.created_at,
            (SELECT NULLIF(TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')), '')
               FROM users u
               WHERE u.phone <> '' AND regexp_replace(u.phone,'[^0-9]','','g') = regexp_replace(w.phone,'[^0-9]','','g')
               LIMIT 1) AS recipient_name
          FROM wa_log w ORDER BY w.created_at DESC LIMIT 100`);
        return res.status(200).json({ log: rows.map(r => ({
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
      delete next.defaultSender; delete next.apiKeyEnc; // legacy default-recipient fields removed
      await setCfg(next);
      return res.status(200).json({ config: pub(next) });
    }

    if (req.method === 'POST') {
      const cfg = await getCfg();
      if (!cfg.enabled) return res.status(400).json({ error: 'WhatsApp alerts are disabled' });
      // test goes to the requesting admin's OWN configured WhatsApp (set in their profile)
      const { rows } = await query('SELECT phone, wa_apikey FROM users WHERE id=$1', [a.id]);
      const u = rows[0];
      if (!u || !u.phone || !u.wa_apikey) return res.status(400).json({ error: 'Add your WhatsApp number + CallMeBot key in your Profile first' });
      const message = (req.body && req.body.message) || '🎉 Congratulations! You are now set up to receive LNO Control Center alerts on WhatsApp. ✅';
      const r = await sendCallMeBot(u.phone, decrypt(u.wa_apikey), message);
      return res.status(r.ok ? 200 : 502).json(r);
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
