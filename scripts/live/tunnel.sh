#!/bin/bash
# Public link for the Vibii pilot running on this Mac: a Cloudflare quick tunnel (no account needed) to the
# local production server, plus a stable GitHub Pages address that always forwards to the current tunnel.
set -u
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LIVE="$DIR/.data/live"
PORT="${VIBII_PORT:-3200}"
CLOUDFLARED="${CLOUDFLARED_BIN:-/opt/homebrew/bin/cloudflared}"
mkdir -p "$LIVE"
LOG="$LIVE/tunnel.log"
: > "$LOG"

"$CLOUDFLARED" tunnel --no-autoupdate --url "http://localhost:$PORT" >>"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT TERM INT

URL=""
for _ in $(seq 1 90); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
if [ -n "$URL" ]; then
  echo "$URL" > "$LIVE/url"
  echo "$(date '+%F %T') tunnel up: $URL"
  "$DIR/scripts/live/publish-link.sh" "$URL" >> "$LIVE/publish.log" 2>&1 || echo "publish-link failed (see publish.log)"
else
  echo "$(date '+%F %T') tunnel did not report a URL"
fi
wait $PID
