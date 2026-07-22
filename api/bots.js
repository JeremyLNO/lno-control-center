// Bots = (exchange, symbol) pairs, auto-created from detected positions. Assign to a fund.
//   GET                          -> bots (+ a "live" equity summary)   (any auth)
//   GET ?attribution=1           -> per-bot/per-fund trade attribution (any auth)
//   GET ?costs=1                 -> per-bot/per-fund funding/fee drag  (any auth)
//   GET ?fills=1                 -> most recent executed trades         (any auth)
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
      if (req.query?.attribution) return res.status(200).json(await getAttribution());
      if (req.query?.costs) return res.status(200).json(await getCostAnalytics());
      if (req.query?.fills) {
        const { rows } = await query('SELECT * FROM fills ORDER BY occurred_at DESC LIMIT 50');
        return res.status(200).json({ fills: rows.map(r => ({
          symbol: r.symbol, side: r.side, qty: Number(r.qty), price: Number(r.price),
          realizedPnl: Number(r.realized_pnl), commission: Number(r.commission), occurredAt: r.occurred_at,
        })) });
      }
      if (req.query?.listenKey) {
        const adm = requireAdmin(req, res); if (!adm) return;
        const apiKey = await primaryBinanceApiKey();
        if (!apiKey) return res.status(200).json({ listenKey: null });
        try { const listenKey = await createListenKey(apiKey); return res.status(200).json({ listenKey, wsUrl: `wss://fstream.binance.com/ws/${listenKey}` }); }
        catch (e) { return res.status(502).json({ error: String(e.message || e) }); }
      }
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
