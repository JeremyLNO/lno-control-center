// AES-256-GCM encryption for secrets at rest (exchange secrets, OpenWA api key).
// The key comes ONLY from the APP_ENCRYPTION_KEY env var (64 hex chars = 32 bytes) —
// never hard-coded. Stored blobs are "v1:" + base64(iv|tag|ciphertext).
import crypto from 'node:crypto';

function getKey() {
  const k = process.env.APP_ENCRYPTION_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error('APP_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes)');
  }
  return Buffer.from(k, 'hex');
}

export function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return 'v1:' + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(blob) {
  if (!blob) return null;
  const raw = Buffer.from(String(blob).replace(/^v1:/, ''), 'base64');
  const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), enc = raw.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// Masked preview for display (never reveals the secret).
export function mask(plain) {
  if (!plain) return '';
  const s = String(plain);
  return s.length <= 6 ? '••••••' : s.slice(0, 3) + '••••••' + s.slice(-3);
}
