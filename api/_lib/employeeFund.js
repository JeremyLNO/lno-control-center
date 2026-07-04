// Employee Fund: a special fund into which every employee (any internal role — admin,
// operator, viewer; shareholders are external investors, not staff) is credited €1000 on
// their hire date, then the fund trades like any other. Each employee owns a number of
// "units" (mutual-fund-style unitisation) rather than a flat euro amount, so that someone
// who joins after the fund has already gained or lost value gets a fair share of what
// happens AFTER they join — not before. A brand-new fund starts at NAV/unit = 1 (par), so
// backfilling every current employee at once (when this feature first ships) is exact, not
// an approximation: nobody has an unfair head start because nothing has traded yet.
import { query } from './db.js';
import { FUND_PALETTE } from './constants.js';

export const EMPLOYEE_FUND_ID = 'employee-fund';
const GRANT_AMOUNT = 1000;

export async function ensureEmployeeFund() {
  const { rows } = await query('SELECT id FROM funds WHERE id=$1', [EMPLOYEE_FUND_ID]);
  if (rows.length) return;
  const next = await query('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM funds');
  await query('INSERT INTO funds (id,name,color,bots,sort) VALUES ($1,$2,$3,$4::jsonb,$5)',
    [EMPLOYEE_FUND_ID, 'Employee Fund', FUND_PALETTE[FUND_PALETTE.length - 1], '[]', next.rows[0].s]);
}

// Fund's current mark-to-market value = total capital ever contributed + the open unrealized
// PnL of bots assigned to it. This mirrors the same fidelity the rest of the app already uses
// for fund-level reporting elsewhere (funds only ever show unrealized PnL, no realized-PnL
// ledger exists per fund) — not a weaker version of it.
async function fundValue() {
  const { rows: shareRows } = await query('SELECT COALESCE(SUM(contributed_amount),0) AS c, COALESCE(SUM(units),0) AS u FROM employee_shares');
  const totalContributed = Number(shareRows[0].c), totalUnits = Number(shareRows[0].u);
  const { rows: botRows } = await query(`SELECT COALESCE(SUM(unrealized_pnl),0) AS p FROM bots WHERE fund_id=$1 AND status='open'`, [EMPLOYEE_FUND_ID]);
  const openUPnl = Number(botRows[0].p);
  const value = totalContributed + openUPnl;
  const navPerUnit = totalUnits > 0 ? value / totalUnits : 1;
  return { totalContributed, totalUnits, openUPnl, value, navPerUnit };
}

// Grants one employee their share at TODAY's NAV (used both for a brand-new hire and for the
// one-time backfill of pre-existing employees — for the backfill, joinedAt is their real
// account-creation date even though the grant is priced at today's NAV; see file header).
export async function grantShare(userId, joinedAt) {
  await ensureEmployeeFund();
  const { navPerUnit } = await fundValue();
  const units = GRANT_AMOUNT / navPerUnit;
  await query(
    `INSERT INTO employee_shares (user_id,fund_id,contributed_amount,units,joined_at)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO NOTHING`,
    [userId, EMPLOYEE_FUND_ID, GRANT_AMOUNT, units, joinedAt]
  );
}

// Self-healing backfill: any active, internal-role (non-shareholder) user without a share
// yet gets one. Safe to call on every read — a no-op once everyone has a row.
export async function backfillEmployeeShares() {
  await ensureEmployeeFund();
  const { rows } = await query(
    `SELECT id, created_at FROM users
     WHERE active=true AND role IN ('admin','operator','viewer')
       AND id NOT IN (SELECT user_id FROM employee_shares)`
  );
  for (const u of rows) await grantShare(u.id, u.created_at);
}

export async function getEmployeeFundSummary() {
  await backfillEmployeeShares();
  const { totalContributed, totalUnits, openUPnl, value, navPerUnit } = await fundValue();
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
  return { totalContributed, totalUnits, openUPnl, value, navPerUnit, employees };
}

export async function getMyShare(userId) {
  const summary = await getEmployeeFundSummary();
  const mine = summary.employees.find(e => e.userId === userId) || null;
  return { fund: { totalContributed: summary.totalContributed, value: summary.value, navPerUnit: summary.navPerUnit }, mine };
}
