// Exchange connections (admin only). API secrets are AES-GCM encrypted at rest and
// NEVER returned to the client — only a masked preview + hasSecret flag.
import { query } from './_lib/db.js';
import { requireAdmin } from './_lib/auth.js';
import { encrypt, decrypt, mask } from './_lib/crypto.js';

function pub(r) {
  return {
    id: r.id, name: r.name, label: r.label, apiKey: r.api_key,
    status: r.status, lastSync: r.last_sync ? Number(r.last_sync) : null, note: r.note || '',
    lastError: r.last_error || null,
    hasSecret: !!r.api_secret_enc,
    secretMasked: r.api_secret_enc ? mask(decrypt(r.api_secret_enc)) : '',
  };
}

export default async function handler(req, res) {
  const a = requireAdmin(req, res); if (!a) return;
  try {
    if (req.method === 'GET') {
      const { rows } = await query('SELECT * FROM exchanges ORDER BY id ASC');
      return res.status(200).json({ exchanges: rows.map(pub) });
    }
    const body = req.body || {};

    if (req.method === 'POST') {
      const id = 'e' + Date.now();
      await query('INSERT INTO exchanges (id,name,label,api_key,api_secret_enc,status,note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [id, body.name || '', body.label || '', body.apiKey || '', body.apiSecret ? encrypt(body.apiSecret) : null, 'pending', body.note || '']);
      const { rows } = await query('SELECT * FROM exchanges WHERE id=$1', [id]);
      return res.status(201).json({ exchange: pub(rows[0]) });
    }

    if (req.method === 'PATCH') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const m = { name: 'name', label: 'label', apiKey: 'api_key', note: 'note', status: 'status' };
      const sets = [], vals = []; let i = 1;
      for (const k of Object.keys(m)) { if (k in body) { sets.push(`${m[k]}=$${i}`); vals.push(body[k]); i++; } }
      if (body.apiSecret) { sets.push(`api_secret_enc=$${i}`); vals.push(encrypt(body.apiSecret)); i++; } // re-encrypt only when provided
      if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
      vals.push(id);
      await query(`UPDATE exchanges SET ${sets.join(',')} WHERE id=$${i}`, vals);
      const { rows } = await query('SELECT * FROM exchanges WHERE id=$1', [id]);
      return res.status(200).json({ exchange: pub(rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = body.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      await query('DELETE FROM exchanges WHERE id=$1', [id]);
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
