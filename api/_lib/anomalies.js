// Automatic anomaly detection.
//
// An ALERT (api/alerts.js) fires when a threshold is crossed right now — the portfolio is
// down more than X, an exchange stopped responding. An ANOMALY is different: it is a pattern
// in how a bot is BEHAVING that a human would otherwise only notice weeks later. A profit
// factor quietly halving, losses concentrating on one asset, a bot that used to trade four
// times a day and now trades twenty.
//
// Every finding carries three things, because a detector nobody trusts gets ignored:
//   severity — how much it matters,
//   cause    — the most likely explanation, stated as a hypothesis, not a verdict,
//   evidence — the actual numbers that triggered it, so the reader can check the reasoning.
//
// Detectors compare a RECENT window against a BASELINE window rather than against absolute
// thresholds, because "normal" differs per strategy. A bot averaging 0.9 profit factor all
// year is not anomalous; one that ran at 1.6 for three months and is now at 0.9 is.
import { query } from './db.js';
import { computeKpis } from './analytics.js';
import { evaluateExpectations } from './strategies.js';

export const DEFAULT_ANOMALY_CONFIG = {
  recentDays: 14,          // window judged
  baselineDays: 42,        // window it is judged against (the 42 days BEFORE the recent one)
  minTrades: 8,            // below this the sample says nothing; skip rather than guess
  pfDropPct: 35,           // profit factor down this much vs baseline -> anomaly
  ddRisePct: 60,           // drawdown this much deeper than baseline -> anomaly
  lossConcentrationPct: 60,// one asset carrying this share of total losses -> anomaly
  freqChangePct: 100,      // trades/day this far from baseline (either way) -> anomaly
  dirDivergencePct: 50,    // LONG vs SHORT win-rate gap in points -> anomaly
  latencyMs: 3000,         // exchange round-trip slower than this -> anomaly
  dormantHours: 48,        // an open position untouched this long -> anomaly
};

// Detectors not yet possible, surfaced so the absence is visible rather than silently
// narrowing what "anomaly detection" means here. Both are reachable from Binance's order
// endpoint; backtest divergence was dropped with the decision to use live exchange data only.
export const UNDETECTABLE = {
  slippage_rise: 'needs placed-vs-executed price — reachable from Binance once orders are synced',
  unfilled_orders: 'order lifecycle is not synced — only completed fills are',
};

export async function getAnomalyConfig() {
  const { rows } = await query("SELECT value FROM app_config WHERE key='anomalyConfig'");
  return { ...DEFAULT_ANOMALY_CONFIG, ...(rows[0]?.value || {}) };
}

const pct = (a, b) => (b ? ((a - b) / Math.abs(b)) * 100 : null);
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

// ---------------------------------------------------------------------------------------
// Detectors. Each returns an array of findings; none of them writes to the database — that
// is persist()'s job, so a detector stays a pure function of the trade set and is testable
// by handing it rows.
// ---------------------------------------------------------------------------------------

function detectProfitFactor(scope, recent, baseline, cfg) {
  const r = computeKpis(recent), b = computeKpis(baseline);
  if (r.trades < cfg.minTrades || b.trades < cfg.minTrades) return [];
  // A baseline with no losing trade has no profit factor to compare against; and a recent
  // window with none is doing fine by definition.
  if (b.profitFactor == null || r.profitFactor == null) return [];
  const drop = -pct(r.profitFactor, b.profitFactor);
  if (drop < cfg.pfDropPct) return [];
  return [{
    code: 'profit_factor_drop',
    scope,
    severity: r.profitFactor < 1 ? 'critical' : 'warning',
    summary: `Profit factor fell from ${r2(b.profitFactor)} to ${r2(r.profitFactor)}`,
    cause: r.profitFactor < 1
      ? 'The recent window is losing money overall. Either market conditions moved away from what the entry rules assume, or a parameter change degraded the edge — check whether a new strategy version was deployed at the start of this window.'
      : 'The edge is thinning but still positive. Often a regime shift rather than a fault; compare against the same window on other assets before acting.',
    evidence: { variant: r.profitFactor < 1 ? 'losing' : 'thinning', recentPF: r2(r.profitFactor), baselinePF: r2(b.profitFactor), dropPct: r2(drop), recentTrades: r.trades, baselineTrades: b.trades, recentNetPnl: r2(r.netPnl) },
  }];
}

function detectDrawdown(scope, recent, baseline, cfg) {
  const r = computeKpis(recent), b = computeKpis(baseline);
  if (r.trades < cfg.minTrades || b.trades < cfg.minTrades) return [];
  const rDD = Math.abs(r.maxDrawdown), bDD = Math.abs(b.maxDrawdown);
  if (!bDD || rDD <= bDD) return [];
  const rise = pct(rDD, bDD);
  if (rise < cfg.ddRisePct) return [];
  return [{
    code: 'drawdown_rise',
    scope,
    severity: rise > cfg.ddRisePct * 2 ? 'critical' : 'warning',
    summary: `Max drawdown deepened to ${r2(-rDD)} (baseline ${r2(-bDD)})`,
    cause: 'Losing trades are clustering instead of being spread out. Typical causes: position sizing raised without widening the stop, or several correlated assets moving together — check whether the losses share a direction or an asset.',
    evidence: { variant: 'default', recentDrawdown: r2(-rDD), baselineDrawdown: r2(-bDD), risePct: r2(rise), recentTrades: r.trades },
  }];
}

function detectLossConcentration(scope, recent, cfg) {
  const losers = recent.filter(t => t.net_pnl < 0);
  if (losers.length < cfg.minTrades) return [];
  const total = losers.reduce((s, t) => s + Math.abs(t.net_pnl), 0);
  if (!total) return [];
  const bySymbol = new Map();
  for (const t of losers) bySymbol.set(t.symbol, (bySymbol.get(t.symbol) || 0) + Math.abs(t.net_pnl));
  // Concentration only means something when there is something to concentrate AWAY from:
  // a single-asset bot is 100% concentrated by construction, not by anomaly.
  const symbols = [...new Set(recent.map(t => t.symbol))];
  if (symbols.length < 2) return [];
  const [worst, amount] = [...bySymbol.entries()].sort((a, b) => b[1] - a[1])[0];
  const share = (amount / total) * 100;
  if (share < cfg.lossConcentrationPct) return [];
  return [{
    code: 'loss_concentration',
    scope: `${scope}|${worst}`,
    severity: 'warning',
    summary: `${worst} accounts for ${r2(share)}% of all losses`,
    cause: 'One asset is carrying most of the damage while the others behave. Usually means the entry rules generalise badly to this asset\'s volatility or liquidity — consider removing it from the allowed list rather than retuning the whole strategy.',
    evidence: { variant: 'default', symbol: worst, lossShare: r2(share), symbolLoss: r2(-amount), totalLoss: r2(-total), assetsTraded: symbols.length },
  }];
}

function detectDirectionDrift(scope, recent, cfg) {
  const longs = recent.filter(t => t.direction === 'LONG');
  const shorts = recent.filter(t => t.direction === 'SHORT');
  if (longs.length < cfg.minTrades || shorts.length < cfg.minTrades) return [];
  const l = computeKpis(longs), s = computeKpis(shorts);
  const gap = Math.abs(l.winRate - s.winRate);
  if (gap < cfg.dirDivergencePct) return [];
  const weak = l.winRate < s.winRate ? 'LONG' : 'SHORT';
  return [{
    code: 'long_short_drift',
    scope,
    severity: 'warning',
    summary: `${weak} side is far weaker (${r2(l.winRate)}% long vs ${r2(s.winRate)}% short)`,
    cause: `The strategy is only working in one direction. In a strongly trending market that is expected rather than broken — but if it persists across regimes, the ${weak} entry conditions are probably a mirror of the other side that does not actually hold.`,
    evidence: { variant: 'default', weakSide: weak, longWinRate: r2(l.winRate), shortWinRate: r2(s.winRate), gapPoints: r2(gap), longNetPnl: r2(l.netPnl), shortNetPnl: r2(s.netPnl), longTrades: l.trades, shortTrades: s.trades },
  }];
}

function detectFrequency(scope, recent, baseline, cfg) {
  const r = computeKpis(recent), b = computeKpis(baseline);
  if (b.trades < cfg.minTrades) return [];
  // A bot that has gone completely silent is the most serious version of this: it is not a
  // drift in cadence, it is a strategy that has stopped acting at all.
  if (r.trades === 0) {
    return [{
      code: 'trade_frequency', scope, severity: 'critical',
      summary: `No trade closed in the last ${cfg.recentDays} days (baseline ${r2(b.tradesPerDay)}/day)`,
      cause: 'The strategy has stopped producing results entirely. Either it is switched off, its entry conditions can no longer be met, or the bot is failing silently — check the exchange connection and the bot\'s last activity before assuming a market cause.',
      evidence: { variant: 'stopped', recentTrades: 0, baselinePerDay: r2(b.tradesPerDay), windowDays: cfg.recentDays },
    }];
  }
  if (r.tradesPerDay == null || b.tradesPerDay == null) return [];
  const change = pct(r.tradesPerDay, b.tradesPerDay);
  if (Math.abs(change) < cfg.freqChangePct) return [];
  const up = change > 0;
  return [{
    code: 'trade_frequency', scope, severity: 'warning',
    summary: `Trade frequency ${up ? 'up' : 'down'} ${r2(Math.abs(change))}% (${r2(r.tradesPerDay)}/day vs ${r2(b.tradesPerDay)}/day)`,
    cause: up
      ? 'The strategy is firing far more often than usual. Overtrading multiplies fee and funding drag even when the edge holds — check whether fees have grown as a share of gross PnL.'
      : 'The strategy is firing far less often than usual. Usually a market regime that no longer meets the entry conditions; only a concern if it coincides with a change in results.',
    evidence: { variant: up ? 'up' : 'down', changeAbs: r2(Math.abs(change)), recentPerDay: r2(r.tradesPerDay), baselinePerDay: r2(b.tradesPerDay), changePct: r2(change), recentTrades: r.trades, recentFees: r2(r.fees), recentGross: r2(r.grossPnl) },
  }];
}

// Realised KPIs against what the playbook says the strategy was signed off to deliver. This
// is the one detector that measures against INTENT rather than against the bot's own past —
// a strategy can be perfectly stable and still have never met its target.
function detectExpectationMiss(strategy, trades, cfg) {
  if (trades.length < cfg.minTrades) return [];
  const actual = computeKpis(trades);
  const missed = evaluateExpectations(strategy.expected_kpis || {}, actual).filter(e => e.status === 'missed');
  if (!missed.length) return [];
  return [{
    code: 'expectation_missed',
    scope: `strategy:${strategy.id}`,
    severity: 'warning',
    summary: `${strategy.name} is below ${missed.length} of its declared targets`,
    cause: 'The strategy is not delivering what it was signed off on. Either the expectation was set from a backtest that did not survive live conditions, or the live edge has degraded — the version history shows which.',
    evidence: { variant: 'default', strategy: strategy.name, missedCount: missed.length, missed: missed.map(m => ({ metric: m.key, target: m.target, actual: r2(m.value) })), trades: actual.trades },
  }];
}

// Operational detectors — these read live infrastructure state rather than trade history.
async function detectOperational(cfg) {
  const out = [];
  const { rows: exs } = await query('SELECT id, name, label, latency_ms, status FROM exchanges');
  for (const ex of exs) {
    if (ex.latency_ms != null && Number(ex.latency_ms) > cfg.latencyMs) {
      out.push({
        code: 'exchange_latency', scope: `exchange:${ex.id}`,
        severity: Number(ex.latency_ms) > cfg.latencyMs * 3 ? 'critical' : 'warning',
        summary: `${ex.label || ex.name} responding in ${ex.latency_ms} ms`,
        cause: 'Exchange round-trip is far above normal. Entries and exits are being placed on stale prices, which shows up later as unexplained slippage — check the venue status page before touching the strategy.',
            evidence: { variant: 'default', exchange: ex.label || ex.name, latencyMs: Number(ex.latency_ms), thresholdMs: cfg.latencyMs },
      });
    }
  }
  // An open position nobody has touched for days: either the exit logic is stuck, or the bot
  // behind it has stopped running while leaving real money exposed.
  const { rows: dormant } = await query(
    `SELECT id, symbol, notional, last_changed FROM bots
     WHERE status='open' AND last_changed < now() - ($1 || ' hours')::interval`, [String(cfg.dormantHours)]
  );
  for (const b of dormant) {
    const hours = Math.round((Date.now() - new Date(b.last_changed).getTime()) / 3600000);
    out.push({
      code: 'dormant_position', scope: `bot:${b.id}`, severity: 'warning',
      summary: `${b.symbol} open and unchanged for ${hours}h`,
      cause: 'The position has not moved in either direction for days while remaining exposed. Either the exit condition can no longer trigger, or the process managing it is no longer running.',
      evidence: { variant: 'default', bot: b.id, symbol: b.symbol, notional: r2(Number(b.notional)), hoursIdle: hours, thresholdHours: cfg.dormantHours },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------------------

// Split a bot's/strategy's trades into the two comparison windows. Both are derived from the
// same now, so a detector can never compare windows of different ages.
function splitWindows(trades, cfg, now = Date.now()) {
  const recentFrom = now - cfg.recentDays * 86400000;
  const baseFrom = recentFrom - cfg.baselineDays * 86400000;
  const at = (t) => new Date(t.closed_at).getTime();
  return {
    recent: trades.filter(t => at(t) >= recentFrom),
    baseline: trades.filter(t => at(t) >= baseFrom && at(t) < recentFrom),
  };
}

export async function runDetection({ now = Date.now() } = {}) {
  const cfg = await getAnomalyConfig();
  const found = [];

  const { rows: raw } = await query(
    `SELECT exchange, symbol, direction, net_pnl, gross_pnl, commission, funding, closed_at, duration_s, strategy_id
     FROM trades WHERE closed_at IS NOT NULL ORDER BY closed_at ASC`
  );
  const trades = raw.map(t => ({
    ...t, net_pnl: Number(t.net_pnl), gross_pnl: Number(t.gross_pnl),
    commission: Number(t.commission), funding: Number(t.funding),
    duration_s: t.duration_s == null ? null : Number(t.duration_s),
  }));

  // Portfolio-wide, then per bot. Both levels matter: a single bot degrading can be invisible
  // in the aggregate, and a correlated slide across every bot is invisible bot by bot.
  const scopes = [['portfolio', trades]];
  const byBot = new Map();
  for (const t of trades) {
    const id = `${t.exchange}:${t.symbol}`;
    if (!byBot.has(id)) byBot.set(id, []);
    byBot.get(id).push(t);
  }
  for (const [id, ts] of byBot) scopes.push([`bot:${id}`, ts]);

  for (const [scope, ts] of scopes) {
    const { recent, baseline } = splitWindows(ts, cfg, now);
    found.push(...detectProfitFactor(scope, recent, baseline, cfg));
    found.push(...detectDrawdown(scope, recent, baseline, cfg));
    found.push(...detectFrequency(scope, recent, baseline, cfg));
    found.push(...detectDirectionDrift(scope, recent, cfg));
    // Loss concentration is only meaningful across assets, so it runs at portfolio level only.
    if (scope === 'portfolio') found.push(...detectLossConcentration(scope, recent, cfg));
  }

  const { rows: strategies } = await query('SELECT * FROM strategies');
  for (const s of strategies) {
    found.push(...detectExpectationMiss(s, trades.filter(t => t.strategy_id === s.id), cfg));
  }

  found.push(...(await detectOperational(cfg)));

  return persist(found);
}

// Persist findings, and close the ones that no longer hold.
//
// A still-true anomaly refreshes the existing row (last_seen_at, evidence, severity) instead
// of creating a duplicate — otherwise a detector running daily would produce a new "profit
// factor dropped" every day for the same slide, and the list would become unreadable.
// Anything previously open and no longer detected is auto-resolved, so the page shows what is
// true now rather than everything that ever happened.
async function persist(found) {
  const keys = found.map(f => `${f.code}|${f.scope}`);
  let created = 0, refreshed = 0;

  for (const f of found) {
    const { rows } = await query(
      'SELECT id FROM anomalies WHERE code=$1 AND scope=$2 AND resolved_at IS NULL', [f.code, f.scope]
    );
    if (rows[0]) {
      await query(
        `UPDATE anomalies SET last_seen_at=now(), severity=$2, summary=$3, cause=$4, evidence=$5::jsonb WHERE id=$1`,
        [rows[0].id, f.severity, f.summary, f.cause, JSON.stringify(f.evidence)]
      );
      refreshed++;
    } else {
      await query(
        `INSERT INTO anomalies (code,scope,severity,summary,cause,evidence) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
        [f.code, f.scope, f.severity, f.summary, f.cause, JSON.stringify(f.evidence)]
      );
      created++;
    }
  }

  const { rows: open } = await query('SELECT id, code, scope FROM anomalies WHERE resolved_at IS NULL');
  const stale = open.filter(a => !keys.includes(`${a.code}|${a.scope}`));
  for (const a of stale) await query('UPDATE anomalies SET resolved_at=now() WHERE id=$1', [a.id]);

  return { created, refreshed, resolved: stale.length, open: found.length };
}

const pubAnomaly = (r) => ({
  id: Number(r.id), code: r.code, scope: r.scope, severity: r.severity,
  summary: r.summary, cause: r.cause || '', evidence: r.evidence || {},
  detectedAt: r.detected_at, lastSeenAt: r.last_seen_at, resolvedAt: r.resolved_at || null,
  ackedAt: r.acked_at || null, ackedBy: r.acked_by || null,
});

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

export async function listAnomalies({ status = 'open', limit = 50, offset = 0, severity = null, code = null } = {}) {
  const w = [], p = [];
  if (status === 'open') w.push('resolved_at IS NULL');
  else if (status === 'resolved') w.push('resolved_at IS NOT NULL');
  if (severity) { p.push(severity); w.push(`severity=$${p.length}`); }
  if (code) { p.push(code); w.push(`code=$${p.length}`); }
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const total = Number((await query(`SELECT count(*)::int AS n FROM anomalies ${where}`, p)).rows[0].n);
  p.push(limit, offset);
  const { rows } = await query(
    `SELECT * FROM anomalies ${where} ORDER BY detected_at DESC LIMIT $${p.length - 1} OFFSET $${p.length}`, p
  );
  // Severity ordering is applied after paging deliberately: paging by detection time keeps
  // the list stable as new findings arrive, and a page of 50 is small enough that sorting
  // within it is what the reader actually wants.
  const entries = rows.map(pubAnomaly).sort((a, b) => (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3));
  return { total, entries, undetectable: UNDETECTABLE };
}

export async function ackAnomaly(id, by) {
  await query('UPDATE anomalies SET acked_at=now(), acked_by=$2 WHERE id=$1 AND acked_at IS NULL', [id, by]);
  const { rows } = await query('SELECT * FROM anomalies WHERE id=$1', [id]);
  return rows[0] ? pubAnomaly(rows[0]) : null;
}
