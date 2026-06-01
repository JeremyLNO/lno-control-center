# LNO · Control Center

Internal trading dashboard for monitoring LNO's algorithmic bots across **Binance, Bybit and OKX**.
Single-file app (React + Tailwind + custom SVG charts), **no build step required**.

## Live market data

The dashboard pulls **real data directly from the exchanges' public APIs** (browser-side, CORS-enabled — no backend, no API keys):

| Data | Source |
| --- | --- |
| Live prices + 24h change | Binance / Bybit / OKX tickers (refresh 5s) |
| Equity curves | Real daily klines × each bot's strategy profile |
| KPIs, drawdown, live PnL | Computed from the real series |
| Service health latency | **Real** ping to each exchange (10s) |
| Per-bot PnL attribution & trade history | Modelled, anchored to real prices* |

\* The bots' proprietary PnL/trade records are not exposed by public exchange APIs, so they are simulated on top of the live market. If a fetch fails, the app falls back to a deterministic simulation and the header shows `PARTIAL` / `SIM` instead of `LIVE`.

> Note: `MATIC` is requested as `POL` on the exchanges (token was renamed).

## Run locally

No dependencies to install. Serve the folder with any static server:

```bash
python3 -m http.server 8787
# open http://localhost:8787
```

Login with the default credentials: **`admin` / `admin`**.

## Deploy to Vercel

This is a static site — Vercel serves it with **no build step**.

**Option A — Vercel CLI**
```bash
npm i -g vercel      # requires Node
cd lno-control-center
vercel               # preview deploy
vercel --prod        # production deploy
```

**Option B — Git import (recommended, no Node needed)**
1. Push this folder to a GitHub/GitLab repo.
2. In the Vercel dashboard → **Add New… → Project** → import the repo.
3. Framework preset: **Other**. Build command: *none*. Output dir: *root*.
4. **Deploy.**

`vercel.json` already sets sensible cache + security headers.

## Production note

The app loads React, Tailwind and Babel from CDNs and compiles JSX in the browser (hence the dev-mode console warnings). This is fine for an internal tool. For a fully optimized production bundle (precompiled JSX + a real Tailwind build), the single file can be ported to a Vite project — ask if you want that.

---
LNO Trading Systems — Internal Use Only
