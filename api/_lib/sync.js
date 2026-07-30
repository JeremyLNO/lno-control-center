// Position sync: read open positions from each connected Binance (futures) account and
// reflect them as bots. A new (exchange, symbol) pair becomes a new, unassigned bot.
// Runs daily (cron) and on demand (manual "Sync now").
import { query } from './db.js';
import { decrypt } from './crypto.js';
import { getPositions, getAccountEquity, getIncome, getUserTrades } from './binance.js';
import { migrate } from './schema.js';
import { detectFundContributions } from './employeeFund.js';
import { notify, getUsersByRole, rolesForType, getOpenWAConfig } from './notify.js';
import { apiErrorText } from './notifyText.js';
import { sendApiErrorEmail } from './mailer.js';
import { rebuildTrades } from './trades.js';
import { attributeTrades } from './strategies.js';
import { syncOrders, attachOrderMetrics } from './orders.js';

const INCOME_TYPES = new Set(['REALIZED_PNL', 'FUNDING_FEE', 'COMMISSION']);

export async function syncExchanges() {
  // Idempotent — self-heals the schema (new bots columns, etc.) on the very next sync
  // (manual "Sync now" or the daily cron) without needing the gated /api/init endpoint.
  await migrate();
  const { rows: exs } = await query(
    "SELECT * FROM exchanges WHERE lower(name)='binance' AND api_key <> '' AND api_secret_enc IS NOT NULL"
  );
  const existing = new Set((await query('SELECT id FROM bots')).rows.map(r => r.id));
  // previous "live" snapshot — the baseline detectFundContributions() compares this sync's
  // wallet balance against, to catch a real capital addition (see below).
  const prevLive = (await query("SELECT value FROM app_config WHERE key='live'")).rows[0]?.value || null;
  const seen = [];
  let connected = 0, created = 0, updated = 0, positions = 0, totalEquity = 0, totalWallet = 0, errors = 0, deltaIncome = 0;
  const errorMsgs = [];
  // record the failure on the exchange (status + message) and collect it for the caller —
  // and, on a FRESH failure only (was not already status='error'), alert admins/operators
  // immediately by email + WhatsApp. Gated on the transition so an ongoing outage doesn't
  // re-alert every ~5 minutes for as long as it lasts (the alerts-only cron runs that often).
  const fail = async (ex, msg) => {
    errors++; errorMsgs.push(`${ex.label || ex.name}: ${msg}`);
    const wasAlreadyError = ex.status === 'error';
    await query('UPDATE exchanges SET status=$2, last_error=$3 WHERE id=$1', [ex.id, 'error', String(msg).slice(0, 400)]);
    if (!wasAlreadyError) {
      const label = ex.label || ex.name;
      // System Status's alert-history table (start/end/duration) — closed automatically on
      // the next successful sync (see below), no human ACK needed for this type.
      try {
        const code = Math.random().toString(36).slice(2, 6).toUpperCase();
        await query("INSERT INTO alerts (type,code,summary,exchange_id) VALUES ('api_error',$1,$2,$3)", [code, `${label}: ${msg}`.slice(0, 400), ex.id]);
      } catch (e) {}
      try { await notify((lang) => apiErrorText(lang, label, msg), { type: 'api_error' }); } catch (e) {}
      try {
        const cfg = await getOpenWAConfig();
        const roles = await rolesForType(cfg, 'api_error');
        const recipients = await getUsersByRole(roles);
        for (const r of recipients) await sendApiErrorEmail(r.email, label, msg).catch(() => {});
      } catch (e) {}
    }
  };

  for (const ex of exs) {
    let secret; try { secret = decrypt(ex.api_secret_enc); } catch (e) { await fail(ex, 'Stored API secret could not be decrypted — re-enter it.'); continue; }
    let pos, acct, latencyMs;
    const t0 = Date.now();
    try { [pos, acct] = await Promise.all([getPositions(ex.api_key, secret), getAccountEquity(ex.api_key, secret)]); latencyMs = Date.now() - t0; }
    catch (e) { await fail(ex, (e && e.code ? `[${e.code}] ` : '') + String((e && e.message) || e)); continue; }

    connected++; totalEquity += acct.equity; totalWallet += acct.walletBalance; positions += pos.length;
    await query('UPDATE exchanges SET status=$2, last_sync=$3, last_error=NULL, latency_ms=$4 WHERE id=$1', [ex.id, 'connected', Date.now(), latencyMs]);
    // recovery — close out any still-open api_error alert for this exchange so its "end"
    // and duration are recorded in the System Status alert history
    if (ex.status === 'error') {
      try { await query("UPDATE alerts SET acked_at=now(), acked_by='system' WHERE type='api_error' AND exchange_id=$1 AND acked_at IS NULL", [ex.id]); } catch (e) {}
    }

    for (const p of pos) {
      const id = `binance:${p.symbol}`; seen.push(id);
      const m = acct.margins[p.symbol] || {};
      await query(
        `INSERT INTO bots (id,exchange,symbol,side,qty,entry,mark,unrealized_pnl,notional,leverage,status,first_seen,last_seen,liquidation_price,maint_margin,initial_margin,last_changed)
         VALUES ($1,'binance',$2,$3,$4,$5,$6,$7,$8,$9,'open',now(),now(),$10,$11,$12,now())
         ON CONFLICT (id) DO UPDATE SET
           side=$3, qty=$4, entry=$5, mark=$6, unrealized_pnl=$7, notional=$8, leverage=$9, status='open', last_seen=now(),
           liquidation_price=$10, maint_margin=$11, initial_margin=$12,
           last_changed = CASE WHEN bots.side IS DISTINCT FROM $3 OR bots.qty IS DISTINCT FROM $4 OR bots.entry IS DISTINCT FROM $5
                           THEN now() ELSE bots.last_changed END`,
        [id, p.symbol, p.side, p.qty, p.entry, p.mark, p.unrealizedPnl, p.notional, p.leverage,
         p.liquidationPrice, m.maintMargin ?? null, m.initialMargin ?? null]
      );
      if (existing.has(id)) updated++; else created++;
    }

    // Income history (realized PnL / funding / commission) — incremental: resume from the
    // latest recorded event, or backfill the last 7 days on the very first sync. A single
    // page (limit 1000) per sync; fine for normal trading volume, not a full 3-month replay.
    try {
      const cursor = (await query("SELECT MAX(occurred_at) AS t FROM income_events WHERE exchange='binance'")).rows[0].t;
      const startTime = cursor ? new Date(cursor).getTime() + 1 : Date.now() - 7 * 86400000;
      const income = await getIncome(ex.api_key, secret, { startTime });
      for (const inc of income) {
        if (!INCOME_TYPES.has(inc.incomeType)) continue;
        await query(
          `INSERT INTO income_events (tran_id,exchange,symbol,income_type,income,occurred_at)
           VALUES ($1,'binance',$2,$3,$4,to_timestamp($5/1000.0)) ON CONFLICT (tran_id) DO NOTHING`,
          [inc.tranId, inc.symbol, inc.incomeType, inc.income, inc.time]
        );
        deltaIncome += Number(inc.income);
      }
    } catch (e) { /* best-effort — a failed income fetch shouldn't break the position sync */ }

    // Recent Fills / Trade Stream / Order Flow (Live page) — real executed trades, one
    // symbol at a time (futures' userTrades has no all-symbols call, unlike income/
    // positions). Scope to symbols that matter right now: currently open, or closed within
    // the last day (catches a just-closed position's final fills) — not every symbol ever
    // traded, which would grow unbounded. Each symbol resumes from its own MAX(trade_id);
    // first-ever sync for a symbol just grabs its most recent page (no full backfill).
    try {
      const recentlyClosed = (await query(
        "SELECT DISTINCT symbol FROM bots WHERE exchange='binance' AND status='closed' AND last_seen > now() - interval '1 day'"
      )).rows.map(r => r.symbol);
      const fillSymbols = [...new Set([...pos.map(p => p.symbol), ...recentlyClosed])];
      await Promise.all(fillSymbols.map(async symbol => {
        try {
          const cursor = (await query('SELECT MAX(trade_id) AS id FROM fills WHERE exchange=$1 AND symbol=$2', ['binance', symbol])).rows[0].id;
          const trades = await getUserTrades(ex.api_key, secret, { symbol, fromId: cursor != null ? Number(cursor) + 1 : undefined });
          for (const tr of trades) {
            await query(
              `INSERT INTO fills (exchange,symbol,trade_id,side,qty,price,realized_pnl,commission,occurred_at)
               VALUES ('binance',$1,$2,$3,$4,$5,$6,$7,to_timestamp($8/1000.0)) ON CONFLICT (exchange,symbol,trade_id) DO NOTHING`,
              [symbol, tr.tradeId, tr.side, tr.qty, tr.price, tr.realizedPnl, tr.commission, tr.time]
            );
          }
        } catch (e) { /* best-effort per symbol — one bad symbol shouldn't drop the rest */ }
      }));
    } catch (e) { /* best-effort — a failed fills fetch shouldn't break the position sync */ }

    // Orders, over the same symbol scope. A fill says what executed; an order says what was
    // asked for — which is the only source for slippage, cancellations and the resting stop's
    // risk. Separate try: a key without order-read permission must not cost us the fills.
    try {
      const recentlyClosed = (await query(
        "SELECT DISTINCT symbol FROM bots WHERE exchange='binance' AND status='closed' AND last_seen > now() - interval '1 day'"
      )).rows.map(r => r.symbol);
      await syncOrders({ apiKey: ex.api_key, secret, symbols: [...new Set([...pos.map(p => p.symbol), ...recentlyClosed])] });
    } catch (e) { /* best-effort — orders are enrichment, not the backbone */ }
  }

  // Fold the (possibly newly extended) fill stream into round-trip trades — the dataset every
  // analytics surface reads. Runs after the fills loop above so a position that just closed is
  // materialised as a completed trade in the same pass. Incremental and idempotent; best-effort
  // because a reconstruction failure must not cost us the position sync itself.
  try { await rebuildTrades(); await attributeTrades(); await attachOrderMetrics(); }
  catch (e) { /* best-effort — analytics can be rebuilt on the next sync */ }

  // any previously-open Binance bot no longer reported is now flat
  if (connected) {
    if (seen.length) await query(`UPDATE bots SET status='closed', qty=0, unrealized_pnl=0, notional=0, last_seen=now()
                                  WHERE exchange='binance' AND status='open' AND NOT (id = ANY($1))`, [seen]);
    else await query(`UPDATE bots SET status='closed', qty=0, unrealized_pnl=0, notional=0, last_seen=now()
                      WHERE exchange='binance' AND status='open'`);
  }

  // Employee Fund contribution detection — only meaningful sync-to-sync (both sides need a
  // real previous wallet balance to diff against), so skip the very first sync ever and any
  // sync following a fully-disconnected one (nothing to compare against).
  if (connected > 0 && prevLive && prevLive.connected > 0 && typeof prevLive.walletBalance === 'number') {
    try { await detectFundContributions({ prevWalletBalance: prevLive.walletBalance, newWalletBalance: totalWallet, deltaIncome }); }
    catch (e) { /* best-effort — a detection failure shouldn't break the position sync */ }
  }

  // cache a "live" summary for the dashboard (current equity without recomputation).
  // walletBalance is kept alongside equity so the Status page can reconcile: equity should
  // equal walletBalance + the sum of open bots' unrealized PnL (both stored from this same
  // sync pass) — a mismatch beyond a small tolerance means the two drifted apart (e.g. a
  // partial sync failure on one exchange in a multi-exchange setup).
  const live = { equity: Math.round(totalEquity), walletBalance: Math.round(totalWallet), positions, connected, syncedAt: Date.now() };
  await query(`INSERT INTO app_config (key,value) VALUES ('live',$1::jsonb)
               ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`, [JSON.stringify(live)]);

  return { connected, created, updated, positions, errors, errorMsgs, totalEquity: Math.round(totalEquity) };
}
