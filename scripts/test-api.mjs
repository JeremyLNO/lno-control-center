// Local end-to-end test of the API against an in-process Postgres (PGlite).
// Proves: bcrypt-hashed passwords (no plaintext in DB), JWT login, encrypted secrets
// (no plaintext in DB), masking, and auth gating. Run: node scripts/test-api.mjs
import { PGlite } from '@electric-sql/pglite';

process.env.JWT_SECRET = 'test-jwt-secret-please-change-1234567890';
process.env.APP_ENCRYPTION_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const db = new PGlite();
globalThis.__DB_QUERY__ = (t, p) => db.query(t, p);

const init = (await import('../api/init.js')).default;
const auth = (await import('../api/auth.js')).default;
const users = (await import('../api/users.js')).default;
const openwa = (await import('../api/openwa.js')).default;

function mockRes() {
  const r = { _status: 200, _json: null };
  r.status = (c) => { r._status = c; return r; };
  r.json = (o) => { r._json = o; return r; };
  r.end = () => r;
  return r;
}
async function call(handler, { method = 'GET', body = null, headers = {}, query = {} } = {}) {
  const req = { method, body, headers, query };
  const res = mockRes();
  await handler(req, res);
  return { status: res._status, body: res._json };
}

let pass = 0, fail = 0;
function ok(name, cond, extra) { (cond ? pass++ : fail++); console.log(`${cond ? '✓' : '✗ FAIL'}  ${name}${extra && !cond ? '  → ' + JSON.stringify(extra) : ''}`); }

// 1. init
let r = await call(init, { method: 'POST' });
ok('init creates + seeds', r.status === 200 && r.body.seeded === true, r.body);

// 2. login admin/admin
r = await call(auth, { method: 'POST', body: { action: 'login', username: 'admin', password: 'admin' } });
const token = r.body?.token;
ok('login admin/admin returns JWT + user', r.status === 200 && !!token && r.body.user.role === 'admin', r.body);
ok('login response contains NO password field', !('password' in (r.body?.user || {})) && !('password_hash' in (r.body?.user || {})));
const authH = { authorization: 'Bearer ' + token };

// 3. wrong password rejected
r = await call(auth, { method: 'POST', body: { action: 'login', username: 'admin', password: 'wrong' } });
ok('wrong password -> 401', r.status === 401, r.body);

// 4. me requires auth
r = await call(auth, { method: 'GET', headers: {} });
ok('GET me without token -> 401', r.status === 401);
r = await call(auth, { method: 'GET', headers: authH });
ok('GET me with token -> admin', r.status === 200 && r.body.user.username === 'admin', r.body);

// 5. DB stores bcrypt hash, NOT plaintext
let q = await db.query("SELECT password_hash FROM users WHERE username='admin'");
const hash = q.rows[0].password_hash;
ok('password stored as bcrypt hash (starts $2)', /^\$2[aby]\$/.test(hash), { hash });
ok('plaintext "admin" NOT in password_hash', !hash.includes('admin'));

// 6. admin-only gating: create user without token forbidden
r = await call(users, { method: 'POST', body: { username: 'x', email: 'x@lno.company' } });
ok('create user without token -> 401', r.status === 401);

// 7. create user (admin)
r = await call(users, { method: 'POST', headers: authH, body: { username: 'nina.test', email: 'nina.test@lno.company', role: 'operator' } });
ok('admin creates user', r.status === 201 && r.body.user.username === 'nina.test', r.body);
r = await call(users, { method: 'POST', headers: authH, body: { username: 'bad', email: 'bad@gmail.com' } });
ok('create user with non-@lno.company email rejected', r.status === 400, r.body);

// 8. OpenWA config: set apiUrl + apiKey, ensure key is encrypted in DB + masked in response
r = await call(openwa, { method: 'PUT', headers: authH, body: { apiUrl: 'https://wa.example.com', apiKey: 'super-secret-openwa-key-123', defaultSender: '+33612345678', enabled: true } });
ok('openwa PUT ok, returns masked key (not raw)', r.status === 200 && r.body.config.hasApiKey && !JSON.stringify(r.body.config).includes('super-secret-openwa-key-123'), r.body);
q = await db.query("SELECT value FROM app_config WHERE key='openwa'");
const stored = JSON.stringify(q.rows[0].value);
ok('OpenWA api key encrypted in DB (no plaintext)', !stored.includes('super-secret-openwa-key-123') && q.rows[0].value.apiKeyEnc.startsWith('v1:'), { stored });

// 9. GET openwa never leaks the key
r = await call(openwa, { method: 'GET', headers: authH });
ok('GET openwa returns masked key only', r.status === 200 && r.body.config.hasApiKey && !JSON.stringify(r.body.config).includes('super-secret-openwa-key-123'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
