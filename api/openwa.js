// WhatsApp alerts (CallMeBot) config + alert rules (admin only).
//   GET  -> config (NEVER the raw api key: only masked + hasApiKey)
//   PUT  -> update default recipient phone / api key / enabled + thresholds + alert rules
//   POST -> {action:'test', message?}  send a test WhatsApp message to the default recipient
// (config key stays 'openwa' for continuity; the provider is now CallMeBot)
import { query } from './_lib/db.js';
import { requireAdmin } from './_lib/auth.js';
import { encrypt, decrypt, mask } from './_lib/crypto.js';
import { sendCallMeBot } from './_lib/notify.js';

async function getCfg() {
  const { rows } = await query(`SELECT value FROM app_config WHERE key='openwa'`);
  return rows[0] ? rows[0].value : {};
}
async function setCfg(v) {
  await query(`INSERT INTO app_config (key,value) VALUES ('openwa',$1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`, [JSON.stringify(v)]);
}
function pub(cfg) {
  return {
    defaultSender: cfg.defaultSender || '', enabled: !!cfg.enabled,
    hasApiKey: !!cfg.apiKeyEnc, apiKeyMasked: cfg.apiKeyEnc ? mask(decrypt(cfg.apiKeyEnc)) : '',
    drawdownPct: cfg.drawdownPct ?? 10, pnlDayThreshold: cfg.pnlDayThreshold ?? -5000,
    dailyReport: cfg.dailyReport ?? true,
    alertRules: Array.isArray(cfg.alertRules) ? cfg.alertRules : [],
  };
}

export default async function handler(req, res) {
  const a = requireAdmin(req, res); if (!a) return;
  try {
    if (req.method === 'GET') return res.status(200).json({ config: pub(await getCfg()) });

    if (req.method === 'PUT') {
      const body = req.body || {};
      const cfg = await getCfg();
      const next = {
        ...cfg,
        defaultSender: body.defaultSender ?? cfg.defaultSender ?? '',
        enabled: body.enabled ?? cfg.enabled ?? false,
        drawdownPct: body.drawdownPct ?? cfg.drawdownPct ?? 10,
        pnlDayThreshold: body.pnlDayThreshold ?? cfg.pnlDayThreshold ?? -5000,
        dailyReport: body.dailyReport ?? cfg.dailyReport ?? true,
        alertRules: Array.isArray(body.alertRules) ? body.alertRules : (cfg.alertRules || []),
      };
      if (typeof body.apiKey === 'string' && body.apiKey !== '') next.apiKeyEnc = encrypt(body.apiKey);
      await setCfg(next);
      return res.status(200).json({ config: pub(next) });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const cfg = await getCfg();
      if (!cfg.enabled) return res.status(400).json({ error: 'WhatsApp alerts are disabled' });
      if (!cfg.defaultSender) return res.status(400).json({ error: 'No recipient phone number configured' });
      if (!cfg.apiKeyEnc) return res.status(400).json({ error: 'No CallMeBot API key configured' });
      const message = body.message || '🎉 Congratulations! You are now set up to receive LNO Control Center alerts on WhatsApp. ✅';
      const r = await sendCallMeBot(cfg.defaultSender, decrypt(cfg.apiKeyEnc), message);
      return res.status(r.ok ? 200 : 502).json(r);
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
