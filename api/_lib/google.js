// Google "Sign in with Google" ID-token verification — JWKS-based, no extra deps
// (reuses jsonwebtoken + node crypto). The browser obtains an ID token from Google
// Identity Services; we verify its signature, audience and issuer here, then trust
// the claims. Sign-in is restricted to the configured Workspace domain.
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const ALLOWED_DOMAIN = (process.env.ALLOWED_EMAIL_DOMAIN || 'lno.company').toLowerCase();
// Public OAuth client ID (not a secret). An env var overrides the baked-in default,
// so it stays configurable per-environment without a code change.
const DEFAULT_CLIENT_ID = '842329765719-vinrm66bckks5vfgq54oj4hb3v6e6r1m.apps.googleusercontent.com';
export function googleClientId() { return process.env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID; }

let _certs = null, _certsExp = 0;
async function googleCerts() {
  if (_certs && Date.now() < _certsExp) return _certs;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('could not fetch Google public keys');
  const { keys } = await r.json();
  const out = {};
  for (const k of keys || []) out[k.kid] = crypto.createPublicKey({ key: k, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
  _certs = out; _certsExp = Date.now() + 3600_000; // keys rotate slowly; 1h cache
  return out;
}

// Returns the verified token payload, or throws. Tests inject globalThis.__GOOGLE_VERIFY__.
export async function verifyGoogleToken(idToken) {
  if (globalThis.__GOOGLE_VERIFY__) return globalThis.__GOOGLE_VERIFY__(idToken);
  const aud = googleClientId();
  if (!aud) throw new Error('Google client id not configured');
  const decoded = jwt.decode(idToken, { complete: true });
  const kid = decoded && decoded.header && decoded.header.kid;
  if (!kid) throw new Error('malformed token');
  const pem = (await googleCerts())[kid];
  if (!pem) throw new Error('unknown signing key');
  return jwt.verify(idToken, pem, { algorithms: ['RS256'], audience: aud, issuer: ['https://accounts.google.com', 'accounts.google.com'] });
}
