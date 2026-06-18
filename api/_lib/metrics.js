// Risk metrics over a recorded equity series (the real daily equity_snapshots history).
// series: [{ t, equity }] sorted ascending. Degrades gracefully on short/empty history.
export function riskMetrics(series) {
  const eq = (series || []).map(p => p.equity);
  if (!eq.length) return { totalEquity: 0, pnlDay: 0, pnlWeek: 0, sharpe: 0, sortino: 0, maxDrawdownPct: 0, ddDurationDays: 0 };
  const rets = []; for (let i = 1; i < eq.length; i++) rets.push(eq[i] / eq[i - 1] - 1);
  const n = rets.length || 1;
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  const down = rets.filter(r => r < 0);
  const dd = Math.sqrt(down.reduce((a, b) => a + b * b, 0) / (down.length || 1));
  const ann = Math.sqrt(365);
  let peak = eq[0], peakI = 0, mdd = 0, ddDur = 0;
  for (let i = 0; i < eq.length; i++) {
    if (eq[i] >= peak) { peak = eq[i]; peakI = i; }
    else { const d = (eq[i] - peak) / peak; if (d < mdd) mdd = d; if (i - peakI > ddDur) ddDur = i - peakI; }
  }
  const last = eq[eq.length - 1], prev = eq[eq.length - 2] || last, wk = eq[eq.length - 8] || eq[0];
  return {
    totalEquity: last, pnlDay: last - prev, pnlWeek: last - wk,
    sharpe: sd ? (mean / sd) * ann : 0, sortino: dd ? (mean / dd) * ann : 0,
    maxDrawdownPct: mdd * 100, ddDurationDays: ddDur,
  };
}
