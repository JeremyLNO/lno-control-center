// Setup + maintenance.
//   POST                 -> create tables + seed defaults (idempotent; guarded by SETUP_TOKEN)
//   POST {action:'reset'} -> wipe all trading/demo data, KEEP user accounts + config (admin)
import { migrate, seedIfEmpty } from './_lib/schema.js';
import { requireAdmin } from './_lib/auth.js';
import { query } from './_lib/db.js';

// tables cleared by a reset (users + app_config are kept)
const RESET_TABLES = ['bots', 'funds', 'exchanges', 'equity_snapshots', 'alerts', 'reports', 'wa_log', 'login_events'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    if (req.body?.action === 'reset') {
      const a = requireAdmin(req, res); if (!a) return;
      await migrate(); // make sure the tables exist before clearing
      for (const t of RESET_TABLES) await query(`DELETE FROM ${t}`);
      await query("DELETE FROM app_config WHERE key='live'"); // drop the cached live-equity snapshot
      return res.status(200).json({ ok: true, reset: true, cleared: RESET_TABLES });
    }
    const need = process.env.SETUP_TOKEN;
    if (need && req.headers['x-setup-token'] !== need) return res.status(403).json({ error: 'forbidden' });
    await migrate();
    const r = await seedIfEmpty();
    res.status(200).json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
