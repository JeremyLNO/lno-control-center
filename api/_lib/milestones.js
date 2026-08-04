// Milestones — the desk's scoreboard.
//
// Two scopes, and the difference is the whole point:
//   monthly — measured within the CURRENT calendar month, and reachable again every month.
//   global  — measured over all recorded history, and reached exactly once, ever.
//
// An achievement is a row, not a flag: (milestone, period) with the date it happened. That is
// what makes "reachable again next month" free — next month is simply a different period —
// and what makes the date auditable rather than inferred.
import { query } from './db.js';
import { notify, getUsersByRole, rolesForType } from './notify.js';
import { sendMilestoneEmail } from './mailer.js';

/// The four things a milestone can measure. Kept deliberately small: every entry the desk
/// asked for is one of these, and a metric nobody can compute is a metric nobody can trust.
///   equity_gain  — equity gained over the period, in USDT
///   equity_pct   — equity growth over the period, in %
///   equity_level — absolute equity reached (a level, not a gain)
///   position_pct — best single position's return, in %
export const METRICS = ['equity_gain', 'equity_pct', 'equity_level', 'position_pct'];
export const SCOPES = ['monthly', 'global'];

export const currentPeriod = (scope, now = new Date()) =>
  (scope === 'global' ? 'global' : now.toISOString().slice(0, 7));

/* ------------------------------------------------------------------ seed */

// The desk's starting scoreboard. Ordered as given; `sort` preserves that so the page reads
// like the list it came from rather than like whatever the database felt like returning.
//
// Two deliberate departures from the list as dictated, both flagged to the desk:
//   - the monthly "+50%" appeared twice; a duplicate would fire two identical notifications
//     for one event, so it is seeded once.
//   - the global "+10%" sits between +50% and +500%, which reads like a typo for +100%. It is
//     seeded AS WRITTEN — guessing at intent is worse than an entry an admin can edit in a
//     click, and the page can do exactly that.
const M = (scope, metric, threshold) => ({ scope, metric, threshold });
export const SEED_MILESTONES = [
  ...[10_000, 100_000, 1_000_000, 10_000_000, 20_000_000, 30_000_000, 40_000_000, 50_000_000,
      60_000_000, 70_000_000, 80_000_000, 90_000_000, 100_000_000].map(v => M('monthly', 'equity_gain', v)),
  ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(v => M('monthly', 'equity_pct', v)),
  ...[5, 10, 15, 20].map(v => M('monthly', 'position_pct', v)),

  ...[20, 50, 10, 500, 1000].map(v => M('global', 'equity_pct', v)),
  ...[20_000, 50_000, 100_000, 1_000_000, 2_000_000, 5_000_000].map(v => M('global', 'equity_gain', v)),
  ...[10_000_000, 20_000_000, 30_000_000, 40_000_000, 50_000_000, 60_000_000, 70_000_000,
      80_000_000, 90_000_000, 100_000_000, 200_000_000, 300_000_000, 400_000_000, 500_000_000,
      600_000_000, 700_000_000, 800_000_000, 900_000_000, 1_000_000_000].map(v => M('global', 'equity_level', v)),
];

/// Idempotent: seeds only when the table is empty, so an admin who deletes a milestone does
/// not get it silently resurrected on the next deploy.
export async function seedMilestones() {
  const { rows } = await query('SELECT count(*)::int AS n FROM milestones');
  if (rows[0]?.n) return { seeded: 0 };
  let sort = 0;
  for (const m of SEED_MILESTONES) {
    await query('INSERT INTO milestones (scope,metric,threshold,sort) VALUES ($1,$2,$3,$4)',
      [m.scope, m.metric, m.threshold, sort++]);
  }
  return { seeded: SEED_MILESTONES.length };
}

/* -------------------------------------------------------------- measure */

/// What the desk is worth on each metric, right now, for each scope.
///
/// Baselines are the first snapshot of the window: the month's opening equity for monthly,
/// the oldest recorded equity for global. Both come from equity_snapshots — the same series
/// the equity curve draws — so a milestone can never claim a gain the chart doesn't show.
export async function measure({ now = new Date() } = {}) {
  const monthStart = now.toISOString().slice(0, 7) + '-01';
  const { rows: snaps } = await query('SELECT day, equity FROM equity_snapshots ORDER BY day ASC');
  const series = snaps.map(s => ({ day: String(s.day instanceof Date ? s.day.toISOString().slice(0, 10) : s.day).slice(0, 10), equity: Number(s.equity) }));
  const latest = series.length ? series[series.length - 1].equity : 0;
  const first = series.length ? series[0].equity : 0;
  const monthSeries = series.filter(s => s.day >= monthStart);
  // The month's baseline is the last snapshot BEFORE it started, falling back to its own
  // first row: a month that opens mid-history must measure from where the previous one
  // closed, not from its own first reading (which would erase the first day's move).
  const beforeMonth = series.filter(s => s.day < monthStart);
  const monthBase = beforeMonth.length ? beforeMonth[beforeMonth.length - 1].equity
                                       : (monthSeries.length ? monthSeries[0].equity : 0);

  // Best single position of the month, by return on the margin committed — the same base the
  // Positions heatmap colours by, so "a +10% position" means the same thing in both places.
  const { rows: best } = await query(
    `SELECT symbol, net_pnl, entry_price, qty, closed_at FROM trades WHERE closed_at >= $1`, [monthStart]);
  let bestPct = 0, bestSymbol = null;
  for (const t of best) {
    const base = Math.abs(Number(t.entry_price || 0) * Number(t.qty || 0));
    if (!base) continue;
    const pct = (Number(t.net_pnl) / base) * 100;
    if (pct > bestPct) { bestPct = pct; bestSymbol = t.symbol; }
  }
  // Open positions count too — a milestone that only fires once a trade is closed would
  // announce good news days late.
  const { rows: openRows } = await query("SELECT symbol, unrealized_pnl, notional FROM bots WHERE status='open'");
  for (const b of openRows) {
    const base = Math.abs(Number(b.notional || 0));
    if (!base) continue;
    const pct = (Number(b.unrealized_pnl || 0) / base) * 100;
    if (pct > bestPct) { bestPct = pct; bestSymbol = b.symbol; }
  }

  const pct = (cur, base) => (base > 0 ? ((cur - base) / base) * 100 : 0);
  return {
    monthly: { equity_gain: latest - monthBase, equity_pct: pct(latest, monthBase), equity_level: latest, position_pct: bestPct },
    global:  { equity_gain: latest - first,     equity_pct: pct(latest, first),     equity_level: latest, position_pct: bestPct },
    context: { equity: latest, monthBase, firstEquity: first, bestSymbol, bestPct },
  };
}

/* --------------------------------------------------------------- evaluate */

/// Award every milestone whose threshold is met and that hasn't been awarded for its current
/// period. Returns the NEWLY achieved ones so the caller can announce them — announcing is
/// not this function's job, recording is.
export async function evaluateMilestones({ now = new Date() } = {}) {
  const m = await measure({ now });
  const { rows } = await query('SELECT * FROM milestones WHERE active=true ORDER BY sort ASC, id ASC');
  const fresh = [];
  for (const ms of rows) {
    const period = currentPeriod(ms.scope, now);
    const value = m[ms.scope]?.[ms.metric];
    if (value == null || !(value >= Number(ms.threshold))) continue;
    // ON CONFLICT DO NOTHING is the whole concurrency story: two crons racing cannot award
    // the same milestone twice, and a monthly one becomes free again simply because next
    // month is a different period.
    const ins = await query(
      `INSERT INTO milestone_achievements (milestone_id, period, value)
       VALUES ($1,$2,$3) ON CONFLICT (milestone_id, period) DO NOTHING
       RETURNING achieved_at`, [ms.id, period, Math.round(Number(value) * 100) / 100]);
    if (ins.rows.length) fresh.push({ ...ms, threshold: Number(ms.threshold), period, value, achievedAt: ins.rows[0].achieved_at });
  }
  return { fresh, measured: m };
}

/* ---------------------------------------------------------------- render */

const grp = (n) => Math.round(Math.abs(n)).toLocaleString('en-US').replace(/,/g, ' ');

/// One human sentence per milestone, in English, for the audit trail and the WhatsApp/email
/// bodies. The UI renders its own localized version from (metric, threshold) — this is the
/// server-side record, not the display.
export function milestoneLabel(ms) {
  const t = Number(ms.threshold);
  switch (ms.metric) {
    case 'equity_gain':  return `Equity +${grp(t)} USDT`;
    case 'equity_pct':   return `Equity +${t}%`;
    case 'equity_level': return `Equity reaches ${grp(t)} USDT`;
    case 'position_pct': return `A single position at +${t}%`;
    default:             return `${ms.metric} ${t}`;
  }
}

export function milestoneText(ms) {
  const scope = ms.scope === 'monthly' ? `this month (${ms.period})` : 'all-time';
  return `🏆 Milestone reached — ${milestoneLabel(ms)} · ${scope}`;
}

/* ------------------------------------------------------------------ read */

/// Every milestone with its achievement state for the CURRENT period — which is what the
/// page shows: a monthly milestone reached in June is not "reached" in July.
export async function listMilestones({ now = new Date() } = {}) {
  const { rows } = await query(
    `SELECT m.*, a.achieved_at, a.value AS achieved_value, a.period AS achieved_period
     FROM milestones m
     LEFT JOIN milestone_achievements a
       ON a.milestone_id = m.id AND a.period = CASE WHEN m.scope='global' THEN 'global' ELSE $1 END
     ORDER BY m.sort ASC, m.id ASC`, [currentPeriod('monthly', now)]);
  return rows.map(r => ({
    id: Number(r.id), scope: r.scope, metric: r.metric, threshold: Number(r.threshold),
    active: r.active, sort: Number(r.sort), label: milestoneLabel(r),
    achievedAt: r.achieved_at || null,
    achievedValue: r.achieved_value == null ? null : Number(r.achieved_value),
    period: r.achieved_period || null,
  }));
}

/// Past achievements, newest first — the "we did this in March" history a monthly milestone
/// would otherwise lose the moment the month turns over.
export async function achievementHistory(limit = 50) {
  const { rows } = await query(
    `SELECT a.period, a.value, a.achieved_at, m.scope, m.metric, m.threshold
     FROM milestone_achievements a JOIN milestones m ON m.id = a.milestone_id
     ORDER BY a.achieved_at DESC LIMIT $1`, [limit]);
  return rows.map(r => ({
    period: r.period, value: Number(r.value), achievedAt: r.achieved_at,
    scope: r.scope, metric: r.metric, threshold: Number(r.threshold), label: milestoneLabel(r),
  }));
}

/* -------------------------------------------------------------- announce */

/// Tell everyone entitled to know. Four channels, ONE audience: whoever holds
/// 'view_milestones' — rolesForType('milestone') resolves to exactly that (see
/// CONTENT_TYPE_PERM in notify.js), so the Rules page is the only switch.
///
/// The in-app alert row is what both the web bell and the iOS app read, so recording it is
/// what makes the notification exist on those two surfaces; email and WhatsApp are pushes on
/// top. Every channel is best-effort: a milestone that has been earned must stay earned even
/// if the mailer is down.
export async function announceMilestones(fresh) {
  const out = [];
  for (const ms of fresh) {
    const label = milestoneLabel(ms);
    const scopeLabel = ms.scope === 'monthly' ? `Monthly · ${ms.period}` : 'All-time';
    const unit = ms.metric.endsWith('_pct') ? '%' : ' USDT';
    const value = Math.round(Number(ms.value) * 100) / 100;
    const res = { label, period: ms.period };

    // 1) In-app: the bell, the Alerts page, and the iOS app all read this table.
    try {
      await query("INSERT INTO alerts (type,code,summary) VALUES ('milestone',$1,$2)",
        [`M${ms.id}`, `${label} — ${scopeLabel}`]);
      res.inApp = 'ok';
    } catch (e) { res.inApp = String(e.message || e); }

    // 2) Email, to the roles holding view_milestones.
    try {
      const roles = await rolesForType(null, 'milestone');
      const users = await getUsersByRole(roles);
      for (const u of users) await sendMilestoneEmail(u.email, { label, scopeLabel, value, unit }).catch(() => {});
      res.email = users.length;
    } catch (e) { res.email = String(e.message || e); }

    // 3) WhatsApp, same audience, gated by its own transport switch inside notify().
    try { res.whatsapp = (await notify(milestoneText({ ...ms, period: ms.period }), { type: 'milestone' })).sent; }
    catch (e) { res.whatsapp = String(e.message || e); }

    out.push(res);
  }
  return out;
}
