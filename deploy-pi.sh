#!/bin/bash
# ============================================================================
# Agent-OS Raspberry Pi Deployment Script
# ============================================================================
# Deploys the Next.js Agent-OS dashboard on a Raspberry Pi with:
# 1. Node.js + Next.js production server (systemd service)
# 2. Chromium kiosk mode for the touch tablet interface
#
# For Raspberry Pi OS with DESKTOP (Bookworm 64-bit strongly recommended).
# For Pi OS Lite (no desktop), use deploy-pi-lite.sh instead.
#
# ⚠ IMPORTANT: Use Bookworm, NOT Trixie.
#   Trixie (Debian 13) replaced X11/openbox with Wayland/labwc, breaking
#   kiosk autostart, xset/xrandr, LightDM autologin, and touch calibration.
#   Bookworm is the proven, stable base for Pi kiosk deployments.
#   Download: https://www.raspberrypi.com/software/operating-systems/
#
# Prerequisites:
#   - Raspberry Pi OS Desktop Bookworm 64-bit
#   - Network connectivity
#   - User: pi (or set PI_USER env var)
#
# Usage:
#   chmod +x deploy-pi.sh
#   ./deploy-pi.sh              # Full install
#   ./deploy-pi.sh --kiosk-only # Only set up kiosk (if app already running)
#   ./deploy-pi.sh --app-only   # Only set up the app service
# ============================================================================

set -euo pipefail

# --- Colors & Helpers ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

print_step()  { echo -e "${GREEN}  ✓${NC} $1"; }
print_info()  { echo -e "${BLUE}  ℹ${NC} $1"; }
print_warn()  { echo -e "${YELLOW}  ⚠${NC} $1"; }
print_error() { echo -e "${RED}  ✗${NC} $1"; }
print_progress() { echo -e "${DIM}  ⏳ $1...${NC}"; }

# --- Configuration ---
PI_USER="${PI_USER:-$(whoami)}"
APP_DIR="/home/${PI_USER}/agent-os"
APP_PORT="${APP_PORT:-3000}"
NODE_VERSION="20"

KIOSK_ONLY=false
APP_ONLY=false

for arg in "$@"; do
  case $arg in
    --kiosk-only) KIOSK_ONLY=true ;;
    --app-only) APP_ONLY=true ;;
    --help|-h)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --kiosk-only   Only set up Chromium kiosk (skip app install)"
      echo "  --app-only     Only set up the app service (skip kiosk)"
      echo "  --help, -h     Show this help"
      echo ""
      echo "Environment variables:"
      echo "  PI_USER         User to run as (default: pi)"
      echo "  APP_PORT        Dashboard port (default: 3000)"
      exit 0
      ;;
  esac
done

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Agent-OS — Raspberry Pi Desktop Deployment${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  User:       ${BOLD}${PI_USER}${NC}"
echo -e "  App Dir:    ${BOLD}${APP_DIR}${NC}"
echo -e "  Port:       ${BOLD}${APP_PORT}${NC}"
echo -e "  Mode:       ${BOLD}$([ "$KIOSK_ONLY" = true ] && echo "Kiosk only" || ([ "$APP_ONLY" = true ] && echo "App only" || echo "Full install"))${NC}"
echo ""

# --- Pre-flight checks ---
print_progress "Running pre-flight checks"

# Architecture check
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" && "$ARCH" != "armv7l" ]]; then
  print_warn "Non-Pi architecture detected: ${ARCH}"
fi

# OS version check — warn if not Bookworm
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_CODENAME="${VERSION_CODENAME:-unknown}"
  if [ "$OS_CODENAME" = "bookworm" ]; then
    print_step "Raspberry Pi OS Bookworm detected"
  elif [ "$OS_CODENAME" = "trixie" ]; then
    echo ""
    print_error "Raspberry Pi OS Trixie detected — NOT RECOMMENDED"
    echo -e "    ${YELLOW}Trixie replaced X11/openbox with Wayland/labwc, which breaks${NC}"
    echo -e "    ${YELLOW}the kiosk autostart, screen blanking, xrandr, and touch${NC}"
    echo -e "    ${YELLOW}calibration used by this script.${NC}"
    echo ""
    echo -e "    ${BOLD}Strongly recommended:${NC} Flash Bookworm 64-bit instead."
    echo -e "    ${DIM}https://www.raspberrypi.com/software/operating-systems/${NC}"
    echo ""
    echo -en "    ${BOLD}Continue anyway at your own risk? ${DIM}[y/N]${NC} "
    read -r trixie_confirm
    case "$trixie_confirm" in
      [Yy]*) print_warn "Proceeding on Trixie — some features may not work" ;;
      *) echo -e "    ${DIM}Aborted. Flash Bookworm and re-run.${NC}"; exit 1 ;;
    esac
  else
    print_info "OS codename: ${OS_CODENAME}"
  fi
fi

# Connectivity check
if ! ping -c 1 -W 3 google.com &>/dev/null && ! ping -c 1 -W 3 8.8.8.8 &>/dev/null; then
  print_error "No internet connection detected."
  echo -e "    ${DIM}Connect via ethernet or configure WiFi first.${NC}"
  exit 1
fi
print_step "Internet connected (arch: ${ARCH})"

# Check user exists
if ! id "$PI_USER" &>/dev/null; then
  print_error "User '${PI_USER}' does not exist. Set PI_USER env var."
  exit 1
fi
print_step "User '${PI_USER}' exists"
echo ""

# --- 1. Install Node.js ---
install_node() {
  echo -e "${CYAN}[1/5]${NC} ${BOLD}Node.js${NC}"

  if command -v node &>/dev/null; then
    CURRENT_NODE=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
      print_step "Node.js $(node -v) already installed"
      return
    fi
  fi

  print_progress "Installing Node.js ${NODE_VERSION}"
  if curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -; then
    sudo apt-get install -y nodejs
  else
    print_warn "nodesource setup failed — falling back to nvm"
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
    # shellcheck disable=SC1090
    export NVM_DIR="$HOME/.nvm"
    source "${NVM_DIR}/nvm.sh"
    nvm install "${NODE_VERSION}"
    nvm use "${NODE_VERSION}"
    nvm alias default "${NODE_VERSION}"
  fi
  print_step "Node.js $(node -v) installed"
  print_step "npm $(npm -v)"
}

# --- 2. Copy app files ---
setup_app() {
  echo -e "${CYAN}[2/5]${NC} ${BOLD}Application setup${NC}"

  if [ ! -d "$APP_DIR" ]; then
    print_progress "Creating ${APP_DIR}"
    mkdir -p "$APP_DIR"
  fi

  # If running from project directory, copy files
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "${SCRIPT_DIR}/package.json" ] && [ "$SCRIPT_DIR" != "$APP_DIR" ]; then
    print_progress "Copying project files to ${APP_DIR}"
    rsync -av --exclude='node_modules' --exclude='.next' --exclude='.git' --exclude='data/agent-os.db' "${SCRIPT_DIR}/" "${APP_DIR}/"
    print_step "Files synced"
  fi

  cd "$APP_DIR"

  if [ ! -f "package.json" ]; then
    print_error "No package.json found at ${APP_DIR}"
    echo -e "    ${DIM}Run this script from the Agent-OS project directory,${NC}"
    echo -e "    ${DIM}or clone the repo to ${APP_DIR} first.${NC}"
    exit 1
  fi

  print_progress "Installing dependencies"
  npm ci 2>/dev/null || npm install
  print_step "Dependencies installed"

  print_progress "Building Next.js app (this takes 2-5 min on Pi)"
  if ! npx next build; then
    print_error "Build failed — see output above"
    exit 1
  fi
  print_step "Production build complete"

  # Ensure data directory exists
  mkdir -p data

  print_step "Application ready at ${APP_DIR}"
}

# --- 3. Create systemd service ---
create_service() {
  echo -e "${CYAN}[3/5]${NC} ${BOLD}Systemd service${NC}"

  NODE_BIN=$(which node)

  sudo tee /etc/systemd/system/agent-os.service > /dev/null << SERVICEEOF
[Unit]
Description=Agent-OS Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${PI_USER}
Group=${PI_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${NODE_BIN} ${APP_DIR}/node_modules/.bin/next start -p ${APP_PORT}
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=${APP_PORT}

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${APP_DIR}/data
ProtectHome=read-only

StandardOutput=journal
StandardError=journal
SyslogIdentifier=agent-os

[Install]
WantedBy=multi-user.target
SERVICEEOF

  sudo systemctl daemon-reload
  sudo systemctl enable agent-os
  sudo systemctl restart agent-os

  print_step "agent-os.service created and enabled"

  # Wait for service to come up
  print_progress "Waiting for dashboard to start"
  for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${APP_PORT}" 2>/dev/null | grep -q "200\|304"; then
      print_step "Dashboard is live on port ${APP_PORT}"
      return
    fi
    sleep 2
  done
  print_warn "Dashboard hasn't responded yet — it may still be starting"
  print_info "Check: sudo journalctl -u agent-os -f"
}

# --- 4. Set up Chromium kiosk ---
setup_kiosk() {
  echo -e "${CYAN}[4/5]${NC} ${BOLD}Chromium kiosk${NC}"

  # Install Chromium if not present
  if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null; then
    print_progress "Installing Chromium"
    sudo apt-get update -qq
    sudo apt-get install -y -qq chromium-browser 2>/dev/null || sudo apt-get install -y -qq chromium
  fi
  print_step "Chromium installed"

  CHROMIUM_BIN=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null)

  # Disable screen blanking
  print_progress "Disabling screen blanking"
  sudo raspi-config nonint do_blanking 1 2>/dev/null || true

  # Also disable DPMS via X11 config for desktop environment
  XPROFILE="/home/${PI_USER}/.xprofile"
  if ! grep -q "xset s off" "$XPROFILE" 2>/dev/null; then
    cat >> "$XPROFILE" << 'XPEOF'

# Agent-OS: disable screen blanking and DPMS
xset s off
xset s nofade
xset -dpms
xset s 0 0
XPEOF
    chown "${PI_USER}:${PI_USER}" "$XPROFILE"
  fi
  print_step "Screen blanking disabled"

  # Create autostart directory
  AUTOSTART_DIR="/home/${PI_USER}/.config/autostart"
  mkdir -p "$AUTOSTART_DIR"

  # Hide cursor (install unclutter if needed)
  if ! command -v unclutter &>/dev/null; then
    sudo apt-get install -y -qq unclutter 2>/dev/null || true
  fi

  # Cursor-hide autostart
  cat > "${AUTOSTART_DIR}/agent-os-cursor.desktop" << CURSOREOF
[Desktop Entry]
Type=Application
Name=Hide Cursor
Exec=unclutter -idle 3 -root
X-GNOME-Autostart-enabled=true
CURSOREOF
  print_step "Cursor auto-hide configured"

  # Kiosk launcher autostart
  cat > "${AUTOSTART_DIR}/agent-os-kiosk.desktop" << KIOSKEOF
[Desktop Entry]
Type=Application
Name=Agent-OS Kiosk
Comment=Launch Agent-OS dashboard in kiosk mode
Exec=bash -c 'for i in \$(seq 1 60); do curl -s -o /dev/null http://localhost:${APP_PORT} && break; sleep 2; done; ${CHROMIUM_BIN} --noerrdialogs --disable-infobars --disable-session-crashed-bubble --disable-component-update --kiosk --incognito --no-first-run --disable-pinch --overscroll-history-navigation=0 --touch-events=enabled --enable-touch-drag-drop --disable-translate --disable-features=TranslateUI --disable-background-networking --disable-sync --disable-default-apps --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 --start-fullscreen --window-position=0,0 http://localhost:${APP_PORT}'
X-GNOME-Autostart-enabled=true
KIOSKEOF
  print_step "Kiosk autostart configured"

  # Manual launch script
  cat > "/home/${PI_USER}/start-kiosk.sh" << MANUALEOF
#!/bin/bash
# Manual kiosk launcher — run this if kiosk doesn't auto-start
echo "Waiting for Agent-OS..."
for i in \$(seq 1 60); do
  curl -s -o /dev/null http://localhost:${APP_PORT} && break
  sleep 2
done

${CHROMIUM_BIN} \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-component-update \\
  --kiosk \\
  --incognito \\
  --no-first-run \\
  --disable-pinch \\
  --overscroll-history-navigation=0 \\
  --touch-events=enabled \\
  --enable-touch-drag-drop \\
  --enable-features=OverlayScrollbar \\
  --disable-features=TranslateUI,TouchTextEditingRedesign \\
  --disable-touch-adjustment \\
  --force-device-scale-factor=1 \\
  --disable-translate \\
  --disable-background-networking \\
  --disable-sync \\
  --disable-default-apps \\
  --autoplay-policy=no-user-gesture-required \\
  --check-for-update-interval=31536000 \\
  --start-fullscreen \\
  --window-position=0,0 \\
  http://localhost:${APP_PORT}
MANUALEOF
  chmod +x "/home/${PI_USER}/start-kiosk.sh"
  print_step "~/start-kiosk.sh created"
}

# --- 5. Utility scripts + final checks ---
create_utilities() {
  echo -e "${CYAN}[5/5]${NC} ${BOLD}Utility scripts & verification${NC}"

  # Status checker
  cat > "/home/${PI_USER}/agent-os-status.sh" << STATEOF
#!/bin/bash
echo ""
echo -e "\033[1m  Agent-OS Status\033[0m"
echo "  ─────────────────────────────────────"
echo -n "  Service:    "
if systemctl is-active --quiet agent-os; then
  echo -e "\033[32m● Running\033[0m"
else
  echo -e "\033[31m● Stopped\033[0m"
fi
echo -n "  Dashboard:  "
HTTP=\$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${APP_PORT} 2>/dev/null)
if [ "\$HTTP" = "200" ] || [ "\$HTTP" = "304" ]; then
  echo -e "\033[32mhttp://localhost:${APP_PORT}\033[0m"
else
  echo -e "\033[31mNot responding (HTTP \$HTTP)\033[0m"
fi
echo -n "  Network:    "
IP=\$(hostname -I 2>/dev/null | awk '{print \$1}')
echo "http://\${IP:-?}:${APP_PORT}"
echo -n "  Uptime:     "
systemctl show agent-os --property=ActiveEnterTimestamp --value 2>/dev/null || echo "unknown"
echo -n "  CPU Temp:   "
vcgencmd measure_temp 2>/dev/null | sed 's/temp=//' || echo "unknown"
echo -n "  Memory:     "
free -h | awk '/^Mem:/ {printf "%s / %s (%s used)\n", \$3, \$2, \$3}'
echo ""
echo "  Commands:"
echo "    sudo systemctl restart agent-os   # Restart app"
echo "    sudo journalctl -u agent-os -f    # View logs"
echo "    ~/start-kiosk.sh                  # Start kiosk manually"
echo "    ~/agent-os-update.sh              # Pull + rebuild"
echo ""
STATEOF
  chmod +x "/home/${PI_USER}/agent-os-status.sh"
  print_step "~/agent-os-status.sh — quick status check"

  # Update script
  cat > "/home/${PI_USER}/agent-os-update.sh" << UPDATEEOF
#!/bin/bash
echo "Updating Agent-OS..."
cd ${APP_DIR}
git pull 2>/dev/null || echo "Not a git repo — skipping pull"
npm ci --production 2>/dev/null || npm install --production
npx next build
sudo systemctl restart agent-os
echo "Update complete! Dashboard restarting..."
sleep 3
~/agent-os-status.sh
UPDATEEOF
  chmod +x "/home/${PI_USER}/agent-os-update.sh"
  print_step "~/agent-os-update.sh — one-command update"

  # Touchscreen calibration helper
  if command -v xinput_calibrator &>/dev/null; then
    cat > "/home/${PI_USER}/calibrate-touch.sh" << 'CALIBEOF'
#!/bin/bash
echo "Starting touchscreen calibration..."
echo "Touch the crosshairs as they appear."
echo "(Press Ctrl+C to cancel)"
DISPLAY=:0 xinput_calibrator --output-type xorg.conf.d
echo ""
echo "If calibration worked, copy the output above into:"
echo "  /etc/X11/xorg.conf.d/99-calibration.conf"
CALIBEOF
    chmod +x "/home/${PI_USER}/calibrate-touch.sh"
    print_step "~/calibrate-touch.sh — touchscreen calibration"
  fi

  # Fix ownership
  sudo chown -R "${PI_USER}:${PI_USER}" "/home/${PI_USER}/start-kiosk.sh" "/home/${PI_USER}/agent-os-status.sh" "/home/${PI_USER}/agent-os-update.sh" 2>/dev/null || true

  # Final verification
  echo ""
  if systemctl is-active --quiet agent-os; then
    print_step "agent-os service is RUNNING"
  else
    print_warn "agent-os service is not running"
    print_info "Run: sudo journalctl -u agent-os -n 50"
  fi

  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${APP_PORT}" 2>/dev/null | grep -q "200\|304"; then
    print_step "Dashboard accessible at http://localhost:${APP_PORT}"
  else
    print_warn "Dashboard may still be starting..."
    print_info "Check: curl http://localhost:${APP_PORT}"
  fi
}

print_summary() {
  IP=$(hostname -I 2>/dev/null | awk '{print $1}')

  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}${BOLD}     ✓ Agent-OS deployed successfully!${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${BOLD}Dashboard:${NC}  http://localhost:${APP_PORT}"
  [ -n "${IP:-}" ] && echo -e "  ${BOLD}Network:${NC}    http://${IP}:${APP_PORT}"
  echo ""
  echo -e "  ${BOLD}Handy scripts:${NC}"
  echo -e "    ~/agent-os-status.sh     ${DIM}— check everything's running${NC}"
  echo -e "    ~/agent-os-update.sh     ${DIM}— pull, rebuild, restart${NC}"
  echo -e "    ~/start-kiosk.sh         ${DIM}— launch kiosk manually${NC}"
  echo ""
  echo -e "  ${BOLD}Kiosk:${NC}       Auto-starts Chromium fullscreen on desktop login"
  echo -e "  ${BOLD}Exit kiosk:${NC}  Alt+F4  |  ${BOLD}Terminal:${NC}  Ctrl+Alt+T"
  echo ""
  echo -e "  ${BOLD}Commands:${NC}"
  echo -e "    sudo systemctl status agent-os   ${DIM}# Service status${NC}"
  echo -e "    sudo systemctl restart agent-os  ${DIM}# Restart app${NC}"
  echo -e "    sudo journalctl -u agent-os -f   ${DIM}# View logs${NC}"
  echo ""
}

# --- Execute ---
if [ "$KIOSK_ONLY" = true ]; then
  setup_kiosk
  print_summary
  exit 0
fi

if [ "$APP_ONLY" = true ]; then
  install_node
  setup_app
  create_service
  create_utilities
  print_summary
  exit 0
fi

install_node
setup_app
create_service
setup_kiosk
create_utilities
print_summary
