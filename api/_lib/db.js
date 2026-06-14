// DB access via node-postgres (pg) — works with any managed Postgres
// (Vercel Postgres / Neon / Supabase / RDS). Reads the connection string from
// POSTGRES_URL (or DATABASE_URL / Prisma / non-pooling fallbacks).
// Tests/local inject globalThis.__DB_QUERY__ (a PGlite-backed function).
import pg from 'pg';

let pool;
function getPool() {
  if (!pool) {
    const cs = process.env.POSTGRES_URL || process.env.DATABASE_URL
      || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (!cs) throw new Error('No Postgres connection string — set POSTGRES_URL');
    const local = /localhost|127\.0\.0\.1/.test(cs);
    pool = new pg.Pool({ connectionString: cs, ssl: local ? false : { rejectUnauthorized: false }, max: 3 });
  }
  return pool;
}

export async function query(text, params = []) {
  if (globalThis.__DB_QUERY__) return globalThis.__DB_QUERY__(text, params);
  return getPool().query(text, params);
}
