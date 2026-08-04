// Smart lights that show the open book: green in profit, red in loss.
//
// Two brands, and they are NOT reachable the same way:
//
//   Govee  — a plain cloud API keyed by a personal API key. Works from serverless directly.
//   Hue    — the bridge lives on a private LAN behind a self-signed certificate, so it is
//            unreachable from Vercel AND blocked as mixed content from an HTTPS page. The
//            only path that actually works from a server is Philips' REMOTE API, which is
//            OAuth2 — hence the token dance below. There is no simpler option; a local-bridge
//            integration would have to run on a machine inside the house.
//
// Colour is pushed by the cron (see api/cron/daily.js), so the lights track the book whether
// or not anyone has the dashboard open.
import { query } from './db.js';
import { encrypt, decrypt, mask } from './crypto.js';

const CFG_KEY = 'lights';
const LAST_KEY = 'lightsLastColor';

export const DEFAULT_LIGHTS = {
  enabled: false,
  // Below this, in USDT, the book counts as flat: without a deadband the lamp strobes between
  // red and green on a book hovering around zero, which is noise, not information.
  deadband: 25,
  profit: '#10B981',   // Theme.up
  loss: '#EF4444',     // Theme.down
  flat: '#C9A24D',     // Theme.gold — "connected, nothing to say"
  brightness: 60,      // percent
  govee: { enabled: false, apiKey: '', device: '', model: '' },
  hue: { enabled: false, clientId: '', clientSecret: '', refreshToken: '', accessToken: '', expiresAt: 0, lightId: '' },
};

const hex2rgb = (hex) => {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
};

/// Which colour the book calls for. Exported because both the cron and the "test" button
/// must agree on it — two implementations of one rule is how a test that passes stops
/// meaning anything.
export function colorForPnl(pnl, cfg) {
  const band = Math.abs(Number(cfg?.deadband ?? DEFAULT_LIGHTS.deadband));
  if (!(Math.abs(Number(pnl) || 0) > band)) return cfg?.flat || DEFAULT_LIGHTS.flat;
  return (Number(pnl) > 0 ? (cfg?.profit || DEFAULT_LIGHTS.profit) : (cfg?.loss || DEFAULT_LIGHTS.loss));
}

export async function getLightsConfig() {
  const { rows } = await query('SELECT value FROM app_config WHERE key=$1', [CFG_KEY]);
  const v = rows[0]?.value || {};
  return {
    ...DEFAULT_LIGHTS, ...v,
    govee: { ...DEFAULT_LIGHTS.govee, ...(v.govee || {}) },
    hue: { ...DEFAULT_LIGHTS.hue, ...(v.hue || {}) },
  };
}

async function save(cfg) {
  await query(`INSERT INTO app_config (key,value) VALUES ($1,$2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=$2::jsonb`, [CFG_KEY, JSON.stringify(cfg)]);
}

/// Credentials are stored encrypted and NEVER returned to the client — the page gets a mask
/// and a boolean, exactly like the exchange keys and the TextMeBot key.
export function publicLightsConfig(cfg) {
  return {
    enabled: !!cfg.enabled, deadband: cfg.deadband, profit: cfg.profit, loss: cfg.loss,
    flat: cfg.flat, brightness: cfg.brightness,
    govee: { enabled: !!cfg.govee.enabled, device: cfg.govee.device, model: cfg.govee.model,
             hasApiKey: !!cfg.govee.apiKey, apiKeyMasked: cfg.govee.apiKey ? mask(decrypt(cfg.govee.apiKey)) : '' },
    hue: { enabled: !!cfg.hue.enabled, lightId: cfg.hue.lightId, clientId: cfg.hue.clientId,
           hasSecret: !!cfg.hue.clientSecret, linked: !!cfg.hue.refreshToken },
  };
}

/// Patch, never replace: a PUT that omits a secret must leave the stored one alone rather
/// than blanking it, or saving an unrelated colour would log the desk out of its lights.
export async function saveLightsConfig(patch) {
  const cur = await getLightsConfig();
  const next = {
    ...cur,
    enabled: patch.enabled ?? cur.enabled,
    deadband: Math.max(0, Number(patch.deadband ?? cur.deadband) || 0),
    profit: patch.profit || cur.profit,
    loss: patch.loss || cur.loss,
    flat: patch.flat || cur.flat,
    brightness: Math.min(100, Math.max(1, Number(patch.brightness ?? cur.brightness) || 60)),
    govee: {
      ...cur.govee,
      enabled: patch.govee?.enabled ?? cur.govee.enabled,
      device: patch.govee?.device ?? cur.govee.device,
      model: patch.govee?.model ?? cur.govee.model,
      apiKey: patch.govee?.apiKey ? encrypt(patch.govee.apiKey) : cur.govee.apiKey,
    },
    hue: {
      ...cur.hue,
      enabled: patch.hue?.enabled ?? cur.hue.enabled,
      lightId: patch.hue?.lightId ?? cur.hue.lightId,
      clientId: patch.hue?.clientId ?? cur.hue.clientId,
      clientSecret: patch.hue?.clientSecret ? encrypt(patch.hue.clientSecret) : cur.hue.clientSecret,
    },
  };
  await save(next);
  return next;
}

/* ---------------------------------------------------------------- Govee */

const GOVEE = 'https://openapi.api.govee.com/router/api/v1';

export async function goveeDevices(apiKey, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`${GOVEE}/user/devices`, { headers: { 'Govee-API-Key': apiKey } });
  if (!res.ok) throw new Error(`Govee ${res.status}`);
  const body = await res.json();
  return (body.data || []).map(d => ({
    device: d.device, model: d.sku || d.model, name: d.deviceName || d.device,
    // Only a device that can actually take a colour is worth offering.
    colorCapable: (d.capabilities || []).some(c => String(c.instance) === 'colorRgb'),
  }));
}

async function goveeSet(cfg, rgb, { fetchImpl = fetch } = {}) {
  const apiKey = decrypt(cfg.govee.apiKey);
  const headers = { 'Govee-API-Key': apiKey, 'Content-Type': 'application/json' };
  const target = { sku: cfg.govee.model, device: cfg.govee.device };
  const call = (capability) => fetchImpl(`${GOVEE}/device/control`, {
    method: 'POST', headers,
    // requestId is required by Govee; it only has to be unique per call.
    body: JSON.stringify({ requestId: `lno-${Date.now()}`, payload: { ...target, capability } }),
  });
  // Colour on a lamp that is off does nothing visible, so power it on first.
  const on = await call({ type: 'devices.capabilities.on_off', instance: 'powerSwitch', value: 1 });
  if (!on.ok) throw new Error(`Govee power ${on.status}`);
  const value = (rgb.r << 16) + (rgb.g << 8) + rgb.b;
  const col = await call({ type: 'devices.capabilities.color_setting', instance: 'colorRgb', value });
  if (!col.ok) throw new Error(`Govee color ${col.status}`);
  await call({ type: 'devices.capabilities.range', instance: 'brightness', value: Number(cfg.brightness) || 60 });
  return true;
}

/* ------------------------------------------------------------------ Hue */

/// Hue speaks CIE xy, not RGB. Philips' own published conversion, including the gamma step —
/// skipping it makes greens read as yellow-ish and reds as orange.
export function rgbToXy({ r, g, b }) {
  const f = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  const X = R * 0.4124 + G * 0.3576 + B * 0.1805;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  const sum = X + Y + Z;
  return sum === 0 ? { x: 0.3127, y: 0.3290 } : { x: X / sum, y: Y / sum };
}

/// Access tokens last hours, refresh tokens months. Refreshing lazily (only when the current
/// one is spent) keeps the cron from spending a round trip on it every five minutes.
async function hueAccessToken(cfg, { fetchImpl = fetch } = {}) {
  if (cfg.hue.accessToken && Date.now() < Number(cfg.hue.expiresAt || 0) - 60_000) return cfg.hue.accessToken;
  if (!cfg.hue.refreshToken) throw new Error('Hue not linked');
  const basic = Buffer.from(`${cfg.hue.clientId}:${decrypt(cfg.hue.clientSecret)}`).toString('base64');
  const res = await fetchImpl('https://api.meethue.com/v2/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: decrypt(cfg.hue.refreshToken) }).toString(),
  });
  if (!res.ok) throw new Error(`Hue token ${res.status}`);
  const t = await res.json();
  const next = { ...cfg, hue: { ...cfg.hue, accessToken: t.access_token, expiresAt: Date.now() + (Number(t.expires_in || 3600) * 1000) } };
  if (t.refresh_token) next.hue.refreshToken = encrypt(t.refresh_token);
  await save(next);
  return t.access_token;
}

/// Exchange the authorization code the admin came back with. Called once, at linking.
export async function hueExchangeCode(code, { fetchImpl = fetch } = {}) {
  const cfg = await getLightsConfig();
  const basic = Buffer.from(`${cfg.hue.clientId}:${decrypt(cfg.hue.clientSecret)}`).toString('base64');
  const res = await fetchImpl('https://api.meethue.com/v2/oauth2/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }).toString(),
  });
  if (!res.ok) throw new Error(`Hue token ${res.status}`);
  const t = await res.json();
  await save({ ...cfg, hue: { ...cfg.hue, refreshToken: encrypt(t.refresh_token), accessToken: t.access_token,
                              expiresAt: Date.now() + (Number(t.expires_in || 3600) * 1000), enabled: true } });
  return true;
}

export async function hueLights(cfg, { fetchImpl = fetch } = {}) {
  const token = await hueAccessToken(cfg, { fetchImpl });
  const res = await fetchImpl('https://api.meethue.com/route/clip/v2/resource/light', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Hue ${res.status}`);
  const body = await res.json();
  return (body.data || []).map(l => ({ id: l.id, name: l.metadata?.name || l.id }));
}

async function hueSet(cfg, rgb, { fetchImpl = fetch } = {}) {
  const token = await hueAccessToken(cfg, { fetchImpl });
  const res = await fetchImpl(`https://api.meethue.com/route/clip/v2/resource/light/${cfg.hue.lightId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ on: { on: true }, dimming: { brightness: Number(cfg.brightness) || 60 }, color: { xy: rgbToXy(rgb) } }),
  });
  if (!res.ok) throw new Error(`Hue set ${res.status}`);
  return true;
}

/// A self-test that cannot be mistaken for the book: blue, then yellow. Neither is a colour
/// this feature ever uses on its own — green, red and gold are taken — so whoever is watching
/// the lamp knows immediately they are seeing a test and not a P&L swing.
///
/// It ALWAYS restores the real colour afterwards, and that is not politeness: syncLights()
/// only pushes on a CHANGE, so a lamp left yellow would stay yellow until the book crossed a
/// threshold — the desk would be reading a test as its position.
export async function goveeSelfTest({ fetchImpl = fetch, pauseMs = 1500, pnl = 0 } = {}) {
  const cfg = await getLightsConfig();
  if (!cfg.govee.enabled || !cfg.govee.apiKey || !cfg.govee.device) return { error: 'Govee is not configured' };
  const steps = [];
  const show = async (name, hex) => {
    try { await goveeSet(cfg, hex2rgb(hex), { fetchImpl }); steps.push({ step: name, color: hex, ok: true }); }
    catch (e) { steps.push({ step: name, color: hex, error: String(e.message || e) }); }
  };
  await show('blue', '#2563EB');
  await new Promise(r => setTimeout(r, pauseMs));
  await show('yellow', '#FACC15');
  await new Promise(r => setTimeout(r, pauseMs));
  const restored = await syncLights(pnl, { fetchImpl, force: true });
  return { steps, restored, ok: steps.every(s => s.ok) };
}

/* --------------------------------------------------------------- driver */

/// Push the colour the book calls for. Returns per-brand outcomes rather than throwing: one
/// unplugged lamp must not stop the other brand, nor take the cron down with it.
export async function syncLights(pnl, { fetchImpl = fetch, force = false } = {}) {
  const cfg = await getLightsConfig();
  if (!cfg.enabled) return { skipped: 'disabled' };
  const color = colorForPnl(pnl, cfg);

  // Only on a CHANGE of colour: these are rate-limited consumer APIs, the cron runs every
  // five minutes, and re-sending "still green" all day is how an account gets throttled.
  if (!force) {
    const prev = (await query('SELECT value FROM app_config WHERE key=$1', [LAST_KEY])).rows[0]?.value;
    if (prev && prev.color === color) return { skipped: 'unchanged', color };
  }

  const rgb = hex2rgb(color);
  const out = { color };
  if (cfg.govee.enabled && cfg.govee.apiKey && cfg.govee.device) {
    try { await goveeSet(cfg, rgb, { fetchImpl }); out.govee = 'ok'; }
    catch (e) { out.govee = String(e.message || e); }
  }
  if (cfg.hue.enabled && cfg.hue.refreshToken && cfg.hue.lightId) {
    try { await hueSet(cfg, rgb, { fetchImpl }); out.hue = 'ok'; }
    catch (e) { out.hue = String(e.message || e); }
  }
  await query(`INSERT INTO app_config (key,value) VALUES ($1,$2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value=$2::jsonb`, [LAST_KEY, JSON.stringify({ color })]);
  return out;
}
