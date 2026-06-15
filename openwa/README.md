# OpenWA host (WhatsApp alerts)

The Control Center sends WhatsApp alerts through **OpenWA** ([open-wa.org](https://www.open-wa.org/),
`@open-wa/wa-automate`). OpenWA drives a real WhatsApp Web session with headless Chrome, so it must
run on an **always-on host** (a small VPS, a Docker host, Railway, Render, Fly…). It cannot run on
Vercel serverless.

## Run it

```bash
cd openwa
echo "OPENWA_API_KEY=$(openssl rand -hex 24)" > .env
docker compose up -d
docker compose logs -f openwa      # scan the QR with WhatsApp ▸ Linked devices
```

Use a **dedicated WhatsApp number** (a SIM you keep online), not your personal one.

## Connect it to the Control Center

Admin ▸ **OpenWA**:

| Field | Value |
| --- | --- |
| API URL | `https://<your-host>:8080` — put it behind HTTPS / a reverse proxy in production |
| API Key | the `OPENWA_API_KEY` from your `.env` |
| Default recipient | a phone in international format, e.g. `+33 6 12 34 56 78` |

Toggle **Enable**, **Save**, then **Send test message**. The Control Center calls OpenWA's
`POST /sendText` with `{ args: { to: "<number>@c.us", content } }` and a `Bearer` api key.

## What gets sent

- **Login-failure alerts** to admins (after 3 failed attempts) — fire instantly.
- **Threshold breaches** (drawdown % / daily PnL) and the **daily portfolio report** — evaluated by a
  Vercel Cron (`/api/cron/daily`, 08:00 UTC) that recomputes metrics server-side. Adjust the
  thresholds and toggle the report under Admin ▸ OpenWA ▸ *Alert rules*; use **Run report now** to test.

Recipients = the default recipient **plus** every active user who enabled WhatsApp notifications and
set a phone number in their profile.

> Security: the api key is stored **AES-encrypted** in the database and never exposed to the browser.
> Keep OpenWA behind HTTPS and restrict the port to the Control Center's backend where possible.
