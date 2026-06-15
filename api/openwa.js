// OpenWA (open-wa.org) integration + alert rules (admin only).
//   GET  -> config (NEVER the raw api key: only masked + hasApiKey)
//   PUT  -> update apiUrl / defaultSender / enabled / apiKey + alert rules
//   POST -> {action:'send'|'test', to?, message?}  send a WhatsApp message
import { query } from './_lib/db.js';
import { requireAdmin } from './_lib/auth.js';
import { encrypt, decrypt, mask } from './_lib/crypto.js';
import { sendOpenWA } from './_lib/notify.js';

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
    apiUrl: cfg.apiUrl || '', defaultSender: cfg.defaultSender || '', enabled: !!cfg.enabled,
    hasApiKey: !!cfg.apiKeyEnc, apiKeyMasked: cfg.apiKeyEnc ? mask(decrypt(cfg.apiKeyEnc)) : '',
    drawdownPct: cfg.drawdownPct ?? 10, pnlDayThreshold: cfg.pnlDayThreshold ?? -5000,
    dailyReport: cfg.dailyReport ?? true,
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
        apiUrl: body.apiUrl ?? cfg.apiUrl ?? '',
        defaultSender: body.defaultSender ?? cfg.defaultSender ?? '',
        enabled: body.enabled ?? cfg.enabled ?? false,
        drawdownPct: body.drawdownPct ?? cfg.drawdownPct ?? 10,
        pnlDayThreshold: body.pnlDayThreshold ?? cfg.pnlDayThreshold ?? -5000,
        dailyReport: body.dailyReport ?? cfg.dailyReport ?? true,
      };
      if (typeof body.apiKey === 'string' && body.apiKey !== '') next.apiKeyEnc = encrypt(body.apiKey);
      await setCfg(next);
      return res.status(200).json({ config: pub(next) });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const cfg = await getCfg();
      if (!cfg.enabled) return res.status(400).json({ error: 'OpenWA is disabled' });
      if (!cfg.apiUrl) return res.status(400).json({ error: 'OpenWA API URL is not configured' });
      const to = body.to || cfg.defaultSender;
      if (!to) return res.status(400).json({ error: 'No recipient phone number' });
      const message = body.message || 'LNO Control Center — OpenWA test message ✅';
      const r = await sendOpenWA(cfg, to, message);
      return res.status(r.ok ? 200 : 502).json(r);
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
