// Strategy playbook: the declared intent behind each bot, and the version history of that
// intent.
//
// Everything else in this system is observed (positions, fills, income — what the exchange
// reports). A playbook is the opposite: it is what the desk SAYS a bot should do, on which
// assets and timeframes, within which risk limits, and what it is expected to deliver. That
// declaration is what turns a raw result into a judgement — "profit factor 0.8" only means
// something against an expected 1.4.
//
// Versions exist so a result can be tied to the code that produced it. A strategy edited in
// place would silently rewrite the meaning of every past trade.
import { query } from './db.js';

const slug = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'strategy';

export const pubStrategy = (r) => ({
  id: r.id, botId: r.bot_id || null, name: r.name,
  objective: r.objective || '', entryRules: r.entry_rules || '', exitRules: r.exit_rules || '',
  allowedSymbols: r.allowed_symbols || [], allowedTimeframes: r.allowed_timeframes || [],
  riskLimits: r.risk_limits || {}, params: r.params || {},
  disableConditions: r.disable_conditions || '', expectedKpis: r.expected_kpis || {},
  status: r.status, createdAt: r.created_at, updatedAt: r.updated_at,
});

export const pubVersion = (r) => ({
  id: Number(r.id), strategyId: r.strategy_id, label: r.label,
  deployedAt: r.deployed_at, retiredAt: r.retired_at || null,
  changes: r.changes || '', params: r.params || {}, createdBy: r.created_by || null,
});

// Fields an operator can set. Listed explicitly rather than spreading the request body, so a
// client can never write id/created_at or invent a column.
const TEXT_FIELDS = { name: 'name', objective: 'objective', entryRules: 'entry_rules', exitRules: 'exit_rules', disableConditions: 'disable_conditions', status: 'status' };
const JSON_FIELDS = { allowedSymbols: 'allowed_symbols', allowedTimeframes: 'allowed_timeframes', riskLimits: 'risk_limits', params: 'params', expectedKpis: 'expected_kpis' };

export async function createStrategy(body = {}) {
  const name = String(body.name || '').trim();
  if (!name) throw new Error('name required');
  // Slug-based id keeps URLs and audit entries readable; a numeric suffix resolves collisions.
  let id = slug(name);
  const taken = await query('SELECT id FROM strategies WHERE id LIKE $1', [id + '%']);
  if (taken.rows.some(r => r.id === id)) id = `${id}-${taken.rows.length + 1}`;
  await query(
    `INSERT INTO strategies (id,bot_id,name,objective,entry_rules,exit_rules,allowed_symbols,allowed_timeframes,
       risk_limits,params,disable_conditions,expected_kpis,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb,'active')`,
    [id, body.botId || null, name, body.objective || '', body.entryRules || '', body.exitRules || '',
     JSON.stringify(body.allowedSymbols || []), JSON.stringify(body.allowedTimeframes || []),
     JSON.stringify(body.riskLimits || {}), JSON.stringify(body.params || {}),
     body.disableConditions || '', JSON.stringify(body.expectedKpis || {})]
  );
  return (await query('SELECT * FROM strategies WHERE id=$1', [id])).rows[0];
}

export async function updateStrategy(id, body = {}) {
  const sets = [], params = [id];
  for (const [k, col] of Object.entries(TEXT_FIELDS)) {
    if (body[k] !== undefined) { params.push(String(body[k])); sets.push(`${col}=$${params.length}`); }
  }
  for (const [k, col] of Object.entries(JSON_FIELDS)) {
    if (body[k] !== undefined) { params.push(JSON.stringify(body[k])); sets.push(`${col}=$${params.length}::jsonb`); }
  }
  if (body.botId !== undefined) { params.push(body.botId || null); sets.push(`bot_id=$${params.length}`); }
  if (!sets.length) return (await query('SELECT * FROM strategies WHERE id=$1', [id])).rows[0];
  sets.push('updated_at=now()');
  await query(`UPDATE strategies SET ${sets.join(',')} WHERE id=$1`, params);
  return (await query('SELECT * FROM strategies WHERE id=$1', [id])).rows[0];
}

// Rebuild a strategy's whole version timeline so the windows tile the axis exactly: each
// version is retired at the moment the next one is deployed, and only the newest stays open.
//
// Recomputed from scratch rather than patched incrementally, because a version can be
// inserted ANYWHERE — an operator backdating a deployment they forgot to record drops a new
// version before, or between, existing ones. Only closing "the currently-open version" would
// leave the backdated one running forever, overlapping every version after it; attribution
// then matches several versions per trade and Postgres picks one arbitrarily.
async function resealTimeline(strategyId) {
  const { rows } = await query(
    'SELECT id, deployed_at FROM strategy_versions WHERE strategy_id=$1 ORDER BY deployed_at ASC, id ASC',
    [strategyId]
  );
  for (let i = 0; i < rows.length; i++) {
    const nextStart = i + 1 < rows.length ? rows[i + 1].deployed_at : null;
    await query('UPDATE strategy_versions SET retired_at=$2 WHERE id=$1', [rows[i].id, nextStart]);
  }
}

export async function deployVersion(strategyId, { label, changes, params, at, by } = {}) {
  const lab = String(label || '').trim();
  if (!lab) throw new Error('label required');
  const s = await query('SELECT 1 FROM strategies WHERE id=$1', [strategyId]);
  if (!s.rows[0]) throw new Error('strategy not found');
  // `at` lets an operator backdate a deployment they forgot to record — resealTimeline() and
  // the attribution pass below then move historical trades onto the corrected timeline.
  const when = at ? new Date(at) : new Date();
  const { rows } = await query(
    `INSERT INTO strategy_versions (strategy_id,label,deployed_at,changes,params,created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
    [strategyId, lab, when, changes || '', JSON.stringify(params || {}), by || null]
  );
  await resealTimeline(strategyId);
  await attributeTrades();
  return (await query('SELECT * FROM strategy_versions WHERE id=$1', [rows[0].id])).rows[0];
}

// Re-point every trade at the version that was live when it opened.
//
// Runs in full rather than incrementally: it is a single indexed UPDATE over a table of
// thousands of rows, and a backdated or corrected deployment has to be able to move history.
// Trades whose bot has no strategy, or that predate the first declared version, are cleared
// back to NULL so a stale attribution can never survive a correction.
export async function attributeTrades() {
  await query(`UPDATE trades SET strategy_id=NULL, strategy_version_id=NULL
               WHERE strategy_id IS NOT NULL OR strategy_version_id IS NOT NULL`);
  const { rowCount } = await query(`
    UPDATE trades t SET strategy_id=s.id, strategy_version_id=v.id
    FROM strategies s
    JOIN strategy_versions v ON v.strategy_id = s.id
    WHERE s.bot_id = t.exchange || ':' || t.symbol
      AND t.opened_at >= v.deployed_at
      AND (v.retired_at IS NULL OR t.opened_at < v.retired_at)`);
  return { attributed: rowCount || 0 };
}

// A strategy with its version timeline and the realised result of each version. Per-version
// KPIs come from the same analytics module every other surface uses, so the playbook's
// "actual" column and the Analysis page can't disagree.
export async function getPlaybook(strategyId = null) {
  const { rows: strategies } = strategyId
    ? await query('SELECT * FROM strategies WHERE id=$1', [strategyId])
    : await query('SELECT * FROM strategies ORDER BY name ASC');
  if (!strategies.length) return { strategies: [] };

  const { computeKpis } = await import('./analytics.js');
  const out = [];
  for (const s of strategies) {
    const { rows: versions } = await query('SELECT * FROM strategy_versions WHERE strategy_id=$1 ORDER BY deployed_at DESC', [s.id]);
    // ORDER BY is not cosmetic here: max drawdown is peak-to-trough of the CUMULATIVE net
    // curve, so it depends entirely on the sequence the trades are folded in. Without an
    // explicit order the database is free to return rows in whatever order it likes — and it
    // does change after updates — which made the same unchanged data report a different
    // drawdown between two page loads.
    const { rows: trades } = await query(
      `SELECT strategy_version_id, net_pnl, gross_pnl, commission, funding, closed_at, duration_s
       FROM trades WHERE strategy_id=$1 ORDER BY COALESCE(closed_at, opened_at) ASC`, [s.id]
    );
    const norm = trades.map(t => ({ ...t, net_pnl: Number(t.net_pnl), gross_pnl: Number(t.gross_pnl), commission: Number(t.commission), funding: Number(t.funding), duration_s: t.duration_s == null ? null : Number(t.duration_s) }));
    out.push({
      ...pubStrategy(s),
      overall: computeKpis(norm),
      versions: versions.map(v => ({
        ...pubVersion(v),
        actual: computeKpis(norm.filter(t => Number(t.strategy_version_id) === Number(v.id))),
      })),
    });
  }
  return { strategies: out };
}

// Compare a strategy's realised KPIs against the ones it declared it would deliver.
// Only KPIs the operator actually declared are judged — an empty expectation is not a failure,
// and a missing measurement (no closed trade yet) is reported as such rather than as a breach.
const KPI_RULES = {
  minProfitFactor: { kpi: 'profitFactor', cmp: (a, e) => a >= e },
  minWinRate:      { kpi: 'winRate',      cmp: (a, e) => a >= e },
  minExpectancy:   { kpi: 'expectancy',   cmp: (a, e) => a >= e },
  maxDrawdown:     { kpi: 'maxDrawdown',  cmp: (a, e) => a >= -Math.abs(e) },
};

export function evaluateExpectations(expected = {}, actual = {}) {
  const out = [];
  for (const [key, rule] of Object.entries(KPI_RULES)) {
    const target = expected[key];
    if (target == null || target === '') continue;
    const value = actual[rule.kpi];
    out.push({
      key, kpi: rule.kpi, target: Number(target),
      value: value == null ? null : Number(value),
      status: value == null ? 'unknown' : (rule.cmp(Number(value), Number(target)) ? 'met' : 'missed'),
    });
  }
  return out;
}
