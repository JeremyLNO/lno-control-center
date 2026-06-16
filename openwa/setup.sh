#!/usr/bin/env bash
# =============================================================================
# LNO Control Center — one-shot OpenWA (rmyndharis/OpenWA) setup.
#
# Run this ON an always-on host that has a PUBLIC IP and Docker installed
# (a small VPS, or your Mac with Docker Desktop + a tunnel). It does everything
# except the QR scan:
#   clone OpenWA · generate an API key · start it · create the "lno" session ·
#   register the ACK webhook · (optionally) auto-configure the Control Center ·
#   then print the QR to scan.
#
# Usage (minimal):
#   bash setup.sh
#
# Usage (full auto — also configures cc.lno.company and the ACK webhook):
#   WEBHOOK_SECRET=<vercel WEBHOOK_SECRET> \
#   CC_ADMIN_PASS=<control-center admin password> \
#   PUBLIC_HOST=wa.yourdomain.com \
#   bash setup.sh
# =============================================================================
set -euo pipefail

CC_URL="${CC_URL:-https://cc.lno.company}"
CC_ADMIN_EMAIL="${CC_ADMIN_EMAIL:-admin@lno.company}"
CC_ADMIN_PASS="${CC_ADMIN_PASS:-}"        # set to auto-configure the Control Center
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"      # = Vercel WEBHOOK_SECRET (enables "ACK <code>" replies)
PUBLIC_HOST="${PUBLIC_HOST:-}"            # e.g. wa.example.com — auto-detected (public IP) if empty
API_PORT="${API_PORT:-2785}"

command -v docker  >/dev/null || { echo "✗ Docker is required. Install Docker first."; exit 1; }
command -v openssl >/dev/null || { echo "✗ openssl is required."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "✗ 'docker compose' v2 is required."; exit 1; }

jget() { # extract a top-level JSON string field: jget <field>
  python3 -c "import sys,json;print(json.load(sys.stdin).get('$1',''))" 2>/dev/null \
    || sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" | head -1
}

# 1) Clone + API key ----------------------------------------------------------
[ -d OpenWA ] || git clone --depth 1 https://github.com/rmyndharis/OpenWA.git
cd OpenWA
[ -f .env ] || cp .env.example .env
KEY="${API_MASTER_KEY:-$(openssl rand -hex 24)}"
if grep -q '^API_MASTER_KEY=' .env; then
  sed -i.bak "s|^API_MASTER_KEY=.*|API_MASTER_KEY=${KEY}|" .env
else
  echo "API_MASTER_KEY=${KEY}" >> .env
fi

# 2) Start the stack ----------------------------------------------------------
echo "▸ Building & starting OpenWA (first run can take several minutes)…"
docker compose up -d

# 3) Wait for the API to be ready --------------------------------------------
echo -n "▸ Waiting for the API"
for _ in $(seq 1 100); do
  curl -fsS "http://localhost:${API_PORT}/api/health/ready" >/dev/null 2>&1 && { echo " — ready."; break; }
  echo -n "."; sleep 3
done

# 4) Create + start the session ----------------------------------------------
SID=$(curl -fsS -X POST "http://localhost:${API_PORT}/api/sessions" \
        -H "X-API-Key: ${KEY}" -H 'Content-Type: application/json' \
        -d '{"name":"lno"}' | jget id)
[ -n "$SID" ] || { echo "✗ Could not create a session — check: docker compose logs openwa-api"; exit 1; }
curl -fsS -X POST "http://localhost:${API_PORT}/api/sessions/${SID}/start" -H "X-API-Key: ${KEY}" >/dev/null || true

# 5) Register the inbound webhook (so "ACK <code>" replies acknowledge alerts)-
if [ -n "$WEBHOOK_SECRET" ]; then
  curl -fsS -X POST "http://localhost:${API_PORT}/api/sessions/${SID}/webhooks" \
    -H "X-API-Key: ${KEY}" -H 'Content-Type: application/json' \
    -d "{\"url\":\"${CC_URL}/api/webhook?key=${WEBHOOK_SECRET}\",\"events\":[\"message.received\"]}" >/dev/null \
    && echo "▸ Webhook registered → ${CC_URL}/api/webhook"
fi

# 6) Public address -----------------------------------------------------------
[ -n "$PUBLIC_HOST" ] || PUBLIC_HOST="$(curl -fsS https://ifconfig.me 2>/dev/null || echo '<YOUR_PUBLIC_IP>')"
API_URL="http://${PUBLIC_HOST}:${API_PORT}"

# 7) Optionally auto-configure the Control Center -----------------------------
if [ -n "$CC_ADMIN_PASS" ]; then
  TOK=$(curl -fsS -X POST "${CC_URL}/api/auth" -H 'Content-Type: application/json' \
        -d "{\"action\":\"login\",\"email\":\"${CC_ADMIN_EMAIL}\",\"password\":\"${CC_ADMIN_PASS}\"}" | jget token)
  if [ -n "$TOK" ]; then
    curl -fsS -X PUT "${CC_URL}/api/openwa" -H "Authorization: Bearer ${TOK}" -H 'Content-Type: application/json' \
      -d "{\"apiUrl\":\"${API_URL}\",\"sessionId\":\"${SID}\",\"apiKey\":\"${KEY}\",\"enabled\":true}" >/dev/null \
      && echo "▸ Control Center configured automatically ✓"
  else
    echo "! Could not log in to the Control Center (check CC_ADMIN_PASS) — configure it manually below."
  fi
fi

# 8) Final instructions -------------------------------------------------------
cat <<EOF

============================================================
 OpenWA is running. ONE step left → scan the QR with WhatsApp.
============================================================
 Open in a browser:
   ${API_URL}/api/sessions/${SID}/qr
 then  WhatsApp ▸ Linked devices ▸ Link a device ▸ scan.

 Control Center ▸ Admin ▸ OpenWA (if not auto-configured above):
   OpenWA API URL : ${API_URL}
   Session ID     : ${SID}
   API Key        : ${KEY}
   → Enable · Save · Send test message

 ⚠ Put it behind HTTPS in production (reverse proxy) — the API key
   travels in the X-API-Key header.
============================================================
EOF
