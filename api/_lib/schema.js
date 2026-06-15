// Schema creation + idempotent seed of defaults.
import { query } from './db.js';
import { hashPassword } from './auth.js';
import { encrypt } from './crypto.js';
import { ROLE_PERMS, DEFAULT_USERS, DEFAULT_FUNDS, DEFAULT_EXCHANGES, DEFAULT_OPENWA } from './constants.js';

export async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS users (
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
  await query(`CREATE TABLE IF NOT EXISTS funds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    bots JSONB NOT NULL DEFAULT '[]',
    sort INT NOT NULL DEFAULT 0
  )`);
  await query(`CREATE TABLE IF NOT EXISTS exchanges (
    id TEXT PRIMARY KEY,
    name TEXT,
    label TEXT,
    api_key TEXT,
    api_secret_enc TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    last_sync BIGINT,
    note TEXT DEFAULT ''
  )`);
  await query(`CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'
  )`);
  // one row per day — real recorded equity history (written by the daily cron)
  await query(`CREATE TABLE IF NOT EXISTS equity_snapshots (
    day DATE PRIMARY KEY,
    equity BIGINT NOT NULL,
    pnl_day BIGINT NOT NULL DEFAULT 0,
    metrics JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
  )`);
  // critical alerts that can be acknowledged (via WhatsApp reply or the UI)
  await query(`CREATE TABLE IF NOT EXISTS alerts (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    acked_at TIMESTAMPTZ,
    acked_by TEXT
  )`);
}

export async function seedIfEmpty() {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return { seeded: false };

  for (const u of DEFAULT_USERS) {
    const hash = await hashPassword(u.password);
    await query(
      `INSERT INTO users (id,username,email,first_name,last_name,role,active,permissions,phone,notify,password_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
      [u.id, u.username, u.email, u.firstName, u.lastName, u.role, u.active,
       JSON.stringify(ROLE_PERMS[u.role]), u.phone, u.notify, hash]
    );
  }
  let sort = 0;
  for (const f of DEFAULT_FUNDS) {
    await query(`INSERT INTO funds (id,name,color,bots,sort) VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [f.id, f.name, f.color, JSON.stringify(f.bots), sort++]);
  }
  for (const e of DEFAULT_EXCHANGES) {
    await query(`INSERT INTO exchanges (id,name,label,api_key,api_secret_enc,status,note)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.id, e.name, e.label, e.apiKey, e.secret ? encrypt(e.secret) : null, e.status, e.note]);
  }
  await query(`INSERT INTO app_config (key,value) VALUES ('openwa',$1::jsonb)
               ON CONFLICT (key) DO NOTHING`, [JSON.stringify(DEFAULT_OPENWA)]);
  return { seeded: true };
}
