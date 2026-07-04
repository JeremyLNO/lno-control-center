// Employee Fund: a special fund holding real capital contributed on employees' behalf. Each
// employee owns a number of "units" (mutual-fund-style unitisation) rather than a flat euro
// amount, so that someone who joins after the fund has already gained or lost value gets a
// fair share of what happens AFTER they join — not before.
//
// Contributions are no longer auto-credited on hire. Real capital lands in the synced Binance
// account (however finance actually moves it there — a deposit or an internal transfer, it
// doesn't matter which), syncExchanges() notices the wallet balance jumped by ~1000 USDT more
// than realized PnL/funding/commission explain (detectFundContributions(), called from
// api/_lib/sync.js), and queues it in employee_fund_contributions for an admin to assign to
// the specific employee it's meant to fund (assignContribution()) — see api/funds.js.
import { query } from './db.js';
import { FUND_PALETTE } from './constants.js';
import { migrate } from './schema.js';

const GRANT_AMOUNT = 1000;
const FUND_NAME = 'Employee Fund';
// Slack allowed around each $1000 multiple when matching an unexplained wallet-balance jump —
// covers rounding/dust and any small income not yet booked at the moment of comparison.
const CONTRIBUTION_TOLERANCE = 50;

// Read-only lookup — never creates anything. Used by plain reads (the ordinary GET /api/funds
// list, the "can this be deleted" check) so a simple page load can never resurrect the fund
// right after an admin explicitly wipes it via Reset data.
export async function peekEmployeeFundId() {
  const cached = await query("SELECT value FROM app_config WHERE key='employeeFund'");
  const cachedId = cached.rows[0] && cached.rows[0].value && cached.rows[0].value.fundId;
  if (cachedId) {
    const still = await query('SELECT 1 FROM funds WHERE id=$1', [cachedId]);
    if (still.rows[0]) return cachedId;
  }
  const byName = await query('SELECT id FROM funds WHERE lower(name)=lower($1) LIMIT 1', [FUND_NAME]);
  return byName.rows[0] ? byName.rows[0].id : null;
}

// The fund's id isn't a fixed constant: an admin may already have created a fund named
// "Employee Fund" by hand before this feature ever ran. Resolving it dynamically (cached in
// app_config once found/created) means we adopt that existing fund instead of creating a
// second one with the same name — fund names must be unique (see funds.js). Only call this
// from a path that's actually supposed to create the fund if it's missing (granting a share);
// plain reads must use peekEmployeeFundId() instead.
export async function getEmployeeFundId() {
  const existing = await peekEmployeeFundId();
  if (existing) return existing;
  const id = 'ef' + Date.now();
  const next = await query('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM funds');
  await query('INSERT INTO funds (id,name,color,bots,sort) VALUES ($1,$2,$3,$4::jsonb,$5)',
    [id, FUND_NAME, FUND_PALETTE[FUND_PALETTE.length - 1], '[]', next.rows[0].s]);
  await query(`INSERT INTO app_config (key,value) VALUES ('employeeFund',$1::jsonb)
               ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`, [JSON.stringify({ fundId: id })]);
  return id;
}

// Fund's current mark-to-market value = total capital ever contributed + the open unrealized
// PnL of bots assigned to it. This mirrors the same fidelity the rest of the app already uses
// for fund-level reporting elsewhere (funds only ever show unrealized PnL, no realized-PnL
// ledger exists per fund) — not a weaker version of it.
async function fundValue(fundId) {
  const { rows: shareRows } = await query('SELECT COALESCE(SUM(contributed_amount),0) AS c, COALESCE(SUM(units),0) AS u FROM employee_shares');
  const totalContributed = Number(shareRows[0].c), totalUnits = Number(shareRows[0].u);
  const { rows: botRows } = await query(`SELECT COALESCE(SUM(unrealized_pnl),0) AS p FROM bots WHERE fund_id=$1 AND status='open'`, [fundId]);
  const openUPnl = Number(botRows[0].p);
  const value = totalContributed + openUPnl;
  const navPerUnit = totalUnits > 0 ? value / totalUnits : 1;
  return { totalContributed, totalUnits, openUPnl, value, navPerUnit };
}

// Called once per sync (see api/_lib/sync.js) with the wallet-balance delta since the
// previous sync and the realized PnL/funding/commission booked in between (already fetched in
// that same pass). Any unexplained jump close to a multiple of $1000 is real capital the
// account gained that trading doesn't explain — queued for an admin to assign. No Binance
// deposit/transfer API involved; inferred purely from data already synced, so it needs no
// extra API-key permissions beyond the existing read-only futures key.
export async function detectFundContributions({ prevWalletBalance, newWalletBalance, deltaIncome }) {
  await migrate();
  const unexplained = (newWalletBalance - prevWalletBalance) - deltaIncome;
  const units = Math.round(unexplained / GRANT_AMOUNT);
  if (units < 1 || Math.abs(unexplained - units * GRANT_AMOUNT) > CONTRIBUTION_TOLERANCE) return 0;
  for (let i = 0; i < units; i++) {
    await query(`INSERT INTO employee_fund_contributions (amount,raw_delta) VALUES ($1,$2)`, [GRANT_AMOUNT, unexplained]);
  }
  return units;
}

// Contributions detected but not yet attributed to an employee — an admin picks who each one
// funds (see assignContribution()).
export async function listPendingContributions() {
  await migrate();
  const { rows } = await query(
    `SELECT id, detected_at, amount, raw_delta FROM employee_fund_contributions WHERE status='pending' ORDER BY detected_at ASC`
  );
  return rows.map(r => ({ id: Number(r.id), detectedAt: r.detected_at, amount: Number(r.amount), rawDelta: Number(r.raw_delta) }));
}

// Attributes a detected contribution to one employee, priced at TODAY's NAV — same unitisation
// as any other grant. If the employee already holds a share (a later top-up), this adds to
// their existing units rather than replacing them.
export async function assignContribution(contributionId, userId, adminId) {
  await migrate();
  const { rows } = await query(`SELECT * FROM employee_fund_contributions WHERE id=$1 AND status='pending'`, [contributionId]);
  const contrib = rows[0];
  if (!contrib) throw new Error('Contribution not found or already assigned');
  const { rows: urows } = await query(`SELECT id, role FROM users WHERE id=$1`, [userId]);
  const u = urows[0];
  if (!u) throw new Error('User not found');
  if (!['admin', 'operator', 'viewer'].includes(u.role)) throw new Error('Only internal (non-shareholder) accounts can hold an Employee Fund share');

  const fundId = await getEmployeeFundId();
  const { navPerUnit } = await fundValue(fundId);
  const amount = Number(contrib.amount);
  const units = amount / navPerUnit;

  const existing = await query('SELECT user_id FROM employee_shares WHERE user_id=$1', [userId]);
  if (existing.rows[0]) {
    await query('UPDATE employee_shares SET contributed_amount=contributed_amount+$2, units=units+$3 WHERE user_id=$1', [userId, amount, units]);
  } else {
    await query(
      `INSERT INTO employee_shares (user_id,fund_id,contributed_amount,units,joined_at) VALUES ($1,$2,$3,$4,now())`,
      [userId, fundId, amount, units]
    );
  }
  await query(
    `UPDATE employee_fund_contributions SET status='assigned', assigned_user_id=$2, assigned_at=now(), assigned_by=$3 WHERE id=$1`,
    [contributionId, userId, adminId]
  );
  return { userId, amount, units };
}

// Internal-role accounts with no Employee Fund share — the normal state for anyone whose
// contribution hasn't been detected/assigned yet, not just deactivated stragglers.
async function getNotEnrolled() {
  const { rows } = await query(
    `SELECT id, first_name, last_name, email, role, active, avatar FROM users
     WHERE role IN ('admin','operator','viewer') AND id NOT IN (SELECT user_id FROM employee_shares)
     ORDER BY active DESC, created_at ASC`
  );
  return rows.map(r => ({ userId: r.id, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role, active: r.active, avatar: r.avatar }));
}

export async function getEmployeeFundSummary() {
  // Self-heal: employee_shares/income_events are only created by migrate(), which otherwise
  // only runs from syncExchanges() (Sync now / the daily cron). If nobody has ever synced an
  // exchange yet, those tables wouldn't exist and every query below would throw a raw SQL
  // error — silently surfaced as an endless "Loading…" by the frontend's catch(->null).
  await migrate();
  const fundId = await getEmployeeFundId();
  const { totalContributed, totalUnits, openUPnl, value, navPerUnit } = await fundValue(fundId);
  const { rows } = await query(
    `SELECT es.user_id, es.contributed_amount, es.units, es.joined_at,
            u.first_name, u.last_name, u.email, u.role, u.avatar
     FROM employee_shares es JOIN users u ON u.id = es.user_id
     ORDER BY es.joined_at ASC`
  );
  const employees = rows.map(r => ({
    userId: r.user_id, firstName: r.first_name, lastName: r.last_name, email: r.email, role: r.role, avatar: r.avatar,
    contributedAmount: Number(r.contributed_amount), units: Number(r.units), joinedAt: r.joined_at,
    currentValue: Number(r.units) * navPerUnit,
  }));
  const notEnrolled = await getNotEnrolled();
  const pendingContributions = await listPendingContributions();
  return { totalContributed, totalUnits, openUPnl, value, navPerUnit, employees, notEnrolled, pendingContributions };
}

// Monday (UTC, ISO week start) of the week containing `day` (a 'YYYY-MM-DD' string).
function mondayOf(day) {
  const d = new Date(day + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}

// Records today's fund value/NAV — called once a day by the daily cron, same pattern as
// equity_snapshots. Weekly points are derived from these daily rows (see getFundWeeklySeries),
// not written directly, so "the position every Sunday" is just whichever day's row happens to
// be the last one recorded in that ISO week.
export async function recordDailyFundSnapshot() {
  await migrate();
  const fundId = await getEmployeeFundId();
  const { value, totalContributed, navPerUnit } = await fundValue(fundId);
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO employee_fund_snapshots (day,value,total_contributed,nav_per_unit) VALUES ($1,$2,$3,$4)
     ON CONFLICT (day) DO UPDATE SET value=$2, total_contributed=$3, nav_per_unit=$4`,
    [today, value, totalContributed, navPerUnit]
  );
}

// One point per ISO week (Mon-Sun): the last daily snapshot recorded within that week — i.e.
// Sunday's value once the week is complete, or the latest day recorded so far for a week in
// progress. Ordered ascending so the chart plots left-to-right.
async function getFundWeeklySeries() {
  const { rows } = await query('SELECT day, value, total_contributed, nav_per_unit FROM employee_fund_snapshots ORDER BY day ASC');
  const byWeek = new Map();
  for (const r of rows) {
    const day = r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day);
    byWeek.set(mondayOf(day), { week: mondayOf(day), value: Number(r.value), totalContributed: Number(r.total_contributed), navPerUnit: Number(r.nav_per_unit) });
  }
  return Array.from(byWeek.values()).sort((a, b) => a.week.localeCompare(b.week));
}

export async function getMyShare(userId) {
  const summary = await getEmployeeFundSummary();
  const mine = summary.employees.find(e => e.userId === userId) || null;
  let weekly = [];
  if (mine) {
    const joinedDay = new Date(mine.joinedAt).toISOString().slice(0, 10);
    weekly = (await getFundWeeklySeries())
      .filter(w => w.week >= mondayOf(joinedDay))
      .map(w => ({ t: new Date(w.week + 'T00:00:00Z').getTime(), equity: mine.units * w.navPerUnit }));
  }
  return { fund: { totalContributed: summary.totalContributed, value: summary.value, navPerUnit: summary.navPerUnit }, mine, weekly };
}
