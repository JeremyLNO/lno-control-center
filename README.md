# LNO · Control Center

Internal trading dashboard for monitoring LNO's algorithmic bots across **Binance, Bybit and OKX**.
Frontend: **React + Vite + Tailwind**. Backend: **Vercel Serverless Functions + Postgres**.

## Accounts & secrets (secure by design)

All accounts and configuration live in a **Postgres database** behind the `/api` serverless
functions — nothing sensitive is stored in the browser.

- **Passwords** are **bcrypt-hashed** in the DB; plaintext never exists in code, the API, or localStorage.
- **Secrets** (OpenWA api key, exchange API secrets) are **AES-256-GCM encrypted at rest** and are
  **never returned to the browser** — only a masked preview.
- The browser holds a short-lived **JWT** (12 h) in `sessionStorage`; every API call is authenticated, admin routes are role-gated.
- Encryption/signing keys come **only from env vars** (`JWT_SECRET`, `APP_ENCRYPTION_KEY`) — never hard-coded.

### Backend layout
```
api/
  _lib/  db.js · crypto.js (AES-GCM) · auth.js (bcrypt+JWT) · schema.js · constants.js
  init.js        POST  create tables + seed defaults (idempotent)
  auth.js        GET me · POST {login|logout|changePassword}
  users.js       admin CRUD (no passwords in/out)
  profile.js     PATCH self (name/phone/notify/avatar)
  funds.js       GET · PUT (replace-all)
  exchanges.js   admin CRUD — secret encrypted, returned masked
  openwa.js      GET/PUT config · POST {send|test}  → OpenWA host
```
Local full-stack test against in-process Postgres (PGlite): `node scripts/test-api.mjs` and `node scripts/dev-server.mjs`.

## OpenWA (WhatsApp) integration

WhatsApp alerts go through **OpenWA** ([open-wa.org](https://www.open-wa.org/), `@open-wa/wa-automate`),
self-hosted on your own always-on Node host (it drives a real WhatsApp Web session — it can't run on
Vercel serverless). Configure the host URL + api key under **Admin → OpenWA**; the backend calls its
EASY-API `/sendText`. The api key is stored encrypted.

## Deploy (Vercel + Postgres)

1. **Attach a database**: Vercel → project → **Storage → Create Database → Postgres** (sets `POSTGRES_URL`).
2. **Set env vars** (Settings → Environment Variables) — see `.env.example`:
   - `JWT_SECRET` = `openssl rand -base64 48`
   - `APP_ENCRYPTION_KEY` = `openssl rand -hex 32` (64 hex chars)
   - `SETUP_TOKEN` (optional) = `openssl rand -hex 16`
3. **Deploy** (git push or `vercel --prod`).
4. **Initialise the DB once**: `curl -X POST https://<your-domain>/api/init` (add `-H "x-setup-token: <token>"` if set). Seeds the default `admin / admin` account — change the password immediately.

> ⚠️ `APP_ENCRYPTION_KEY` must stay stable — rotating it makes existing encrypted secrets unreadable.

## Live market data

The dashboard pulls **real data directly from the exchanges' public APIs** (browser-side, CORS-enabled — no backend, no API keys):

| Data | Source |
| --- | --- |
| Live prices + 24h change | Binance / Bybit / OKX tickers (refresh 5s) |
| Equity curves | Real daily klines × each bot's strategy profile |
| KPIs, drawdown, live PnL | Computed from the real series |
| Service health latency | **Real** ping to each exchange (10s) |
| Per-bot PnL attribution & trade history | Modelled, anchored to real prices* |

\* The bots' proprietary PnL / trade records are not exposed by public exchange APIs, so they are simulated on top of the live market. If a fetch fails, the app falls back to a deterministic simulation and the header shows `PARTIAL` / `SIM` instead of `LIVE`.

> Note: `MATIC` is requested as `POL` on the exchanges (the token was renamed; OKX delisted `MATIC-USDT`).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
```

Login with the default credentials: **`admin` / `admin`**.

## Build

```bash
npm run build      # outputs to dist/
npm run preview    # serve the production build locally
```

`xlsx` is code-split and loaded on demand (only when exporting), keeping the initial bundle small (~72 kB gzipped).

## Deploy to Vercel

Vercel auto-detects the Vite framework and builds in the cloud — **you don't need Node locally**.

**Git import (recommended)**
1. Push this repo to GitHub / GitLab / Bitbucket.
2. Vercel dashboard → **Add New… → Project** → import the repo.
3. Everything is auto-detected: Framework **Vite**, Build `npm run build`, Output `dist`. Click **Deploy**.

**Vercel CLI** (needs Node)
```bash
npm i -g vercel
vercel          # preview
vercel --prod   # production
```

`vercel.json` sets long-lived immutable caching for hashed `/assets/*` and security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`).

## Project structure

```
index.html              Vite entry
src/
  main.jsx              the whole app (data layer, components, pages, router)
  index.css            Tailwind directives + custom CSS
tailwind.config.js      theme tokens (navy / gold, fund palette)
vite.config.js
vercel.json
```

State is persisted to `localStorage` (`lno_users`, `lno_funds`, `lno_exchanges`, `lno_whatsapp_config`, `lno_login_attempts`); the session lives in `sessionStorage` (`lno_auth`).

---
LNO Trading Systems — Internal Use Only
