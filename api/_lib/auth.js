// Password hashing (bcrypt) + stateless JWT auth. Secrets from env only.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

function jwtSecret() {
  const s = process.env.JWT_SECRET || '';
  if (!s || s.length < 16) throw new Error('JWT_SECRET must be set (>= 16 chars)');
  return s;
}

// Password policy (shareholder accounts created by an admin). Returns the list of
// unmet requirements — empty array means the password is valid.
export function passwordIssues(pw) {
  pw = String(pw || '');
  const issues = [];
  if (pw.length < 12) issues.push('at least 12 characters');
  if (!/[A-Z]/.test(pw)) issues.push('an uppercase letter');
  if (!/[a-z]/.test(pw)) issues.push('a lowercase letter');
  if (!/[0-9]/.test(pw)) issues.push('a number');
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push('a special character');
  return issues;
}

export async function hashPassword(pw) { return bcrypt.hash(String(pw), 10); }
export async function verifyPassword(pw, hash) {
  if (!hash) return false;
  try { return await bcrypt.compare(String(pw), hash); } catch { return false; }
}

export function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret(), { expiresIn: '12h' });
}
export function verifyToken(token) {
  try { return jwt.verify(token, jwtSecret()); } catch { return null; }
}

export function getAuth(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || '';
  const m = String(h).match(/^Bearer (.+)$/);
  return m ? verifyToken(m[1]) : null;
}
export function requireAuth(req, res) {
  const a = getAuth(req);
  if (!a) { res.status(401).json({ error: 'unauthorized' }); return null; }
  return a;
}
export function requireAdmin(req, res) {
  const a = requireAuth(req, res);
  if (!a) return null;
  if (a.role !== 'admin') { res.status(403).json({ error: 'forbidden' }); return null; }
  return a;
}

// Best-effort client IP (Vercel sets x-forwarded-for; falls back to the socket).
export function clientIp(req) {
  const xff = req.headers?.['x-forwarded-for'] || req.headers?.['X-Forwarded-For'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers?.['x-real-ip'] || (req.socket && req.socket.remoteAddress) || null;
}

// Strip sensitive fields before sending a user to the client.
export function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id, username: row.username, email: row.email,
    firstName: row.first_name || '', lastName: row.last_name || '',
    role: row.role, active: row.active,
    permissions: row.permissions || [],
    avatar: row.avatar || null, phone: row.phone || '', notify: !!row.notify,
    authProvider: row.auth_provider || 'password',
    lastLoginAt: row.last_login_at || null, lastIp: row.last_ip || null, lastSeenAt: row.last_seen_at || null,
  };
}
