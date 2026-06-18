// Real-data portfolio view, built from the synced bots/positions + recorded equity.
//   - equity  : latest account equity from the most recent sync ('live' config)
//   - pnlDay  : change vs the most recent recorded equity snapshot
//   - funds[] : open bots grouped by their assigned fund (+ an "Unassigned" group)
import { query } from './db.js';

export async function buildPortfolio() {
  const bots = (await query("SELECT * FROM bots WHERE status='open' ORDER BY symbol ASC")).rows;
  const funds = (await query('SELECT * FROM funds ORDER BY sort ASC, name ASC')).rows;
  const liveRow = (await query("SELECT value FROM app_config WHERE key='live'")).rows[0];
  const live = (liveRow && liveRow.value) || {};
  const equity = Number(live.equity || 0);

  // PnL day vs the most recent recorded snapshot (yesterday on the first daily run)
  const lastSnap = (await query('SELECT equity FROM equity_snapshots ORDER BY day DESC LIMIT 1')).rows[0];
  const prevEquity = lastSnap ? Number(lastSnap.equity) : equity;
  const pnlDay = equity - prevEquity;
  const pnlPct = prevEquity ? (pnlDay / prevEquity) * 100 : 0;

  const openPnl = bots.reduce((a, b) => a + Number(b.unrealized_pnl || 0), 0);
  const exposure = bots.reduce((a, b) => a + Number(b.notional || 0), 0);

  const byFund = new Map(funds.map(f => [f.id, { id: f.id, name: f.name, color: f.color, bots: [], uPnl: 0, notional: 0 }]));
  const unassigned = { id: null, name: 'Unassigned', color: null, bots: [], uPnl: 0, notional: 0 };
  for (const b of bots) {
    const g = (b.fund_id && byFund.get(b.fund_id)) || unassigned;
    g.bots.push(b); g.uPnl += Number(b.unrealized_pnl || 0); g.notional += Number(b.notional || 0);
  }

  return {
    equity, pnlDay, pnlPct, openPnl, exposure,
    funds: [...byFund.values()], unassigned,
    bots, connected: Number(live.connected || 0), syncedAt: live.syncedAt || null,
  };
}
