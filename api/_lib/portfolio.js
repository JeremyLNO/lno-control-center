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

// Shared shape for a report over the last `days` (1/7/30 for daily/weekly/monthly) — used by
// the real once-daily cron send (api/cron/daily.js), the admin "send test" buttons, and the
// admin "generate report now" action (all in api/snapshots.js), so every one of those is built
// exactly the same way. pnl/pct diff against the equity_snapshots row `days` back (NOT
// port.pnlDay, which compares against whatever row is "most recent" — that row gets
// continuously overwritten intraday by the every-~10-minute alerts-only cron, so it can end up
// reflecting the last few minutes rather than a true N-days-ago comparison).
export async function buildReportData(days = 1) {
  const port = await buildPortfolio();
  const { rows: snaps } = await query('SELECT equity FROM equity_snapshots ORDER BY day ASC');
  const eqv = snaps.map(r => Number(r.equity));
  const pnlOver = (d) => eqv.length ? eqv[eqv.length - 1] - eqv[Math.max(0, eqv.length - 1 - d)] : 0;
  const pctOver = (d) => { const base = eqv[Math.max(0, eqv.length - 1 - d)] || 0; return base ? (pnlOver(d) / base) * 100 : 0; };
  const positions = port.bots.map(b => ({ symbol: b.symbol, side: b.side, unrealizedPnl: Number(b.unrealized_pnl || 0), notional: Number(b.notional || 0) }));
  // "Incidents" = service-health problems (exchange API/data feed), not portfolio
  // performance threshold breaches (drawdown/PnL) — those are a different alert type.
  const { rows: incidentRows } = await query("SELECT count(*)::int AS n FROM alerts WHERE type='api_error' AND created_at > now() - interval '24 hours'");
  // Equity trend for the report's chart — a wider trailing window than `days` itself so even
  // a daily report's chart has enough points to read as a trend, not two dots (14d floor,
  // capped to however much history actually exists).
  const chartLen = Math.min(eqv.length, Math.max(days * 2, 14));
  return {
    equity: port.equity, pnl: pnlOver(days), pct: pctOver(days), openPnl: port.openPnl, exposure: port.exposure,
    funds: port.funds, positions, incidentCount: incidentRows[0]?.n || 0, dateLabel: new Date().toISOString().slice(0, 10),
    series: eqv.slice(-chartLen),
  };
}

// Thin wrapper matching sendDailyReportEmail()/dailyDigestText()'s existing pnlDay/pctDay
// field names — kept so those callers don't need to change.
export async function buildDailyReportData() {
  const d = await buildReportData(1);
  return { equity: d.equity, pnlDay: d.pnl, pctDay: d.pct, openPnl: d.openPnl, exposure: d.exposure, funds: d.funds, positions: d.positions, incidentCount: d.incidentCount, dateLabel: d.dateLabel, series: d.series };
}
