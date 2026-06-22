# WhatsApp alerts (TextMeBot)

The Control Center sends WhatsApp alerts through **TextMeBot**
([textmebot.com](https://www.textmebot.com/)) — a hosted WhatsApp relay. **There is nothing
to host:** the backend just makes an HTTPS request from Vercel. Unlike per-recipient relays,
TextMeBot uses **one account API key for the whole firm** that can send to any recipient
number.

## Configure

- **Admin ▸ WhatsApp**: paste the firm's **TextMeBot API key**, toggle **Enable**, **Save**,
  then **Send test to me**. The key is stored **encrypted** (AES-256-GCM) and is never
  returned to the browser (only a masked preview is shown). It can also be supplied via the
  `TEXTMEBOT_APIKEY` environment variable.
- **Each user** opts in from their **Profile**: set their **phone** (international format) and
  turn **Receive notifications** on. There is **no per-user key** — the firm's account key
  sends to every opted-in number.
- **Recipients must have their WhatsApp number registered with TextMeBot** to receive
  messages. If a user doesn't get the welcome message, an admin needs to add their number.

The **notification matrix** (Admin ▸ WhatsApp) decides which role receives each message type.

## How a message is sent

```
GET https://api.textmebot.com/send.php?recipient=<intl-phone>&apikey=<key>&text=<urlencoded>&json=yes
```

`recipient` is the recipient's phone in international format (leading `+` kept). A send is
treated as successful when the HTTP response is OK and the body matches `success|sent|queued`;
the raw response (truncated) is stored in the WhatsApp message log so failures are diagnosable.

## What gets sent

- Login-failure alerts to admins (after 3 failed attempts).
- Threshold breaches + daily / weekly / monthly reports — by the Vercel Cron
  (`/api/cron/daily`, 08:00 UTC). Configure thresholds under Admin ▸ WhatsApp.
- A "new report available" notice to opted-in shareholders when a report is generated.

## Limitations

- **Send-only here:** inbound replies aren't wired up, so "ACK <code>" WhatsApp replies don't
  work — acknowledge alerts from the header **bell** instead.
- **Text-only here:** TextMeBot can attach a document (`&document=<url>`), but that isn't
  enabled — the monthly report is sent as a text summary and the **PDF stays downloadable**
  under **Reports**.
