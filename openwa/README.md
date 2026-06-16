# WhatsApp alerts (CallMeBot)

The Control Center sends WhatsApp alerts through **CallMeBot**
([free WhatsApp API](https://www.callmebot.com/blog/free-api-whatsapp-messages/)) — a free,
hosted relay. **There is nothing to host:** the backend just makes an HTTPS request from
Vercel. Each recipient opts in once and gets their own personal API key.

## Opt in (per recipient, once)

From the phone that should receive alerts, open WhatsApp and send this message:

```
I allow callmebot to send me messages to this number
```

to **+34 644 51 95 23**. CallMeBot replies with your personal **apikey** (a number).

## Configure

- **Admin ▸ WhatsApp**: enter the default recipient's **phone** (international format) and its
  **CallMeBot API key**, toggle **Enable**, **Save**, then **Send test message**.
- **Each user** can also receive alerts: in their **Profile**, set their phone + their own
  CallMeBot key and turn notifications on.

All keys are stored **encrypted** (AES-256-GCM) and never returned to the browser.

## What gets sent

- Login-failure alerts to admins (after 3 failed attempts).
- Threshold breaches + daily / weekly / monthly reports — by the Vercel Cron
  (`/api/cron/daily`, 08:00 UTC). Configure thresholds under Admin ▸ WhatsApp.

## Limitations (inherent to CallMeBot)

- **Send-only:** no inbound, so "ACK <code>" WhatsApp replies don't work — acknowledge alerts
  from the header **bell** instead.
- **Text-only:** the monthly report is sent as a text summary; the **PDF stays downloadable**
  under **Reports**.
- Best-effort, rate-limited free service — fine for low-volume internal alerts.
