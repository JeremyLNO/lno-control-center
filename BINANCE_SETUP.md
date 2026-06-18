# Binance Futures — read-only key + static-IP proxy

The position sync reads your Binance USDⓈ-M **Futures** account (positions + equity) from the
server. Vercel functions have **no fixed outbound IP**, so to use Binance IP-whitelisting we
route the calls through a **forward proxy that has a static IP**, and whitelist that IP on the key.

How it's wired: if `BINANCE_PROXY` is set, every Binance call egresses through that **forward
proxy** (undici `ProxyAgent`). The request still targets `fapi.binance.com` (correct Host / SNI /
signature) — only the **egress IP** changes. **The API secret never leaves Vercel**: requests are
HMAC-signed before they hit the proxy; the proxy only sees the API key + already-signed
(read-only) requests. `BINANCE_PROXY` works with ANY forward proxy URL — self-hosted or managed.

## Recommended: self-hosted forward proxy on a small VM (you own the IP)

**Free option:** run it on an always-free VM — **Oracle Cloud Always Free** (free forever, fixed
public IP) or **Google Cloud `e2-micro` Always Free** (US regions; reserve the static IP so it
stays stable while the VM runs). Both need a card for identity verification (not charged on the
free tier). Keep the VM running so the IP doesn't change. Otherwise any cheap VPS (Hetzner/DO,
≈€4/mo) works the same. ⚠️ Never use random "free public proxy" lists — they would capture your
API key.

1. Create the VM (free Oracle/GCP, or a cheap VPS) with a fixed IPv4. Note its **IPv4**.
2. Install **tinyproxy** and lock it down (auth + only allow Binance, so it's not an open relay):

```bash
sudo apt update && sudo apt install -y tinyproxy
sudo tee /etc/tinyproxy/tinyproxy.conf >/dev/null <<'CONF'
Port 8888
Listen 0.0.0.0
Allow 0.0.0.0/0
BasicAuth lno CHANGE_ME_STRONG_PASSWORD
ConnectPort 443
FilterDefaultDeny Yes
FilterExtended On
Filter "/etc/tinyproxy/filter"
CONF
echo '(^|\.)binance\.com$' | sudo tee /etc/tinyproxy/filter >/dev/null
sudo systemctl restart tinyproxy
# open the port (ufw example)
sudo ufw allow 8888/tcp
```

3. Whitelist the **VPS IPv4** on the Binance key (step C below).
4. Vercel env: `BINANCE_PROXY = http://lno:CHANGE_ME_STRONG_PASSWORD@<VPS_IPv4>:8888`

Quick test from the VPS: `curl -x http://lno:PASS@127.0.0.1:8888 https://fapi.binance.com/fapi/v1/time` → returns Binance server time.

## Or: a managed static-IP proxy (no server to run)

Services like **QuotaGuard Static** or **Fixie** give you a forward-proxy URL + static IP(s) from
their dashboard (paid — check their current pricing). Set `BINANCE_PROXY` to the proxy URL they
give you, and whitelist their IP(s) on Binance. Same code, nothing to change.

## C. The Binance API key

- **Enable Reading** ✓ and **Enable Futures** ✓ (needed to read positions — Binance has no
  "futures read-only" sub-permission, so this key *can* trade; that's why we whitelist).
- **Enable Withdrawals** ✗ (never) — worst case on a leak is unauthorized trades, not fund theft.
- **Restrict access to trusted IPs** ✓ → add the **proxy's static IP**.

Then Control Center → **Exchanges** → add a connection named `binance` (key + secret; the secret
is AES-encrypted at rest and never returned to the browser). Then **Bots → Sync now**.
