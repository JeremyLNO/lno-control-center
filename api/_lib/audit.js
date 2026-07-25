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

// Read audit entries, newest first — paged 50-at-a-time by the Audit Log page, with
// optional server-side filters so paging stays correct while a filter is active:
//   action : exact action key ('user.create', 'rules.update', …)
//   q      : free text over actor email / target / action
//   date   : YYYY-MM-DD, that calendar day only
// Returns { total, entries } — total is the full matching count, ignoring limit/offset.
export async function recentAudit({ limit = 50, offset = 0, action = null, q = null, date = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const where = []; const params = [];
  if (action) { params.push(action); where.push(`action=$${params.length}`); }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { params.push(date); where.push(`created_at::date=$${params.length}::date`); }
  if (q) { params.push('%' + q + '%'); const p = params.length; where.push(`(actor_email ILIKE $${p} OR target ILIKE $${p} OR action ILIKE $${p})`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await query(`SELECT count(*)::int AS n FROM audit_log ${whereSql}`, params)).rows[0]?.n || 0;
  const qp = [...params, lim, off];
  const { rows } = await query(
    `SELECT id, actor_id, actor_email, action, target, detail, ip, created_at FROM audit_log
     ${whereSql} ORDER BY created_at DESC LIMIT $${qp.length - 1} OFFSET $${qp.length}`, qp
  );
  return { total, entries: rows.map(r => ({
    id: Number(r.id), actorId: r.actor_id, actorEmail: r.actor_email,
    action: r.action, target: r.target, detail: r.detail, ip: r.ip, createdAt: r.created_at,
  })) };
}

// Distinct action keys present in the log — populates the Audit Log page's filter dropdown
// from real data rather than a hardcoded list that could drift as new actions are audited.
export async function auditActions() {
  try {
    const { rows } = await query('SELECT DISTINCT action FROM audit_log ORDER BY action ASC');
    return rows.map(r => r.action).filter(Boolean);
  } catch (e) { return []; }
}
