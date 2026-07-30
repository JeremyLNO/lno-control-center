// Bots = (exchange, symbol) pairs, auto-created from detected positions. Assign to a fund.
//   GET                          -> bots (+ a "live" equity summary), requires ANY of
//                                    view_activity/view_realtime/view_trades — this single
//                                    endpoint backs the shared data layer used by all three
//                                    page families (see main.tsx's useData), so it can't
//                                    require one specific permission
//   GET ?attribution=1           -> per-bot/per-fund trade attribution (admin — BotsPage only)
//   GET ?costs=1                 -> per-bot/per-fund funding/fee drag  (admin — BotsPage only)
//   GET ?fills=1                 -> most recent executed trades         (view_realtime)
//   GET ?playbook=1[&strategy=]  -> strategy playbook + version history  (view_trades)
//   POST {action:'createStrategy'|'updateStrategy'|'deployVersion'|'reattribute'}
//                                -> playbook edits            (admin, or 'manage_strategies')
//   GET ?listenKey=1             -> mint/reuse a Binance user-data-stream listenKey,
//                                    for the browser to open its own real-time WebSocket (admin)
//   POST {action:'sync'}         -> run the position sync now  (admin, or 'manage_exchanges')
//   POST {action:'listenKeyKeepAlive'} -> extend the listenKey's 60min validity (admin)
//   PATCH {id, fundId}           -> assign/clear a bot's fund           (admin)
//   DELETE {id}                  -> remove a bot                        (admin)
import { query } from './_lib/db.js';
import { requireAuth, requireAdmin } from './_lib/auth.js';
import { syncExchanges } from './_lib/sync.js';
import { getAttribution, getCostAnalytics } from './_lib/attribution.js';
import { createListenKey, keepAliveListenKey } from './_lib/binance.js';
import { permsForRole } from './_lib/rolePerms.js';
import { audit } from './_lib/audit.js';
import { getPlaybook, createStrategy, updateStrategy, deployVersion, attributeTrades, evaluateExpectations, pubStrategy, pubVersion } from './_lib/strategies.js';

// The one Binance connection whose user-data stream we relay — a listenKey is 1:1 with a
// single API key, so with multiple exchange rows configured we pick the first usable one
// (same "primary account" simplification as everywhere else real-time isn't per-exchange).
async function primaryBinanceApiKey() {
  const { rows } = await query("SELECT api_key FROM exchanges WHERE lower(name)='binance' AND api_key <> '' ORDER BY id ASC LIMIT 1");
  return rows[0] ? rows[0].api_key : null;
}

const pub = (r) => ({
  id: r.id, exchange: r.exchange, symbol: r.symbol, fundId: r.fund_id || null,
  side: r.side, qty: Number(r.qty), entry: Number(r.entry), mark: Number(r.mark),
  unrealizedPnl: Number(r.unrealized_pnl), notional: Number(r.notional), leverage: Number(r.leverage),
  status: r.status, firstSeen: r.first_seen, lastSeen: r.last_seen,
  liquidationPrice: r.liquidation_price != null ? Number(r.liquidation_price) : null,
  maintMargin: r.maint_margin != null ? Number(r.maint_margin) : null,
  initialMargin: r.initial_margin != null ? Number(r.initial_margin) : null,
  lastChanged: r.last_changed,
});

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const a = requireAuth(req, res); if (!a) return;
      const isAdmin = a.role === 'admin';
      const has = async (p) => isAdmin || (await permsForRole(a.role)).includes(p);

      if (req.query?.attribution) { if (!isAdmin) return res.status(403).json({ error: 'forbidden' }); return res.status(200).json(await getAttribution()); }
      if (req.query?.costs) { if (!isAdmin) return res.status(403).json({ error: 'forbidden' }); return res.status(200).json(await getCostAnalytics()); }
      if (req.query?.fills) {
        if (!(await has('view_realtime'))) return res.status(403).json({ error: 'forbidden' });
        const { rows } = await query('SELECT * FROM fills ORDER BY occurred_at DESC LIMIT 50');
        return res.status(200).json({ fills: rows.map(r => ({
          symbol: r.symbol, side: r.side, qty: Number(r.qty), price: Number(r.price),
          realizedPnl: Number(r.realized_pnl), commission: Number(r.commission), occurredAt: r.occurred_at,
        })) });
      }
      // Strategy playbook. Folded into this endpoint rather than a new api/*.js file (Vercel
      // Hobby's 12-function cap is already reached) — and bots are what a strategy is attached
      // to, so this is its natural home.
      //   GET ?playbook=1[&strategy=<id>] -> strategies + version timeline + realised KPIs
      if (req.query?.playbook) {
        // Reading the playbook needs the same right as reading trade data: it is documentation
        // of what the bots do, not a privileged setting. Editing is gated separately on POST.
        if (!(await has('view_trades'))) return res.status(403).json({ error: 'forbidden' });
        const pb = await getPlaybook(req.query.strategy || null);
        return res.status(200).json({
          strategies: pb.strategies.map(s => ({ ...s, expectations: evaluateExpectations(s.expectedKpis, s.overall) })),
        });
      }
      if (req.query?.listenKey) {
        const adm = requireAdmin(req, res); if (!adm) return;
        const apiKey = await primaryBinanceApiKey();
        if (!apiKey) return res.status(200).json({ listenKey: null });
        try { const listenKey = await createListenKey(apiKey); return res.status(200).json({ listenKey, wsUrl: `wss://fstream.binance.com/ws/${listenKey}` }); }
        catch (e) { return res.status(502).json({ error: String(e.message || e) }); }
      }
      if (!isAdmin && !(await has('view_activity')) && !(await has('view_realtime')) && !(await has('view_trades'))) return res.status(403).json({ error: 'forbidden' });
      const { rows } = await query('SELECT * FROM bots ORDER BY exchange ASC, symbol ASC');
      const cfg = await query("SELECT value FROM app_config WHERE key='live'");
      return res.status(200).json({ bots: rows.map(pub), live: cfg.rows[0] ? cfg.rows[0].value : null });
    }

    if (req.method === 'POST') {
      if (req.body?.action === 'sync') {
        const a = requireAuth(req, res); if (!a) return;
        if (a.role !== 'admin' && !(await permsForRole(a.role)).includes('manage_exchanges')) return res.status(403).json({ error: 'forbidden' });
        return res.status(200).json({ ok: true, ...(await syncExchanges()) });
      }
      // Playbook mutations: admin, or a role holding 'manage_strategies'. Deliberately a
      // separate right from 'manage_exchanges' — declaring what a bot is allowed to trade and
      // what risk it may take is a trading-desk decision, not an infrastructure one.
      const PLAYBOOK_ACTIONS = new Set(['createStrategy', 'updateStrategy', 'deployVersion', 'reattribute']);
      if (PLAYBOOK_ACTIONS.has(req.body?.action)) {
        const auth = requireAuth(req, res); if (!auth) return;
        if (auth.role !== 'admin' && !(await permsForRole(auth.role)).includes('manage_strategies')) {
          return res.status(403).json({ error: 'forbidden' });
        }
        try {
          if (req.body.action === 'createStrategy') {
            const s = await createStrategy(req.body);
            await audit(req, auth, 'strategy.create', s.id, { name: s.name, botId: s.bot_id });
            return res.status(200).json({ strategy: pubStrategy(s) });
          }
          if (req.body.action === 'updateStrategy') {
            if (!req.body.id) return res.status(400).json({ error: 'id required' });
            const s = await updateStrategy(req.body.id, req.body);
            if (!s) return res.status(404).json({ error: 'strategy not found' });
            // Re-attribute: changing which bot a strategy covers changes which trades are its.
            if (req.body.botId !== undefined) await attributeTrades();
            await audit(req, auth, 'strategy.update', s.id, { name: s.name });
            return res.status(200).json({ strategy: pubStrategy(s) });
          }
          if (req.body.action === 'deployVersion') {
            const v = await deployVersion(req.body.strategyId, { ...req.body, by: auth.username || auth.id });
            await audit(req, auth, 'strategy.deploy', req.body.strategyId, { label: v.label, deployedAt: v.deployed_at });
            return res.status(200).json({ version: pubVersion(v) });
          }
          return res.status(200).json(await attributeTrades());
        } catch (e) {
          return res.status(400).json({ error: String(e.message || e) });
        }
      }
      const a = requireAdmin(req, res); if (!a) return;
      if (req.body?.action === 'listenKeyKeepAlive') {
        const apiKey = await primaryBinanceApiKey();
        if (!apiKey) return res.status(200).json({ ok: false, skipped: 'no-exchange' });
        try { await keepAliveListenKey(apiKey); return res.status(200).json({ ok: true }); }
        catch (e) { return res.status(502).json({ error: String(e.message || e) }); }
      }
      return res.status(400).json({ error: 'unknown action' });
    }

    if (req.method === 'PATCH') {
      const a = requireAdmin(req, res); if (!a) return;
      const { id, fundId } = req.body || {};
      if (!id) return res.status(400).json({ error: 'id required' });
      if (fundId) { const f = await query('SELECT 1 FROM funds WHERE id=$1', [fundId]); if (!f.rows[0]) return res.status(400).json({ error: 'fund not found' }); }
      await query('UPDATE bots SET fund_id=$2 WHERE id=$1', [id, fundId || null]);
      const { rows } = await query('SELECT * FROM bots WHERE id=$1', [id]);
      if (!rows[0]) return res.status(404).json({ error: 'bot not found' });
      return res.status(200).json({ bot: pub(rows[0]) });
    }

    if (req.method === 'DELETE') {
      const a = requireAdmin(req, res); if (!a) return;
      const id = req.body?.id || req.query?.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      await query('DELETE FROM bots WHERE id=$1', [id]);
      return res.status(200).json({ ok: true });
    }

    res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
