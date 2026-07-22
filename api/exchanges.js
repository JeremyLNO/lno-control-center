// Exchange connections. Mutations (POST/PATCH/DELETE) are admin only. GET is also open to
// any role granted the 'view_exchanges' permission (shareholders, by default — see
// api/_lib/rolePerms.js) but those callers only ever get the stripped wallet-only view below:
// API keys/secrets are never sent to a non-admin under any permission configuration.
// Secrets are AES-GCM encrypted at rest and NEVER returned to the client — only a masked
// preview + hasSecret flag, and only to admins.
import { query } from './_lib/db.js';
import { requireAdmin, requireAuth } from './_lib/auth.js';
import { encrypt, decrypt, mask } from './_lib/crypto.js';
import { permsForRole } from './_lib/rolePerms.js';
import { audit } from './_lib/audit.js';

function pub(r) {
  return {
    id: r.id, name: r.name, label: r.label, apiKey: r.api_key,
    status: r.status, lastSync: r.last_sync ? Number(r.last_sync) : null, note: r.note || '',
    lastError: r.last_error || null, latencyMs: r.latency_ms ?? null,
    hasSecret: !!r.api_secret_enc,
    secretMasked: r.api_secret_enc ? mask(decrypt(r.api_secret_enc)) : '',
    wallets: Array.isArray(r.wallets) ? r.wallets : [],
  };
}
// Read-only, non-admin view: label + public wallet addresses only — no keys, no status.
function pubReadOnly(r) {
  return { id: r.id, name: r.name, label: r.label, wallets: Array.isArray(r.wallets) ? r.wallets : [] };
}
// Public deposit addresses (not secret) — keep only {network,address} pairs, drop empty rows.
function cleanWallets(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(w => w && (w.network || w.address))
    .map(w => ({ network: String(w.network || '').slice(0, 60), address: String(w.address || '').slice(0, 200) }));
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const a = requireAuth(req, res); if (!a) return;
    const isAdmin = a.role === 'admin';
    if (!isAdmin && !(await permsForRole(a.role)).includes('view_exchanges')) return res.status(403).json({ error: 'forbidden' });
    try {
      const { rows } = await query('SELECT * FROM exchanges ORDER BY id ASC');
      return res.status(200).json({ exchanges: rows.map(isAdmin ? pub : pubReadOnly) });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }
  const a = requireAdmin(req, res); if (!a) return;
  try {
    const body = req.body || {};

    if (req.method === 'POST') {
      const id = 'e' + Date.now();
      await query('INSERT INTO exchanges (id,name,label,api_key,api_secret_enc,status,note,wallets) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',
        [id, body.name || '', body.label || '', body.apiKey || '', body.apiSecret ? encrypt(body.apiSecret) : null, 'pending', body.note || '', JSON.stringify(cleanWallets(body.wallets))]);
      await audit(req, a, 'exchange.create', id, { name: body.name || '', hasSecret: !!body.apiSecret });
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
      if (Array.isArray(body.wallets)) { sets.push(`wallets=$${i}::jsonb`); vals.push(JSON.stringify(cleanWallets(body.wallets))); i++; }
      if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
      vals.push(id);
      await query(`UPDATE exchanges SET ${sets.join(',')} WHERE id=$${i}`, vals);
      await audit(req, a, 'exchange.update', id, { fields: Object.keys(body).filter(k => k !== 'id'), secretChanged: !!body.apiSecret });
      const { rows } = await query('SELECT * FROM exchanges WHERE id=$1', [id]);
      return res.status(200).json({ exchange: pub(rows[0]) });
    }

    if (req.method === 'DELETE') {
      const id = body.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      await query('DELETE FROM exchanges WHERE id=$1', [id]);
      await audit(req, a, 'exchange.delete', id, {});
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
