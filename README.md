# LNO · Control Center

Internal trading dashboard for monitoring LNO's algorithmic bots across **Binance, Bybit and OKX**.
Built with **React + Vite + Tailwind CSS**.

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
