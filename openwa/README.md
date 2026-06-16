# OpenWA host (WhatsApp alerts)

The Control Center sends WhatsApp alerts through **OpenWA** — the open-source gateway at
**https://github.com/rmyndharis/OpenWA** (NestJS + whatsapp-web.js). It drives a real
WhatsApp Web session, so it must run on an **always-on host** (a small VPS / Docker host).
It cannot run on Vercel serverless.

## 1. Run the gateway

```bash
git clone https://github.com/rmyndharis/OpenWA.git
cd OpenWA
cp .env.example .env          # review settings — API_PORT defaults to 2785, dashboard to 2886
docker compose up -d          # or, for a quick start: docker compose -f docker-compose.dev.yml up -d
```

- API:       `http://<host>:2785/api`
- Dashboard: `http://<host>:2886`
- Swagger:   `http://<host>:2785/api/docs`

Put it behind HTTPS / a reverse proxy in production, and use a **dedicated WhatsApp number**
(a SIM you keep online), not your personal one.

## 2. Create an API key, a session, and a webhook

In the dashboard (or via the API). Replace `<host>`, `<KEY>`, `<SESSION_ID>`:

```bash
# create + start a session, then scan the QR with WhatsApp ▸ Linked devices
curl -X POST http://<host>:2785/api/sessions -H 'X-API-Key: <KEY>' \
     -H 'Content-Type: application/json' -d '{"name":"lno"}'
curl -X POST http://<host>:2785/api/sessions/<SESSION_ID>/start -H 'X-API-Key: <KEY>'
curl       http://<host>:2785/api/sessions/<SESSION_ID>/qr      -H 'X-API-Key: <KEY>'

# register the inbound webhook so "ACK <code>" replies acknowledge alerts
curl -X POST http://<host>:2785/api/sessions/<SESSION_ID>/webhooks -H 'X-API-Key: <KEY>' \
     -H 'Content-Type: application/json' \
     -d '{"url":"https://cc.lno.company/api/webhook?key=<WEBHOOK_SECRET>","events":["message.received"]}'
```

Note the **Session ID** and the **API key** — you paste them into the Control Center.
`<WEBHOOK_SECRET>` is the same value as the `WEBHOOK_SECRET` env var on the Vercel project.

## 3. Connect it to the Control Center

Admin ▸ **OpenWA**:

| Field | Value |
| --- | --- |
| OpenWA API URL | `https://<host>:2785` |
| Session ID | the session you created (e.g. `sess_abc123`) |
| API Key | the gateway's `X-API-Key` |
| Default recipient | a phone in international format, e.g. `+33 6 12 34 56 78` |

Toggle **Enable**, **Save**, then **Send test message**. Under the hood the Control Center calls:

- `POST {url}/api/sessions/{id}/messages/send-text` — `{ chatId, text }`
- `POST {url}/api/sessions/{id}/messages/send-document` — `{ chatId, document:{base64}, filename, caption }` (monthly PDF)

…both with the `X-API-Key` header. The api key is stored **encrypted** (AES-256-GCM) in the
database and never returned to the browser.

## What gets sent

- **Login-failure alerts** to admins (after 3 failed attempts) — fire instantly.
- **Threshold breaches** (drawdown % / daily PnL) and the **daily / weekly / monthly reports**
  (the monthly one includes a PDF) — evaluated by a Vercel Cron (`/api/cron/daily`, 08:00 UTC)
  that recomputes metrics server-side. Configure thresholds and the report toggle under
  Admin ▸ OpenWA ▸ *Alert rules*; use **Run report now** to test.

Recipients = the default recipient **plus** every active user who enabled WhatsApp
notifications and set a phone number in their profile.
