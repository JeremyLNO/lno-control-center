// Inbound webhook: a WhatsApp reply containing "ACK [code]" acknowledges an alert.
// NOTE: TextMeBot inbound isn't wired up, so this is currently unused — alerts are
// acknowledged from the UI (the header bell). Kept for a future inbound-capable provider.
import { query } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.query?.key !== secret) return res.status(403).json({ error: 'forbidden' });
  try {
    const body = req.body || {};
    const m = body.data || body.message || body;
    const from = String(m.from || m.author || body.from || '').replace(/[^0-9]/g, '');
    const text = String(m.body || m.content || m.text || body.body || '').trim();
    if (!text || !/ack/i.test(text)) return res.status(200).json({ ok: true, ignored: 'not an ack' });

    const code = (text.toUpperCase().match(/\b([A-Z0-9]{4})\b/) || [])[1];
    let row;
    if (code) {
      row = (await query('UPDATE alerts SET acked_at=now(), acked_by=$1 WHERE code=$2 AND acked_at IS NULL RETURNING code', [from || 'whatsapp', code])).rows[0];
    }
    if (!row) {
      row = (await query(`UPDATE alerts SET acked_at=now(), acked_by=$1
        WHERE id=(SELECT id FROM alerts WHERE acked_at IS NULL ORDER BY created_at DESC LIMIT 1) RETURNING code`, [from || 'whatsapp'])).rows[0];
    }
    if (row) {
      return res.status(200).json({ ok: true, acked: row.code });
    }
    return res.status(200).json({ ok: true, ignored: 'no pending alert' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
