// Role-based permissions (see api/rules.js). Permissions are no longer granted per-user —
// every account of a given role has exactly that role's permissions, admin-editable on the
// Rules page and stored in app_config (same pattern as the WhatsApp notifMatrix). Admins
// always have every permission; that row is never persisted or editable.
import { query } from './db.js';
import { sanitizeUser } from './auth.js';
import { PERMISSIONS, ROLE_PERMS as DEFAULT_ROLE_PERMS } from './constants.js';

const EDITABLE_ROLES = Object.keys(DEFAULT_ROLE_PERMS).filter(r => r !== 'admin');

// Short in-memory cache — role permissions change rarely, and this avoids a round trip to
// app_config on every request in a warm serverless instance. Busted immediately on write.
let _cache = null, _cacheAt = 0;
const TTL_MS = 15000;

export async function getRolePerms() {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < TTL_MS) return _cache;
  let stored = {};
  try {
    const { rows } = await query(`SELECT value FROM app_config WHERE key='rolePerms'`);
    stored = rows[0] ? rows[0].value : {};
  } catch (e) { /* first run before app_config exists yet — fall back to defaults below */ }
  const out = { admin: PERMISSIONS.slice() };
  for (const role of EDITABLE_ROLES) {
    const saved = Array.isArray(stored[role]) ? stored[role].filter(p => PERMISSIONS.includes(p)) : null;
    out[role] = saved || DEFAULT_ROLE_PERMS[role].slice();
  }
  _cache = out; _cacheAt = now;
  return out;
}

export async function setRolePerms(next) {
  const clean = {};
  for (const role of EDITABLE_ROLES) {
    clean[role] = Array.isArray(next?.[role]) ? [...new Set(next[role].filter(p => PERMISSIONS.includes(p)))] : [];
  }
  await query(`INSERT INTO app_config (key,value) VALUES ('rolePerms',$1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`, [JSON.stringify(clean)]);
  _cache = null;
  return getRolePerms();
}

export async function permsForRole(role) {
  const map = await getRolePerms();
  return map[role] || [];
}

export async function sanitizeUserWithPerms(row) {
  const base = sanitizeUser(row);
  if (!base) return base;
  base.permissions = await permsForRole(base.role);
  return base;
}
