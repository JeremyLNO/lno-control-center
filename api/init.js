// One-time setup: create tables + seed defaults (idempotent).
// Guarded by SETUP_TOKEN if set; seeding only runs when the users table is empty.
import { migrate, seedIfEmpty } from './_lib/schema.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const need = process.env.SETUP_TOKEN;
  if (need && req.headers['x-setup-token'] !== need) return res.status(403).json({ error: 'forbidden' });
  try {
    await migrate();
    const r = await seedIfEmpty();
    res.status(200).json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
