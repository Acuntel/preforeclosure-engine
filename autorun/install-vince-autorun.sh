#!/bin/bash
# Install the VINCE tracker as a macOS LaunchAgent: runs all day (KeepAlive),
# rescans metro Illinois on an interval, and auto-sends the daily top-3 digest at
# 10am Chicago to @BradyVinceCook_bot. Survives logout/reboot. Runs in the user GUI
# session so the headed people-search/FSBO browser can render.
#
#   bash autorun/install-vince-autorun.sh         # install + start
#   bash autorun/install-vince-autorun.sh remove  # stop + uninstall
set -e

LABEL="com.vince.tracker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJ="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
INTERVAL="${VINCE_INTERVAL_MIN:-20}"
DIGEST_HOUR="${VINCE_DIGEST_HOUR:-10}"
DAILY_COUNT="${VINCE_DAILY_COUNT:-3}"

if [ "$1" = "remove" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ removed $LABEL (Vince tracker will no longer auto-run)"
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
    <string>$PROJ/vince-track.js</string>
  </array>
  <key>WorkingDirectory</key><string>$PROJ</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>VINCE_INTERVAL_MIN</key><string>$INTERVAL</string>
    <key>VINCE_DIGEST_HOUR</key><string>$DIGEST_HOUR</string>
    <key>VINCE_DAILY_COUNT</key><string>$DAILY_COUNT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$PROJ/autorun/logs/vince.log</string>
  <key>StandardErrorPath</key><string>$PROJ/autorun/logs/vince.err.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null || launchctl start "$LABEL" 2>/dev/null || true
sleep 2
echo "✓ installed $LABEL"
echo "  node       : $NODE"
echo "  proj       : $PROJ"
echo "  scans every: ${INTERVAL}m"
echo "  daily top ${DAILY_COUNT} at: ${DIGEST_HOUR}:00 Chicago"
echo "  logs       : $PROJ/autorun/logs/vince.log"
