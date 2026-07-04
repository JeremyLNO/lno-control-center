// Per-bot (symbol) and per-fund trade attribution, built from realized PnL events (see
// income_events / sync.js) — not from currently-open positions' unrealized PnL, which isn't
// a "win" or "loss" until the trade actually closes.
// Returns raw aggregates only (wins/losses/grossProfit/grossLoss/netPnl); win rate, profit
// factor and avg win/loss are derived client-side (mirrors liqInfo/marginUsagePct/
// dormantInfo, which are also computed from raw fields in ui.tsx) — this sidesteps
// JSON not being able to represent Infinity for a "no losing trades yet" profit factor.
import { query } from './db.js';

async function fundBySymbolMap() {
  const { rows: bots } = await query('SELECT symbol, fund_id FROM bots');
  return new Map(bots.map(b => [b.symbol, b.fund_id]));
}

export async function getAttribution() {
  const { rows } = await query(
    `SELECT symbol, income FROM income_events WHERE income_type='REALIZED_PNL' AND symbol IS NOT NULL`
  );
  const bySymbol = new Map();
  for (const r of rows) {
    const s = bySymbol.get(r.symbol) || { symbol: r.symbol, trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0 };
    const inc = Number(r.income);
    s.trades++;
    if (inc > 0) { s.wins++; s.grossProfit += inc; }
    else if (inc < 0) { s.losses++; s.grossLoss += inc; } // grossLoss accumulates negative
    bySymbol.set(r.symbol, s);
  }
  for (const s of bySymbol.values()) s.netPnl = s.grossProfit + s.grossLoss;
  const totalAbsNet = [...bySymbol.values()].reduce((a, s) => a + Math.abs(s.netPnl), 0);

  const fundBySymbol = await fundBySymbolMap();

  const perSymbol = [...bySymbol.values()].map(s => ({
    ...s, fundId: fundBySymbol.get(s.symbol) || null,
    contributionPct: totalAbsNet ? (s.netPnl / totalAbsNet) * 100 : null,
  })).sort((a, b) => b.netPnl - a.netPnl);

  const byFund = new Map();
  for (const s of perSymbol) {
    const key = s.fundId || 'unassigned';
    const f = byFund.get(key) || { fundId: s.fundId, trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, netPnl: 0 };
    f.trades += s.trades; f.wins += s.wins; f.losses += s.losses;
    f.grossProfit += s.grossProfit; f.grossLoss += s.grossLoss; f.netPnl += s.netPnl;
    byFund.set(key, f);
  }
  const perFund = [...byFund.values()]
    .map(f => ({ ...f, contributionPct: totalAbsNet ? (f.netPnl / totalAbsNet) * 100 : null }))
    .sort((a, b) => b.netPnl - a.netPnl);

  return { perSymbol, perFund };
}

// Funding paid/received + trading commissions per symbol/fund — the "drag" on a strategy
// that looks profitable on trading PnL alone. Both are typically a cost (negative income),
// though funding can be positive when you're paid (perp funding flips with the crowd's bias).
export async function getCostAnalytics() {
  const { rows } = await query(
    `SELECT symbol, income_type, income FROM income_events WHERE income_type IN ('FUNDING_FEE','COMMISSION') AND symbol IS NOT NULL`
  );
  const bySymbol = new Map();
  for (const r of rows) {
    const s = bySymbol.get(r.symbol) || { symbol: r.symbol, funding: 0, commission: 0 };
    if (r.income_type === 'FUNDING_FEE') s.funding += Number(r.income); else s.commission += Number(r.income);
    bySymbol.set(r.symbol, s);
  }
  for (const s of bySymbol.values()) s.totalCost = s.funding + s.commission;

  const fundBySymbol = await fundBySymbolMap();
  const perSymbol = [...bySymbol.values()]
    .map(s => ({ ...s, fundId: fundBySymbol.get(s.symbol) || null }))
    .sort((a, b) => a.totalCost - b.totalCost);

  const byFund = new Map();
  for (const s of perSymbol) {
    const key = s.fundId || 'unassigned';
    const f = byFund.get(key) || { fundId: s.fundId, funding: 0, commission: 0, totalCost: 0 };
    f.funding += s.funding; f.commission += s.commission; f.totalCost += s.totalCost;
    byFund.set(key, f);
  }
  const perFund = [...byFund.values()].sort((a, b) => a.totalCost - b.totalCost);

  return { perSymbol, perFund };
}
