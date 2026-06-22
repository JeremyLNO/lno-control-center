// Admin-action audit trail. Records sensitive mutations to audit_log.
// Best-effort: never throws and never blocks the underlying action.
import { query } from './db.js';
import { clientIp } from './auth.js';

export async function audit(req, actor, action, target, detail = {}) {
  try {
    await query(
      'INSERT INTO audit_log (actor_id, actor_email, action, target, detail, ip) VALUES ($1,$2,$3,$4,$5::jsonb,$6)',
      [actor?.id || null, actor?.username || actor?.email || null, action, target || null, JSON.stringify(detail || {}), clientIp(req)]
    );
  } catch (e) { /* auditing must never break the action it records */ }
}

// Read recent audit entries (admin view).
export async function recentAudit(limit = 100) {
  const { rows } = await query(
    'SELECT id, actor_id, actor_email, action, target, detail, ip, created_at FROM audit_log ORDER BY created_at DESC LIMIT $1',
    [Math.min(Number(limit) || 100, 500)]
  );
  return rows.map(r => ({
    id: Number(r.id), actorId: r.actor_id, actorEmail: r.actor_email,
    action: r.action, target: r.target, detail: r.detail, ip: r.ip, createdAt: r.created_at,
  }));
}
