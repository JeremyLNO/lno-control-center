// DB access. Production uses @vercel/postgres (serverless-safe, reads POSTGRES_URL).
// Tests/local inject globalThis.__DB_QUERY__ (e.g. a PGlite-backed function) so prod
// stays clean and never bundles a local driver.
import { sql } from '@vercel/postgres';

export async function query(text, params = []) {
  if (globalThis.__DB_QUERY__) return globalThis.__DB_QUERY__(text, params);
  return sql.query(text, params);
}
