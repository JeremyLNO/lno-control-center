// Position sync: read open positions from each connected Binance (futures) account and
// reflect them as bots. A new (exchange, symbol) pair becomes a new, unassigned bot.
// Runs daily (cron) and on demand (manual "Sync now").
import { query } from './db.js';
import { decrypt } from './crypto.js';
import { getPositions, getAccountEquity } from './binance.js';

export async function syncExchanges() {
  const { rows: exs } = await query(
    "SELECT * FROM exchanges WHERE lower(name)='binance' AND api_key <> '' AND api_secret_enc IS NOT NULL"
  );
  const existing = new Set((await query('SELECT id FROM bots')).rows.map(r => r.id));
  const seen = [];
  let connected = 0, created = 0, updated = 0, positions = 0, totalEquity = 0, errors = 0;
  const errorMsgs = [];
  // record the failure on the exchange (status + message) and collect it for the caller
  const fail = async (ex, msg) => {
    errors++; errorMsgs.push(`${ex.label || ex.name}: ${msg}`);
    await query('UPDATE exchanges SET status=$2, last_error=$3 WHERE id=$1', [ex.id, 'error', String(msg).slice(0, 400)]);
  };

  for (const ex of exs) {
    let secret; try { secret = decrypt(ex.api_secret_enc); } catch (e) { await fail(ex, 'Stored API secret could not be decrypted — re-enter it.'); continue; }
    let pos, acct;
    try { [pos, acct] = await Promise.all([getPositions(ex.api_key, secret), getAccountEquity(ex.api_key, secret)]); }
    catch (e) { await fail(ex, (e && e.code ? `[${e.code}] ` : '') + String((e && e.message) || e)); continue; }

    connected++; totalEquity += acct.equity; positions += pos.length;
    await query('UPDATE exchanges SET status=$2, last_sync=$3, last_error=NULL WHERE id=$1', [ex.id, 'connected', Date.now()]);

    for (const p of pos) {
      const id = `binance:${p.symbol}`; seen.push(id);
      await query(
        `INSERT INTO bots (id,exchange,symbol,side,qty,entry,mark,unrealized_pnl,notional,leverage,status,first_seen,last_seen)
         VALUES ($1,'binance',$2,$3,$4,$5,$6,$7,$8,$9,'open',now(),now())
         ON CONFLICT (id) DO UPDATE SET
           side=$3, qty=$4, entry=$5, mark=$6, unrealized_pnl=$7, notional=$8, leverage=$9, status='open', last_seen=now()`,
        [id, p.symbol, p.side, p.qty, p.entry, p.mark, p.unrealizedPnl, p.notional, p.leverage]
      );
      if (existing.has(id)) updated++; else created++;
    }
  }

  // any previously-open Binance bot no longer reported is now flat
  if (connected) {
    if (seen.length) await query(`UPDATE bots SET status='closed', qty=0, unrealized_pnl=0, notional=0, last_seen=now()
                                  WHERE exchange='binance' AND status='open' AND NOT (id = ANY($1))`, [seen]);
    else await query(`UPDATE bots SET status='closed', qty=0, unrealized_pnl=0, notional=0, last_seen=now()
                      WHERE exchange='binance' AND status='open'`);
  }

  // cache a "live" summary for the dashboard (current equity without recomputation)
  const live = { equity: Math.round(totalEquity), positions, connected, syncedAt: Date.now() };
  await query(`INSERT INTO app_config (key,value) VALUES ('live',$1::jsonb)
               ON CONFLICT (key) DO UPDATE SET value=$1::jsonb`, [JSON.stringify(live)]);

  return { connected, created, updated, positions, errors, errorMsgs, totalEquity: Math.round(totalEquity) };
}
