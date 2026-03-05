#!/usr/bin/env bash
# Expose local backend (port 8080) via ngrok using NGROK_AUTHTOKEN or ngrok_key from .env.
# Run from project root: ./scripts/ngrok-tunnel.sh
# Then set EXPO_PUBLIC_BACKEND_URL in frontend/.env to the https URL ngrok prints.

set -e
cd "$(dirname "$0")/.."

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok CLI not found. Use the Node script instead (no CLI needed):"
  echo "  npm install"
  echo "  npm run ngrok"
  echo "Or install the CLI: https://ngrok.com/download"
  exit 1
fi

if [ ! -f .env ]; then
  echo "No .env in project root. Add NGROK_AUTHTOKEN=your-token or ngrok_key=your-token"
  exit 1
fi

# Read token: NGROK_AUTHTOKEN or ngrok_key (value after first =)
TOKEN=$(grep -E '^NGROK_AUTHTOKEN=|^ngrok_key=' .env 2>/dev/null | head -1 | sed 's/^[^=]*=//')
if [ -z "$TOKEN" ]; then
  echo "Add NGROK_AUTHTOKEN= or ngrok_key= to .env"
  exit 1
fi

# Optional: reserved domain (ngrok paid plan)
DOMAIN=""
if grep -q '^NGROK_DOMAIN=' .env 2>/dev/null; then
  DOMAIN="--domain=$(grep '^NGROK_DOMAIN=' .env | sed 's/^NGROK_DOMAIN=//')"
fi

echo "Starting ngrok tunnel to http://127.0.0.1:8080"
echo "Set EXPO_PUBLIC_BACKEND_URL in frontend/.env to the https URL below (and add that URL/oauth/google/callback in Google Console)."
echo ""

exec ngrok http 8080 --authtoken "$TOKEN" $DOMAIN
