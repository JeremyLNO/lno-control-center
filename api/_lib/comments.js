// Internal discussion, incident review, and @mentions.
//
// Everything else in this system is machine-produced: positions synced, trades reconstructed,
// anomalies detected. This is the one place people write. It exists because the analysis is
// only half the work — "SOLUSDT lost 400 on Tuesday" is a fact, "we widened the stop after the
// August incident and never re-tested it" is the reason, and only a person can put that there.
//
// Comments attach to whatever is being discussed via a loose (entity_type, entity_id) pair,
// because the things worth discussing live in different tables and some of them — a calendar
// period, a reconstructed round trip — have synthetic ids no single table owns.
import { query } from './db.js';

export const ENTITY_TYPES = ['position', 'bot', 'anomaly', 'strategy', 'period'];
export const CATEGORIES = ['observation', 'question', 'action', 'incident'];
export const PRIORITIES = ['low', 'medium', 'high'];
export const STATUSES = ['open', 'in_progress', 'resolved'];
export const REVIEW_STATUSES = ['draft', 'in_review', 'validated'];

const one = (list, v, dflt = null) => (list.includes(v) ? v : dflt);

// ---------------------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------------------
// A mention is written as @something. "Something" is matched against the username and against
// the email's local part, because both are how people actually refer to each other here —
// @sophie.ops and @sophie.ops@lno.company should reach the same person.
//
// Matching is done against the ACTUAL user list rather than by validating the shape of the
// handle: an @word that matches nobody is just text, not a broken mention.
const MENTION_RE = /@([A-Za-z0-9._-]{2,64})/g;

export function extractHandles(body) {
  const out = new Set();
  for (const m of String(body || '').matchAll(MENTION_RE)) out.add(m[1].toLowerCase().replace(/[.]+$/, ''));
  return [...out];
}

export async function resolveMentions(body) {
  const handles = extractHandles(body);
  if (!handles.length) return [];
  const { rows } = await query(
    `SELECT id, username, email, first_name, last_name FROM users
     WHERE active AND (lower(username) = ANY($1) OR lower(split_part(email,'@',1)) = ANY($1))`,
    [handles]
  );
  return rows;
}

// ---------------------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------------------
const pubComment = (r) => ({
  id: Number(r.id), entityType: r.entity_type, entityId: r.entity_id,
  parentId: r.parent_id == null ? null : Number(r.parent_id),
  body: r.body, category: r.category || null, priority: r.priority || null,
  assigneeId: r.assignee_id || null, assigneeName: r.assignee_name || null,
  status: r.status, authorId: r.author_id || null, authorName: r.author_name || '',
  createdAt: r.created_at, updatedAt: r.updated_at,
  resolvedAt: r.resolved_at || null, resolvedBy: r.resolved_by || null,
  mentions: r.mentions || [],
});

export async function listComments({ entityType, entityId, assigneeId = null, status = null, limit = 100 }) {
  const w = [], p = [];
  if (entityType) { p.push(entityType); w.push(`c.entity_type=$${p.length}`); }
  if (entityId) { p.push(entityId); w.push(`c.entity_id=$${p.length}`); }
  if (assigneeId) { p.push(assigneeId); w.push(`c.assignee_id=$${p.length}`); }
  if (status) { p.push(status); w.push(`c.status=$${p.length}`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  p.push(Math.min(limit, 500));
  const { rows } = await query(
    `SELECT c.*,
            trim(coalesce(u.first_name,'') || ' ' || coalesce(u.last_name,'')) AS assignee_full,
            u.username AS assignee_username,
            coalesce(
              (SELECT json_agg(json_build_object('userId', m.user_id, 'username', mu.username))
                 FROM mentions m JOIN users mu ON mu.id = m.user_id WHERE m.comment_id = c.id),
              '[]'::json) AS mentions
     FROM comments c
     LEFT JOIN users u ON u.id = c.assignee_id
     ${where}
     ORDER BY c.created_at ASC LIMIT $${p.length}`, p
  );
  return rows.map(r => pubComment({ ...r, assignee_name: (r.assignee_full || '').trim() || r.assignee_username || null }));
}

export async function createComment({ entityType, entityId, body, category, priority, assigneeId, parentId, author }) {
  const text = String(body || '').trim();
  if (!text) throw new Error('body required');
  if (!ENTITY_TYPES.includes(entityType)) throw new Error('unknown entity type');
  if (!entityId) throw new Error('entityId required');

  const { rows } = await query(
    `INSERT INTO comments (entity_type, entity_id, parent_id, body, category, priority, assignee_id, author_id, author_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [entityType, entityId, parentId || null, text,
     one(CATEGORIES, category, 'observation'), one(PRIORITIES, priority),
     assigneeId || null, author?.id || null, author?.name || author?.username || '']
  );
  const id = Number(rows[0].id);

  // Mentions are recorded, then notified. The author is skipped: being told you mentioned
  // yourself is noise, and it happens constantly when someone quotes their own handle.
  const mentioned = (await resolveMentions(text)).filter(u => u.id !== author?.id);
  for (const u of mentioned) {
    await query('INSERT INTO mentions (comment_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, u.id]);
  }
  return { id, mentioned };
}

export async function updateComment(id, patch = {}, actor) {
  const sets = [], p = [id];
  const push = (col, val) => { p.push(val); sets.push(`${col}=$${p.length}`); };
  if (patch.body !== undefined) push('body', String(patch.body));
  if (patch.category !== undefined) push('category', one(CATEGORIES, patch.category));
  if (patch.priority !== undefined) push('priority', one(PRIORITIES, patch.priority));
  if (patch.assigneeId !== undefined) push('assignee_id', patch.assigneeId || null);
  if (patch.status !== undefined) {
    const st = one(STATUSES, patch.status, 'open');
    push('status', st);
    // Resolution is stamped here rather than trusted from the client, so "who closed this and
    // when" is always the server's answer.
    if (st === 'resolved') { push('resolved_at', new Date()); push('resolved_by', actor?.username || actor?.id || null); }
    else { push('resolved_at', null); push('resolved_by', null); }
  }
  if (!sets.length) return null;
  sets.push('updated_at=now()');
  await query(`UPDATE comments SET ${sets.join(',')} WHERE id=$1`, p);

  // Editing a comment can introduce a mention that was not there before.
  if (patch.body !== undefined) {
    const mentioned = (await resolveMentions(patch.body)).filter(u => u.id !== actor?.id);
    for (const u of mentioned) {
      await query('INSERT INTO mentions (comment_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, u.id]);
    }
    return { mentioned };
  }
  return { mentioned: [] };
}

export async function deleteComment(id) {
  await query('DELETE FROM comments WHERE id=$1', [id]);
  return { ok: true };
}

// ---------------------------------------------------------------------------------------
// Mentions inbox
// ---------------------------------------------------------------------------------------
// Returns enough to render a notification AND to link straight to the comment: the entity it
// hangs off is what the deep link is built from, so a mention is one click from its context.
export async function listMentions(userId, { unreadOnly = true, limit = 30 } = {}) {
  const { rows } = await query(
    `SELECT m.id, m.read_at, m.created_at, c.id AS comment_id, c.entity_type, c.entity_id,
            c.body, c.author_name
     FROM mentions m JOIN comments c ON c.id = m.comment_id
     WHERE m.user_id = $1 ${unreadOnly ? 'AND m.read_at IS NULL' : ''}
     ORDER BY m.created_at DESC LIMIT $2`, [userId, Math.min(limit, 100)]
  );
  return rows.map(r => ({
    id: Number(r.id), commentId: Number(r.comment_id),
    entityType: r.entity_type, entityId: r.entity_id,
    // Trimmed for the dropdown; the full text is one click away.
    excerpt: String(r.body).slice(0, 140),
    authorName: r.author_name || '', createdAt: r.created_at, readAt: r.read_at || null,
  }));
}

export async function markMentionsRead(userId, ids = null) {
  if (Array.isArray(ids) && ids.length) {
    await query('UPDATE mentions SET read_at=now() WHERE user_id=$1 AND id = ANY($2) AND read_at IS NULL', [userId, ids.map(Number)]);
  } else {
    await query('UPDATE mentions SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [userId]);
  }
  const { rows } = await query('SELECT count(*)::int AS n FROM mentions WHERE user_id=$1 AND read_at IS NULL', [userId]);
  return { unread: rows[0].n };
}

// ---------------------------------------------------------------------------------------
// Incident review
// ---------------------------------------------------------------------------------------
const pubReview = (r) => ({
  id: Number(r.id), entityType: r.entity_type, entityId: r.entity_id,
  title: r.title, problem: r.problem || '', impact: r.impact || '',
  rootCause: r.root_cause || '', correctiveActions: r.corrective_actions || '',
  severity: r.severity, status: r.status,
  openedBy: r.opened_by || null, openedAt: r.opened_at,
  validatedBy: r.validated_by || null, validatedAt: r.validated_at || null,
});

export async function listReviews({ entityType = null, entityId = null, status = null } = {}) {
  const w = [], p = [];
  if (entityType) { p.push(entityType); w.push(`entity_type=$${p.length}`); }
  if (entityId) { p.push(entityId); w.push(`entity_id=$${p.length}`); }
  if (status) { p.push(status); w.push(`status=$${p.length}`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM incident_reviews ${where} ORDER BY opened_at DESC LIMIT 100`, p);
  return rows.map(pubReview);
}

export async function upsertReview(body = {}, actor) {
  const REVIEW_FIELDS = { title: 'title', problem: 'problem', impact: 'impact', rootCause: 'root_cause', correctiveActions: 'corrective_actions' };
  if (body.id) {
    const sets = [], p = [body.id];
    for (const [k, col] of Object.entries(REVIEW_FIELDS)) {
      if (body[k] !== undefined) { p.push(String(body[k])); sets.push(`${col}=$${p.length}`); }
    }
    if (body.severity !== undefined) { p.push(one(['low', 'medium', 'high', 'critical'], body.severity, 'medium')); sets.push(`severity=$${p.length}`); }
    if (body.status !== undefined) {
      const st = one(REVIEW_STATUSES, body.status, 'draft');
      p.push(st); sets.push(`status=$${p.length}`);
      // Validation is the point of the workflow, so it is recorded server-side and cleared
      // if the review is reopened — a review that went back to draft is not still signed off.
      if (st === 'validated') { p.push(actor?.username || actor?.id || null); sets.push(`validated_by=$${p.length}`); sets.push('validated_at=now()'); }
      else { sets.push('validated_by=NULL'); sets.push('validated_at=NULL'); }
    }
    if (!sets.length) return null;
    sets.push('updated_at=now()');
    await query(`UPDATE incident_reviews SET ${sets.join(',')} WHERE id=$1`, p);
    const { rows } = await query('SELECT * FROM incident_reviews WHERE id=$1', [body.id]);
    return rows[0] ? pubReview(rows[0]) : null;
  }
  if (!ENTITY_TYPES.includes(body.entityType)) throw new Error('unknown entity type');
  if (!String(body.title || '').trim()) throw new Error('title required');
  const { rows } = await query(
    `INSERT INTO incident_reviews (entity_type, entity_id, title, problem, impact, root_cause, corrective_actions, severity, opened_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [body.entityType, body.entityId || '', String(body.title).trim(), body.problem || '', body.impact || '',
     body.rootCause || '', body.correctiveActions || '', one(['low', 'medium', 'high', 'critical'], body.severity, 'medium'),
     actor?.username || actor?.id || null]
  );
  return pubReview(rows[0]);
}

// Deep link back to whatever a comment hangs off. Kept here, next to the entity types it
// switches on, so adding an entity type means touching one file.
export function entityLink(entityType, entityId) {
  const base = 'https://cc.lno.company/#';
  switch (entityType) {
    case 'position': return `${base}/position/${entityId}`;
    case 'anomaly': return `${base}/anomalies`;
    case 'strategy': return `${base}/playbook`;
    case 'bot': return `${base}/trades`;
    case 'period': return `${base}/calendar`;
    default: return base + '/activity';
  }
}
