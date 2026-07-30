// Schema creation + idempotent seed of defaults.
import { query } from './db.js';
import { hashPassword } from './auth.js';
import { ROLE_PERMS, DEFAULT_USERS, DEFAULT_OPENWA } from './constants.js';
import { invalidateRolePermsCache } from './rolePerms.js';

// migrate() can be called from several concurrent requests (e.g. My Equity fires two API
// calls in parallel, each of which self-heals the schema). On a real multi-connection
// Postgres (Neon — unlike the single-process PGlite used in local dev/tests), two
// concurrent "CREATE TABLE IF NOT EXISTS <same table>" can both pass the existence check
// before either commits, then collide on Postgres's internal pg_type catalog (error 23505,
// unique_violation). That collision means the object was already being created by the other
// concurrent call — i.e. the schema ends up fine either way — so it's safe to ignore.
async function ddl(sql) {
  try { await query(sql); }
  catch (e) { if (e && e.code === '23505') return; throw e; }
}

export async function migrate() {
  await ddl(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'viewer',
    active BOOLEAN NOT NULL DEFAULT true,
    permissions JSONB NOT NULL DEFAULT '[]',
    avatar TEXT,
    phone TEXT DEFAULT '',
    notify BOOLEAN NOT NULL DEFAULT false,
    password_hash TEXT NOT NULL,
    failed_attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  // how each account authenticates ('password' | 'google'); added idempotently for existing DBs
  await ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password'`);
  // login audit: last sign-in time + IP, last-seen (for the online indicator)
  await ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`);
  await ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip TEXT`);
  await ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);
  // brute-force lockout: account is locked from password login until this time
  await ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`);
  // UI language ('en'|'fr'|'de'|'es'); NULL = not chosen yet, client falls back to the
  // browser's language. Once set (via Profile or the sidebar switcher) it's the user's
  // default everywhere they sign in — the Control Center web app and the iOS app both read
  // this same field from the shared account, and reports/WhatsApp alerts are sent in it.
  await ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT`);
  // legacy per-user WhatsApp api key column — unused since the switch to TextMeBot's single
  // firm-wide account key; kept (not dropped) for backward compatibility.
  await ddl(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_apikey TEXT`);
  // log of every WhatsApp message sent (admin-only view on the WhatsApp page)
  await ddl(`CREATE TABLE IF NOT EXISTS wa_log (
    id BIGSERIAL PRIMARY KEY,
    phone TEXT,
    message TEXT,
    ok BOOLEAN NOT NULL DEFAULT false,
    status INT,
    response TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  // funds are GLOBAL entities (name + colour); a bot is assigned to a fund via bots.fund_id
  await ddl(`CREATE TABLE IF NOT EXISTS funds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    bots JSONB NOT NULL DEFAULT '[]',
    sort INT NOT NULL DEFAULT 0
  )`);
  // a bot = one (exchange, symbol) pair, created automatically when a position is detected.
  // It must be assigned to a fund (fund_id). Position fields reflect the latest sync.
  await ddl(`CREATE TABLE IF NOT EXISTS bots (
    id TEXT PRIMARY KEY,
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    fund_id TEXT,
    side TEXT,
    qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    entry DOUBLE PRECISION NOT NULL DEFAULT 0,
    mark DOUBLE PRECISION NOT NULL DEFAULT 0,
    unrealized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
    notional DOUBLE PRECISION NOT NULL DEFAULT 0,
    leverage DOUBLE PRECISION NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    first_seen TIMESTAMPTZ DEFAULT now(),
    last_seen TIMESTAMPTZ DEFAULT now()
  )`);
  // liquidation price + maintenance/initial margin (from Binance positionRisk + account
  // endpoints) — power the "distance to liquidation" / margin-health risk view.
  await ddl(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS liquidation_price DOUBLE PRECISION`);
  await ddl(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS maint_margin DOUBLE PRECISION`);
  await ddl(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS initial_margin DOUBLE PRECISION`);
  // last time this position's side/qty/entry actually changed (vs. just being re-seen by a
  // sync) — powers "dormant bot" detection (a position sitting untouched for too long may
  // mean the strategy behind it has gone silent).
  await ddl(`ALTER TABLE bots ADD COLUMN IF NOT EXISTS last_changed TIMESTAMPTZ DEFAULT now()`);
  await ddl(`CREATE TABLE IF NOT EXISTS exchanges (
    id TEXT PRIMARY KEY,
    name TEXT,
    label TEXT,
    api_key TEXT,
    api_secret_enc TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_sync BIGINT,
    note TEXT DEFAULT ''
  )`);
  // last sync error message (shown on the Exchanges page when status='error')
  await ddl(`ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS last_error TEXT`);
  // public wallet/deposit addresses shown on the Exchanges page (not secret — no encryption)
  await ddl(`ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS wallets JSONB NOT NULL DEFAULT '[]'::jsonb`);
  // round-trip latency (ms) of the last successful sync's Binance calls — surfaced as
  // "Exchange Connectivity" on the Status and Live pages
  await ddl(`ALTER TABLE exchanges ADD COLUMN IF NOT EXISTS latency_ms INTEGER`);
  await ddl(`CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'
  )`);
  // Realized PnL / funding / commission history (from Binance's income endpoint) — the real
  // "did this trade win or lose" record, distinct from a currently-open position's unrealized
  // PnL. Powers per-bot performance attribution + funding/fee drag analytics. tran_id dedupes
  // (income events are immutable once recorded, so ON CONFLICT DO NOTHING is enough).
  await ddl(`CREATE TABLE IF NOT EXISTS income_events (
    tran_id TEXT PRIMARY KEY,
    exchange TEXT NOT NULL,
    symbol TEXT,
    income_type TEXT NOT NULL,
    income DOUBLE PRECISION NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL
  )`);
  await ddl(`CREATE INDEX IF NOT EXISTS income_events_symbol_idx ON income_events (symbol)`);
  // Real account fills (executed trades), fetched incrementally per symbol from Binance's
  // userTrades endpoint — see api/_lib/sync.js. Powers "Recent Fills"/"Trade Stream"/"Order
  // Flow" on the Live page. trade_id is Binance's own id, unique per (exchange,symbol); the
  // composite PK dedupes across syncs (ON CONFLICT DO NOTHING, fills are immutable once
  // recorded) and also serves as the resume cursor — MAX(trade_id) for a symbol.
  await ddl(`CREATE TABLE IF NOT EXISTS fills (
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    trade_id BIGINT NOT NULL,
    side TEXT NOT NULL,
    qty DOUBLE PRECISION NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    realized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
    commission DOUBLE PRECISION NOT NULL DEFAULT 0,
    occurred_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (exchange, symbol, trade_id)
  )`);
  await ddl(`CREATE INDEX IF NOT EXISTS fills_occurred_idx ON fills (occurred_at DESC)`);
  // Round trips reconstructed from `fills` (see api/_lib/trades.js) — "one completed trade"
  // as a human means it, which neither `fills` (individual executions) nor `bots` (current
  // position state) records. Every analytics surface reads from here so a win rate can't
  // differ between two pages. Derived data: safe to DELETE and rebuild at any time.
  // open_trade_id (the trade_id of the round trip's first fill) makes the PK deterministic,
  // so a rebuild upserts in place instead of duplicating.
  await ddl(`CREATE TABLE IF NOT EXISTS trades (
    exchange TEXT NOT NULL,
    symbol TEXT NOT NULL,
    open_trade_id BIGINT NOT NULL,
    close_trade_id BIGINT,
    direction TEXT NOT NULL,
    qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    entry_price DOUBLE PRECISION,
    exit_price DOUBLE PRECISION,
    gross_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
    commission DOUBLE PRECISION NOT NULL DEFAULT 0,
    funding DOUBLE PRECISION NOT NULL DEFAULT 0,
    net_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    duration_s INTEGER,
    entry_hour SMALLINT,
    entry_dow SMALLINT,
    fill_count INT NOT NULL DEFAULT 0,
    fund_id TEXT,
    leverage DOUBLE PRECISION,
    PRIMARY KEY (exchange, symbol, open_trade_id)
  )`);
  await ddl(`CREATE INDEX IF NOT EXISTS trades_closed_idx ON trades (closed_at DESC)`);
  await ddl(`CREATE INDEX IF NOT EXISTS trades_symbol_idx ON trades (symbol)`);
  // Strategy playbook: the DECLARED intent behind a bot — what it is supposed to do, on what,
  // within what limits. None of this can be derived from exchange data (the exchange only
  // reports what happened, never what was intended), so it is operator-authored and is the
  // reference a live result gets judged against.
  await ddl(`CREATE TABLE IF NOT EXISTS strategies (
    id TEXT PRIMARY KEY,
    bot_id TEXT,
    name TEXT NOT NULL,
    objective TEXT DEFAULT '',
    entry_rules TEXT DEFAULT '',
    exit_rules TEXT DEFAULT '',
    allowed_symbols JSONB NOT NULL DEFAULT '[]'::jsonb,
    allowed_timeframes JSONB NOT NULL DEFAULT '[]'::jsonb,
    risk_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    disable_conditions TEXT DEFAULT '',
    expected_kpis JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  // One row per deployed revision of a strategy's code/parameters. [deployed_at, retired_at)
  // are kept NON-OVERLAPPING by the deploy path (deploying retires the previous version at the
  // same instant), which is what makes attributing a trade to exactly one version unambiguous.
  await ddl(`CREATE TABLE IF NOT EXISTS strategy_versions (
    id BIGSERIAL PRIMARY KEY,
    strategy_id TEXT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    retired_at TIMESTAMPTZ,
    changes TEXT DEFAULT '',
    params JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await ddl(`CREATE INDEX IF NOT EXISTS strategy_versions_win_idx ON strategy_versions (strategy_id, deployed_at DESC)`);
  // Attribution of a reconstructed trade to the version that was live when it OPENED (not when
  // it closed — the entry is what the strategy decided). Nullable: trades predating any
  // declared version stay unattributed rather than being forced onto the oldest one.
  await ddl(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_id TEXT`);
  await ddl(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS strategy_version_id BIGINT`);
  // Maximum adverse / favourable excursion, in currency. Reconstructed from public klines on
  // first view of a trade (see api/_lib/tradeDetail.js) and cached here — no account endpoint
  // reports how far a position ran against you between entry and exit, so this is the only
  // way to tell a trade that went straight to +50 from one that was -400 underwater first.
  await ddl(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS mae DOUBLE PRECISION`);
  await ddl(`ALTER TABLE trades ADD COLUMN IF NOT EXISTS mfe DOUBLE PRECISION`);
  // Detected behavioural anomalies (see api/_lib/anomalies.js). Distinct from `alerts`:
  // an alert is a threshold being crossed right now (drawdown breach, exchange down), an
  // anomaly is a PATTERN in how a bot is behaving — its profit factor collapsing, its losses
  // concentrating on one asset, its trade frequency drifting. Each carries the evidence that
  // triggered it so a reader can judge the finding instead of trusting it.
  await ddl(`CREATE TABLE IF NOT EXISTS anomalies (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    scope TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    summary TEXT NOT NULL,
    cause TEXT DEFAULT '',
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    detected_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    resolved_at TIMESTAMPTZ,
    acked_at TIMESTAMPTZ,
    acked_by TEXT
  )`);
  // One OPEN anomaly per (code, scope): a condition that is still true must refresh the
  // existing finding rather than pile up a new row on every detection pass. Resolved rows are
  // exempt so the history of past occurrences is kept.
  await ddl(`CREATE UNIQUE INDEX IF NOT EXISTS anomalies_open_idx ON anomalies (code, scope) WHERE resolved_at IS NULL`);
  await ddl(`CREATE INDEX IF NOT EXISTS anomalies_detected_idx ON anomalies (detected_at DESC)`);
  // Employee Fund: each employee's capital contribution, recorded as a number of "units"
  // (mutual-fund-style unitisation — see api/_lib/employeeFund.js) rather than a flat euro
  // amount, so joining after the fund has already gained/lost value is priced fairly.
  await ddl(`CREATE TABLE IF NOT EXISTS employee_shares (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    fund_id TEXT NOT NULL,
    contributed_amount DOUBLE PRECISION NOT NULL DEFAULT 1000,
    units DOUBLE PRECISION NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  // A real, unexplained ~1000 USDT jump in the synced wallet balance (i.e. not accounted for
  // by realized PnL/funding/commission over the same sync) — detected during syncExchanges(),
  // queued here for an admin to assign to the specific employee it funds (see
  // api/_lib/employeeFund.js detectFundContributions()/assignContribution()).
  await ddl(`CREATE TABLE IF NOT EXISTS employee_fund_contributions (
    id BIGSERIAL PRIMARY KEY,
    detected_at TIMESTAMPTZ DEFAULT now(),
    amount DOUBLE PRECISION NOT NULL DEFAULT 1000,
    raw_delta DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'pending',
    assigned_user_id TEXT REFERENCES users(id),
    assigned_at TIMESTAMPTZ,
    assigned_by TEXT
  )`);
  // one row per day — real recorded equity history (written by the daily cron)
  await ddl(`CREATE TABLE IF NOT EXISTS equity_snapshots (
    day DATE PRIMARY KEY,
    equity BIGINT NOT NULL,
    pnl_day BIGINT NOT NULL DEFAULT 0,
    metrics JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  // one row per day — Employee Fund's mark-to-market value + NAV/unit (written by the daily
  // cron, mirroring equity_snapshots); resampled to weekly points (one per ISO week, Mon-Sun)
  // for the "My Equity" progression chart.
  await ddl(`CREATE TABLE IF NOT EXISTS employee_fund_snapshots (
    day DATE PRIMARY KEY,
    value DOUBLE PRECISION NOT NULL,
    total_contributed DOUBLE PRECISION NOT NULL DEFAULT 0,
    nav_per_unit DOUBLE PRECISION NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  // critical alerts that can be acknowledged (via WhatsApp reply or the UI)
  await ddl(`CREATE TABLE IF NOT EXISTS alerts (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    acked_at TIMESTAMPTZ,
    acked_by TEXT
  )`);
  // type: 'breach' | 'api_error' (System Status's alert-history table, filterable by type).
  // exchange_id: which exchange an 'api_error' alert is about, so a later successful sync
  // can auto-close it (acked_by='system') without a human ACK — that's how its "end" /
  // duration gets recorded, unlike 'breach' alerts which are only ever closed by a human.
  await ddl(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'breach'`);
  await ddl(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS exchange_id TEXT`);
  // sign-in audit trail (one row per successful login, with IP + method)
  await ddl(`CREATE TABLE IF NOT EXISTS login_events (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    ip TEXT,
    method TEXT NOT NULL DEFAULT 'password',
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  // admin-action audit trail (sensitive mutations: user/role/account, exchange + WhatsApp config)
  await ddl(`CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_id TEXT,
    actor_email TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail JSONB NOT NULL DEFAULT '{}',
    ip TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  // generated report archive (PDF kept as base64 so it can be re-downloaded)
  await ddl(`CREATE TABLE IF NOT EXISTS reports (
    id BIGSERIAL PRIMARY KEY,
    kind TEXT NOT NULL DEFAULT 'monthly',
    period_label TEXT NOT NULL,
    equity BIGINT NOT NULL DEFAULT 0,
    pnl BIGINT NOT NULL DEFAULT 0,
    pdf_base64 TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  // Verification workflow (Reports page) — a report must be 'verified' by an admin before
  // it can be sent/shown to shareholders (monthly reports are the only shareholder-facing
  // kind today). Admin-only kinds (daily) are auto-verified at generation, since no
  // shareholder is ever waiting on them.
  await ddl(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'not_verified'`);
  await ddl(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS verified_by TEXT`);
  await ddl(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ`);
  // One-time backfill: reports created before this feature shipped were already sent to
  // shareholders (the old auto-notify-on-generate behavior) — mark them verified rather
  // than surfacing years of history as "to verify". Date-gated so it's idempotent without
  // needing a separate migration-run flag; new rows after this date keep the real default.
  await ddl(`UPDATE reports SET status='verified', verified_by='system', verified_at=created_at
             WHERE status='not_verified' AND verified_by IS NULL AND created_at < '2026-07-22'::date`);
  // Emailed one-time login codes for 'otp' accounts (shareholders — see auth.js
  // requestOtp/verifyOtp). code_hash is SHA-256 of the 6-digit code peppered with
  // JWT_SECRET (not bcrypt — a 6-digit space is already small; the real protection is
  // expiry + attempts + rate-limited issuance, not hash cost).
  await ddl(`CREATE TABLE IF NOT EXISTS otp_codes (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await ddl(`CREATE INDEX IF NOT EXISTS otp_codes_user_idx ON otp_codes (user_id, created_at DESC)`);
  // One-time backfill: shareholders used to sign in with an admin-assigned password
  // (auth_provider='password'); they now sign in with an emailed code instead. Re-point
  // any account still on the old provider — idempotent, becomes a no-op after the first run.
  await ddl(`UPDATE users SET auth_provider='otp' WHERE role='shareholder' AND auth_provider='password'`);
  // One-time backfill: the single 'view_reports' permission was split into
  // view_reports_daily/weekly/monthly (Reports page rights are now per-periodicity). Any role
  // whose ADMIN-EDITED rolePerms (Rules page) still carries the old key gets the equivalent
  // daily+monthly access it had before (the two kinds actually archived) — otherwise their
  // customization would just silently vanish once rolePerms.js stops recognizing 'view_reports'
  // as a valid permission. Idempotent: a no-op once no role's saved perms mention the old key.
  try {
    const { rows } = await query(`SELECT value FROM app_config WHERE key='rolePerms'`);
    const stored = rows[0]?.value;
    if (stored && typeof stored === 'object') {
      let changed = false;
      const next = {};
      for (const [role, perms] of Object.entries(stored)) {
        if (Array.isArray(perms) && perms.includes('view_reports')) {
          changed = true;
          next[role] = [...new Set([...perms.filter(p => p !== 'view_reports'), 'view_reports_daily', 'view_reports_monthly'])];
        } else {
          next[role] = perms;
        }
      }
      if (changed) {
        await query(`UPDATE app_config SET value=$1::jsonb WHERE key='rolePerms'`, [JSON.stringify(next)]);
        invalidateRolePermsCache();
      }
    }
  } catch (e) { /* app_config/rolePerms not present yet on a fresh install — nothing to migrate */ }
}

export async function seedIfEmpty() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return { seeded: false };

  // Only seed user accounts + default config. Funds, exchanges and bots are created by
  // the operator (funds) / detected from real positions (bots) — no demo data.
  for (const u of DEFAULT_USERS) {
    const hash = await hashPassword(u.password);
    await query(
      `INSERT INTO users (id,username,email,first_name,last_name,role,active,permissions,phone,notify,password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
      [u.id, u.username, u.email, u.firstName, u.lastName, u.role, u.active,
       JSON.stringify(ROLE_PERMS[u.role]), u.phone, u.notify, hash]
    );
  }
  await query(`INSERT INTO app_config (key,value) VALUES ('openwa',$1::jsonb)
               ON CONFLICT (key) DO NOTHING`, [JSON.stringify(DEFAULT_OPENWA)]);
  return { seeded: true };
}
