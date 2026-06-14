// Password hashing (bcrypt) + stateless JWT auth. Secrets from env only.
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

function jwtSecret() {
  const s = process.env.JWT_SECRET || '';
  if (!s || s.length < 16) throw new Error('JWT_SECRET must be set (>= 16 chars)');
  return s;
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

// Strip sensitive fields before sending a user to the client.
export function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id, username: row.username, email: row.email,
    firstName: row.first_name || '', lastName: row.last_name || '',
    role: row.role, active: row.active,
    permissions: row.permissions || [],
    avatar: row.avatar || null, phone: row.phone || '', notify: !!row.notify,
  };
}
