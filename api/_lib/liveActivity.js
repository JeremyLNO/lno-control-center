// Live Activity push — keeps the iOS Lock Screen card fresh while the app is closed.
//
// The card is started by the app (ActivityKit), which hands its update token to OneSignal;
// OneSignal fronts APNs so nothing here has to sign JWTs or speak HTTP/2. We address the
// activity by a single shared id ("positions"), so ONE call updates every admin's card.
//
// The payload is the Swift `PositionsActivityAttributes.ContentState`, key for key. Anything
// that drifts from that struct is silently dropped by ActivityKit on the device, so the shape
// below is a contract, not a convenience.
import { query } from './db.js';

const ACTIVITY_ID = 'positions';
const SIG_KEY = 'liveActivitySig';

// Same bands as Bot.liqLevel on iOS and liqInfo() on the web — three copies of one rule is
// already one too many, so keep this in step if the thresholds ever move.
function riskOf(bots) {
  let worst = 'ok';
  for (const b of bots) {
    const liq = Number(b.liquidation_price || 0), mark = Number(b.mark || 0);
    if (!liq || !mark) continue;
    const pct = (Math.abs(mark - liq) / mark) * 100;
    if (pct < 10) return 'danger';
    if (pct < 25) worst = 'warn';
  }
  return worst;
}

/// Mirrors LiveActivityController.state(from:) exactly — same counts, same P&L, same trail.
export function buildLiveActivityState(bots, equitySeries) {
  const open = bots.filter(b => b.status === 'open');
  const isLong = (b) => String(b.side || '').toLowerCase() === 'long' || String(b.side || '').toLowerCase() === 'buy';
  return {
    openCount: open.length,
    longCount: open.filter(isLong).length,
    shortCount: open.filter(b => !isLong(b)).length,
    unrealizedPnl: Math.round(open.reduce((a, b) => a + Number(b.unrealized_pnl || 0), 0) * 100) / 100,
    risk: riskOf(open),
    spark: (equitySeries || []).slice(-30).map(v => Math.round(Number(v) * 100) / 100),
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

/// Push an update, unless nothing meaningful changed.
///
/// The dedup is not an optimisation: Apple RATE-LIMITS Live Activity updates, and this cron
/// runs every 5 minutes. Re-sending an identical card would spend that budget on nothing and
/// leave none for the update that actually matters. `updatedAt` is excluded from the
/// signature for exactly that reason — it changes every run by definition.
export async function pushLiveActivity(state, { fetchImpl = fetch } = {}) {
  const appId = process.env.ONESIGNAL_APP_ID, key = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !key) return { skipped: 'not configured' };

  const { updatedAt, ...material } = state;
  const sig = JSON.stringify(material);
  const prev = (await query("SELECT value FROM app_config WHERE key=$1", [SIG_KEY])).rows[0]?.value;
  if (prev && prev.sig === sig) return { skipped: 'unchanged' };

  // An empty book has no card to update — the app ends the activity instead.
  if (!state.openCount) {
    await query(`INSERT INTO app_config (key,value) VALUES ($1,$2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value=$2::jsonb`, [SIG_KEY, JSON.stringify({ sig })]);
    return { skipped: 'no open positions' };
  }

  // Bounded like every other outbound call on a cron path: no timeout means a hang, not a
  // failure, and a hang holds the whole cron request open.
  const res = await fetchImpl(`https://api.onesignal.com/apps/${appId}/live_activities/${ACTIVITY_ID}/notifications`, {
    signal: AbortSignal.timeout(8000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Key ${key}` },
    body: JSON.stringify({ event: 'update', event_updates: state, name: 'positions-update' }),
  });
  const body = await res.text().catch(() => '');
  if (!res.ok) return { error: `onesignal ${res.status}`, detail: body.slice(0, 200) };

  await query(`INSERT INTO app_config (key,value) VALUES ($1,$2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=$2::jsonb`, [SIG_KEY, JSON.stringify({ sig })]);
  return { pushed: true, openCount: state.openCount };
}
