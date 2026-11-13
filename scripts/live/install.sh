#!/bin/bash
# Installs the Vibii pilot as three always-on macOS background services (launchd), from this checkout:
#   com.vibii.web     production Next.js server on localhost:$PORT
#   com.vibii.worker  job worker + Suno agent runner (VIBII_AGENT_RUNNER=on lives only here)
#   com.vibii.tunnel  Cloudflare quick tunnel + GitHub Pages link update
# Usage: scripts/live/install.sh        (re-run after pulling new code: rebuilds and restarts)
#        scripts/live/install.sh stop   (stops and removes the services)
set -eu
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${VIBII_PORT:-3200}"
AGENTS="$HOME/Library/LaunchAgents"
LIVE="$DIR/.data/live"
NODE_BIN="$(dirname "$(command -v node)")"
CLAUDE_BIN="$(command -v claude || echo "$HOME/.local/bin/claude")"
PATHS="$NODE_BIN:$(dirname "$CLAUDE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
UID_NUM="$(id -u)"
mkdir -p "$AGENTS" "$LIVE"

unload() {
  for s in web worker tunnel; do
    launchctl bootout "gui/$UID_NUM/com.vibii.$s" 2>/dev/null || true
  done
}

if [ "${1:-}" = "stop" ]; then
  unload
  rm -f "$AGENTS"/com.vibii.{web,worker,tunnel}.plist
  echo "Vibii services stopped and removed."
  exit 0
fi

cd "$DIR"
[ -f .env.local ] || { echo "Missing $DIR/.env.local"; exit 1; }
npm ci --no-audit --no-fund >/dev/null
npm run db:migrate
npm run build

plist() { # name, program args (as XML strings), extra env XML
  cat > "$AGENTS/com.vibii.$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.vibii.$1</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key><array>$2</array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$PATHS</string>
    <key>VIBII_PORT</key><string>$PORT</string>
    $3
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LIVE/$1.log</string>
  <key>StandardErrorPath</key><string>$LIVE/$1.log</string>
</dict>
</plist>
PLIST
}

plist web "<string>$NODE_BIN/node</string><string>$DIR/node_modules/next/dist/bin/next</string><string>start</string><string>-p</string><string>$PORT</string><string>-H</string><string>127.0.0.1</string>" ""
plist worker "<string>$DIR/node_modules/.bin/tsx</string><string>--env-file=.env.local</string><string>worker/index.ts</string>" \
  "<key>VIBII_AGENT_RUNNER</key><string>on</string><key>VIBII_CLAUDE_BIN</key><string>$CLAUDE_BIN</string><key>VIBII_WORKER_CONCURRENCY</key><string>3</string>"
plist tunnel "<string>/bin/bash</string><string>$DIR/scripts/live/tunnel.sh</string>" ""

unload
for s in web worker tunnel; do
  launchctl bootstrap "gui/$UID_NUM" "$AGENTS/com.vibii.$s.plist"
done
echo "Vibii services installed. Logs: $LIVE/{web,worker,tunnel,publish}.log"
for _ in $(seq 1 60); do [ -s "$LIVE/url" ] && break; sleep 1; done
echo "Tunnel: $(cat "$LIVE/url" 2>/dev/null || echo 'starting…')"
