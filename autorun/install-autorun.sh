#!/bin/bash
# Install the REDLINE engine as a macOS LaunchAgent so it auto-starts at login,
# stays running (KeepAlive), and auto-scrapes every 24h on its own. After this you
# never have to run `npm start` — just open http://localhost:8787 anytime.
#
#   bash autorun/install-autorun.sh         # install + start
#   bash autorun/install-autorun.sh remove  # stop + uninstall
set -e

LABEL="com.redline.preforeclosure"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
PORT="${PORT:-8787}"
MINUTES="${AUTO_REFRESH_MINUTES:-60}"

if [ "$1" = "remove" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ removed $LABEL (engine will no longer auto-run)"
  exit 0
fi

mkdir -p "$HOME/Library/LaunchAgents" "$PROJ/autorun/logs"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$PROJ/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJ</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
    <key>AUTO_REFRESH_MINUTES</key><string>$MINUTES</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$PROJ/autorun/logs/engine.log</string>
  <key>StandardErrorPath</key><string>$PROJ/autorun/logs/engine.err.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
# RunAtLoad can be lazy on modern macOS — force the first start.
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl start "$LABEL" 2>/dev/null || true
sleep 3
echo "✓ installed $LABEL"
echo "  node : $NODE"
echo "  proj : $PROJ"
echo "  url  : http://localhost:$PORT   (auto-scrapes every ${MINUTES}m)"
echo "  logs : $PROJ/autorun/logs/engine.log"
curl -s -o /dev/null -w "  health: HTTP %{http_code}\n" -m 6 "http://localhost:$PORT/" || echo "  (give it a few seconds, then open the url)"
