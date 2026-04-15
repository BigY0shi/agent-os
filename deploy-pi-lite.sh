#!/bin/bash
# ============================================================================
#
#     █████╗  ██████╗ ███████╗███╗   ██╗████████╗       ██████╗ ███████╗
#    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝      ██╔═══██╗██╔════╝
#    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   █████╗██║   ██║███████╗
#    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ╚════╝██║   ██║╚════██║
#    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║          ╚██████╔╝███████║
#    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝           ╚═════╝ ╚══════╝
#
#    Raspberry Pi Lite Deployment — Interactive Guided Installer
#
# ============================================================================
#
#  For Raspberry Pi OS LITE (no desktop). Installs everything from scratch:
#    • X11 display server (minimal, no full desktop)
#    • Chromium browser
#    • Node.js 20
#    • Agent-OS Next.js app
#    • Systemd services for app + kiosk
#    • Touchscreen drivers + calibration
#    • Screen rotation, power management, autologin
#
#  ⚠ IMPORTANT: Use Bookworm Lite, NOT Trixie Lite.
#    Trixie replaced X11/openbox with Wayland/labwc. This script installs
#    X11 + openbox + LightDM, which work perfectly on Bookworm but have
#    known conflicts on Trixie. Bookworm Lite 64-bit is the target OS.
#    Download: https://www.raspberrypi.com/software/operating-systems/
#
#  Run:
#    curl -sSL <your-url>/deploy-pi-lite.sh | bash
#    — or —
#    chmod +x deploy-pi-lite.sh && ./deploy-pi-lite.sh
#
# ============================================================================

set -euo pipefail

# ============================================================================
# Colors & Helpers
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

print_header() {
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  $1${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
}

print_step() {
  echo -e "${GREEN}  ✓${NC} $1"
}

print_info() {
  echo -e "${BLUE}  ℹ${NC} $1"
}

print_warn() {
  echo -e "${YELLOW}  ⚠${NC} $1"
}

print_error() {
  echo -e "${RED}  ✗${NC} $1"
}

print_progress() {
  echo -e "${DIM}  ⏳ $1...${NC}"
}

ask_yes_no() {
  local prompt="$1"
  local default="${2:-y}"
  local yn_hint="[Y/n]"
  [ "$default" = "n" ] && yn_hint="[y/N]"

  while true; do
    echo -en "${BOLD}  → ${NC}${prompt} ${DIM}${yn_hint}${NC} "
    read -r answer
    answer="${answer:-$default}"
    case "$answer" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo -e "    ${DIM}Please answer y or n${NC}" ;;
    esac
  done
}

ask_choice() {
  local prompt="$1"
  shift
  local options=("$@")
  local count=${#options[@]}

  echo -e "${BOLD}  → ${NC}${prompt}"
  for i in "${!options[@]}"; do
    echo -e "    ${CYAN}$((i+1))${NC}) ${options[$i]}"
  done

  while true; do
    echo -en "    ${DIM}Enter choice [1-${count}]:${NC} "
    read -r choice
    if [[ "$choice" =~ ^[0-9]+$ ]] && [ "$choice" -ge 1 ] && [ "$choice" -le "$count" ]; then
      CHOICE_RESULT=$((choice - 1))
      return 0
    fi
    echo -e "    ${DIM}Invalid choice, try again${NC}"
  done
}

ask_input() {
  local prompt="$1"
  local default="$2"
  echo -en "${BOLD}  → ${NC}${prompt} ${DIM}[${default}]:${NC} "
  read -r answer
  INPUT_RESULT="${answer:-$default}"
}

spinner() {
  local pid=$1
  local delay=0.1
  local spin='⣾⣽⣻⢿⡿⣟⣯⣷'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}%s${NC} " "${spin:i++%${#spin}:1}"
    sleep $delay
  done
  printf "\r    \r"
}

# ============================================================================
# Pre-flight checks
# ============================================================================
print_header "Agent-OS — Raspberry Pi Lite Installer"

echo -e "  Welcome! This script will turn your Pi into a dedicated"
echo -e "  Agent-OS dashboard tablet. It will install everything"
echo -e "  needed — display server, browser, app, and kiosk mode."
echo ""
echo -e "  ${DIM}Designed for Raspberry Pi OS Lite (Bookworm 64-bit)${NC}"
echo -e "  ${DIM}Works on Pi 4, Pi 5, and CM4${NC}"
echo ""

# OS version check — warn if not Bookworm
if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_CODENAME="${VERSION_CODENAME:-unknown}"
  if [ "$OS_CODENAME" = "bookworm" ]; then
    print_step "Raspberry Pi OS Bookworm detected"
  elif [ "$OS_CODENAME" = "trixie" ]; then
    echo ""
    print_error "Raspberry Pi OS Trixie detected — NOT RECOMMENDED"
    echo -e "    ${YELLOW}Trixie replaced X11/openbox with Wayland/labwc. This script${NC}"
    echo -e "    ${YELLOW}installs X11 + openbox + LightDM, which have known conflicts${NC}"
    echo -e "    ${YELLOW}on Trixie (broken autologin, missing sessions, kiosk failures).${NC}"
    echo ""
    echo -e "    ${BOLD}Strongly recommended:${NC} Flash Bookworm Lite 64-bit instead."
    echo -e "    ${DIM}https://www.raspberrypi.com/software/operating-systems/${NC}"
    echo ""
    if ! ask_yes_no "Continue anyway at your own risk?" "n"; then
      echo -e "    ${DIM}Aborted. Flash Bookworm Lite and re-run.${NC}"
      exit 0
    fi
    print_warn "Proceeding on Trixie — some features may not work"
  else
    print_info "OS codename: ${OS_CODENAME}"
  fi
fi
echo ""

# Check if root
if [ "$EUID" -eq 0 ]; then
  print_warn "Running as root. The installer will create a non-root service user."
fi

# Check architecture
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" && "$ARCH" != "armv7l" ]]; then
  print_warn "Detected architecture: ${ARCH} (expected aarch64 or armv7l)"
  if ! ask_yes_no "Continue anyway?"; then
    exit 1
  fi
fi

# Check connectivity
print_progress "Checking internet connectivity"
if ! ping -c 1 -W 3 google.com &>/dev/null && ! ping -c 1 -W 3 8.8.8.8 &>/dev/null; then
  print_error "No internet connection detected."
  echo -e "    ${DIM}Connect via ethernet or configure WiFi first:${NC}"
  echo -e "    ${DIM}  sudo raspi-config → System Options → Wireless LAN${NC}"
  exit 1
fi
print_step "Internet connected"

# ============================================================================
# Step 1: Configuration
# ============================================================================
print_header "Step 1 of 7 — Configuration"

# Detect current user
CURRENT_USER=$(whoami)
if [ "$CURRENT_USER" = "root" ]; then
  ask_input "Which user should run Agent-OS?" "pi"
  PI_USER="$INPUT_RESULT"
else
  PI_USER="$CURRENT_USER"
  print_info "Running as user: ${PI_USER}"
fi

# App location
APP_DIR="/home/${PI_USER}/agent-os"
ask_input "Install location" "$APP_DIR"
APP_DIR="$INPUT_RESULT"

# Port
ask_input "Dashboard port" "3000"
APP_PORT="$INPUT_RESULT"

# Screen rotation
echo ""
ask_choice "Screen orientation" \
  "Normal (landscape, no rotation)" \
  "90° clockwise (portrait, USB ports on top)" \
  "180° (upside-down landscape)" \
  "270° clockwise (portrait, USB ports on bottom)"
ROTATION=$CHOICE_RESULT

# Touchscreen
HAS_TOUCHSCREEN=false
if ask_yes_no "Is a touchscreen connected (official Pi display or USB)?"; then
  HAS_TOUCHSCREEN=true
fi

# Resolution override
CUSTOM_RES=false
SCREEN_W=0
SCREEN_H=0
if ask_yes_no "Override screen resolution?" "n"; then
  CUSTOM_RES=true
  ask_input "Width (pixels)" "1024"
  SCREEN_W="$INPUT_RESULT"
  ask_input "Height (pixels)" "600"
  SCREEN_H="$INPUT_RESULT"
fi

# App source
echo ""
ask_choice "Where is the Agent-OS source code?" \
  "Clone from GitHub (I'll enter the repo URL)" \
  "Already on this Pi at ${APP_DIR}" \
  "Copy from USB drive"
SOURCE_METHOD=$CHOICE_RESULT

REPO_URL=""
USB_PATH=""
if [ "$SOURCE_METHOD" -eq 0 ]; then
  ask_input "GitHub repo URL" "https://github.com/BigY0shi/agent-os.git"
  REPO_URL="$INPUT_RESULT"
elif [ "$SOURCE_METHOD" -eq 2 ]; then
  ask_input "USB mount path" "/media/${PI_USER}/USB"
  USB_PATH="$INPUT_RESULT"
fi

# Confirmation
echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}Configuration Summary${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  User:         ${BOLD}${PI_USER}${NC}"
echo -e "  Install dir:  ${BOLD}${APP_DIR}${NC}"
echo -e "  Port:         ${BOLD}${APP_PORT}${NC}"
echo -e "  Rotation:     ${BOLD}${ROTATION} (0=none, 1=90°, 2=180°, 3=270°)${NC}"
echo -e "  Touchscreen:  ${BOLD}${HAS_TOUCHSCREEN}${NC}"
[ "$CUSTOM_RES" = true ] && echo -e "  Resolution:   ${BOLD}${SCREEN_W}x${SCREEN_H}${NC}"
echo ""

if ! ask_yes_no "Proceed with installation?"; then
  echo -e "  ${DIM}Aborted.${NC}"
  exit 0
fi

# ============================================================================
# Step 2: System packages
# ============================================================================
print_header "Step 2 of 7 — Installing system packages"

print_progress "Updating package lists"
sudo apt-get update -qq

# Core X11 + display
PACKAGES=(
  # Minimal X11
  xserver-xorg
  x11-xserver-utils
  xinit
  xdotool

  # Window manager (ultra-lightweight, just enough to run Chromium)
  openbox

  # Chromium
  chromium-browser

  # Touch support
  libinput-tools
  xserver-xorg-input-libinput

  # Utilities
  unclutter        # Auto-hide cursor
  lightdm          # Display manager for autologin
  git
  curl
  rsync
)

# Add touchscreen calibration tools if needed
if [ "$HAS_TOUCHSCREEN" = true ]; then
  PACKAGES+=(xinput-calibrator)
fi

print_progress "Installing ${#PACKAGES[@]} packages (this may take a few minutes)"
sudo apt-get install -y -qq "${PACKAGES[@]}" 2>&1 | while read -r line; do
  echo -ne "\r  ${DIM}⏳ ${line:0:60}${NC}                    "
done
echo ""
print_step "System packages installed"

# ============================================================================
# Step 3: Node.js
# ============================================================================
print_header "Step 3 of 7 — Installing Node.js"

NODE_NEEDED=true
if command -v node &>/dev/null; then
  CURRENT_NODE=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$CURRENT_NODE" -ge 20 ]; then
    print_step "Node.js $(node -v) already installed"
    NODE_NEEDED=false
  fi
fi

if [ "$NODE_NEEDED" = true ]; then
  print_progress "Installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - &>/dev/null
  sudo apt-get install -y -qq nodejs
  print_step "Node.js $(node -v) installed"
fi

print_step "npm $(npm -v)"

# ============================================================================
# Step 4: Agent-OS application
# ============================================================================
print_header "Step 4 of 7 — Setting up Agent-OS"

# Get the source
case $SOURCE_METHOD in
  0) # Git clone
    if [ -d "$APP_DIR/.git" ]; then
      print_info "Repo already exists, pulling latest..."
      cd "$APP_DIR"
      git pull
    else
      print_progress "Cloning from ${REPO_URL}"
      git clone "$REPO_URL" "$APP_DIR"
      cd "$APP_DIR"
    fi
    ;;
  1) # Already present
    if [ ! -f "${APP_DIR}/package.json" ]; then
      print_error "No package.json found at ${APP_DIR}"
      echo -e "    ${DIM}Make sure Agent-OS files are at that location${NC}"
      exit 1
    fi
    cd "$APP_DIR"
    print_step "Using existing files at ${APP_DIR}"
    ;;
  2) # USB
    if [ ! -d "$USB_PATH" ]; then
      print_error "USB path not found: ${USB_PATH}"
      exit 1
    fi
    print_progress "Copying from USB"
    mkdir -p "$APP_DIR"
    rsync -av --exclude='node_modules' --exclude='.next' --exclude='.git' "${USB_PATH}/" "${APP_DIR}/"
    cd "$APP_DIR"
    print_step "Copied from USB"
    ;;
esac

# Install dependencies
print_progress "Installing npm dependencies"
npm ci 2>/dev/null || npm install
print_step "Dependencies installed"

# Build
print_progress "Building Next.js production bundle (this takes 2-5 min on Pi)"
if ! npx next build; then
  print_error "Build failed — see output above"
  exit 1
fi
print_step "Production build complete"

# Ensure data directory
mkdir -p data

# Remove old DB for clean start if it exists
if [ -f "data/agent-os.db" ]; then
  if ask_yes_no "Remove existing database for a clean start?" "y"; then
    rm -f data/agent-os.db
    print_step "Old database removed — fresh seed data on first launch"
  fi
fi

# ============================================================================
# Step 5: Display & kiosk configuration
# ============================================================================
print_header "Step 5 of 7 — Configuring display & kiosk"

# --- Screen rotation ---
if [ "$ROTATION" -ne 0 ]; then
  print_progress "Setting screen rotation to ${ROTATION}"

  # For Pi OS Bookworm with KMS/DRM
  ROTATE_LINE="display_hdmi_rotate=${ROTATION}"
  if grep -q "^display_hdmi_rotate" /boot/firmware/config.txt 2>/dev/null; then
    sudo sed -i "s/^display_hdmi_rotate=.*/${ROTATE_LINE}/" /boot/firmware/config.txt
  elif grep -q "^display_hdmi_rotate" /boot/config.txt 2>/dev/null; then
    sudo sed -i "s/^display_hdmi_rotate=.*/${ROTATE_LINE}/" /boot/config.txt
  else
    CONFIG_FILE="/boot/firmware/config.txt"
    [ ! -f "$CONFIG_FILE" ] && CONFIG_FILE="/boot/config.txt"
    echo "$ROTATE_LINE" | sudo tee -a "$CONFIG_FILE" > /dev/null
  fi

  # X11 rotation for touch input mapping
  XRANDR_ROT=("normal" "right" "inverted" "left")
  print_step "Rotation set to ${XRANDR_ROT[$ROTATION]}"
fi

# --- Resolution override ---
if [ "$CUSTOM_RES" = true ]; then
  CONFIG_FILE="/boot/firmware/config.txt"
  [ ! -f "$CONFIG_FILE" ] && CONFIG_FILE="/boot/config.txt"

  sudo tee -a "$CONFIG_FILE" > /dev/null << RESEOF

# Agent-OS custom resolution
hdmi_group=2
hdmi_mode=87
hdmi_cvt=${SCREEN_W} ${SCREEN_H} 60 6 0 0 0
RESEOF
  print_step "Resolution set to ${SCREEN_W}x${SCREEN_H}"
fi

# --- Disable screen blanking / power management ---
print_progress "Disabling screen blanking and power management"

# Console blanking
sudo tee /etc/systemd/system/disable-blanking.service > /dev/null << 'BLANKEOF'
[Unit]
Description=Disable console blanking

[Service]
Type=oneshot
ExecStart=/usr/bin/setterm --blank 0 --powerdown 0
ExecStart=/usr/bin/sh -c "echo 0 > /sys/class/graphics/fb0/blank"
StandardOutput=tty
TTYPath=/dev/tty1

[Install]
WantedBy=multi-user.target
BLANKEOF
sudo systemctl enable disable-blanking.service 2>/dev/null
print_step "Screen blanking disabled"

# --- Touchscreen calibration reminder ---
if [ "$HAS_TOUCHSCREEN" = true ]; then
  print_info "Touchscreen detected — calibration available after install"
  print_info "Run: xinput_calibrator (from an X session)"
fi

# --- Configure LightDM for autologin ---
print_progress "Configuring autologin"
sudo mkdir -p /etc/lightdm/lightdm.conf.d

sudo tee /etc/lightdm/lightdm.conf.d/50-agent-os.conf > /dev/null << LIGHTDMEOF
[Seat:*]
autologin-user=${PI_USER}
autologin-user-timeout=0
user-session=agent-os
greeter-session=lightdm-gtk-greeter
LIGHTDMEOF
print_step "Autologin configured for ${PI_USER}"

# --- Create custom Openbox session ---
print_progress "Creating kiosk session"

# Openbox autostart for the kiosk
OPENBOX_DIR="/home/${PI_USER}/.config/openbox"
mkdir -p "$OPENBOX_DIR"

CHROMIUM_BIN=$(command -v chromium-browser 2>/dev/null || command -v chromium 2>/dev/null || echo "chromium-browser")
XRANDR_CMD=""
if [ "$ROTATION" -ne 0 ]; then
  XRANDR_ROT=("normal" "right" "inverted" "left")
  XRANDR_CMD="xrandr --output \$(xrandr | grep ' connected' | head -1 | cut -d' ' -f1) --rotate ${XRANDR_ROT[$ROTATION]}"
fi

cat > "${OPENBOX_DIR}/autostart" << AUTOEOF
#!/bin/bash
# ============================================
# Agent-OS Kiosk — Openbox Autostart
# ============================================

# Disable screensaver & DPMS
xset s off
xset s nofade
xset -dpms
xset s 0 0

# Hide cursor after 3 seconds of inactivity
unclutter -idle 3 -root &

# Screen rotation (if configured)
${XRANDR_CMD}

# Wait for Agent-OS to be ready
echo "Waiting for Agent-OS on port ${APP_PORT}..."
for i in \$(seq 1 60); do
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:${APP_PORT} 2>/dev/null | grep -q "200\|304"; then
    echo "Agent-OS is ready!"
    break
  fi
  sleep 2
done

# Launch Chromium in kiosk mode
${CHROMIUM_BIN} \\
  --kiosk \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-component-update \\
  --incognito \\
  --no-first-run \\
  --overscroll-history-navigation=0 \\
  --touch-events=enabled \\
  --enable-touch-drag-drop \\
  --enable-features=OverlayScrollbar \\
  --disable-features=TranslateUI,TouchTextEditingRedesign \\
  --disable-touch-adjustment \\
  --force-device-scale-factor=1 \\
  --disable-translate \\
  --check-for-update-interval=31536000 \\
  --disable-background-networking \\
  --disable-sync \\
  --disable-default-apps \\
  --autoplay-policy=no-user-gesture-required \\
  --start-fullscreen \\
  --window-position=0,0 \\
  http://localhost:${APP_PORT}
AUTOEOF
chmod +x "${OPENBOX_DIR}/autostart"

# Create the X session file so LightDM can find it
sudo tee /usr/share/xsessions/agent-os.desktop > /dev/null << XSESSEOF
[Desktop Entry]
Name=Agent-OS Kiosk
Comment=Agent-OS Dashboard in Kiosk Mode
Exec=openbox-session
Type=Application
XSESSEOF

print_step "Kiosk session created"

# ============================================================================
# Step 6: Systemd service for the app
# ============================================================================
print_header "Step 6 of 7 — Creating Agent-OS service"

sudo tee /etc/systemd/system/agent-os.service > /dev/null << SVCEOF
[Unit]
Description=Agent-OS Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${PI_USER}
Group=${PI_USER}
WorkingDirectory=${APP_DIR}
ExecStart=$(which node) ${APP_DIR}/node_modules/.bin/next start -p ${APP_PORT}
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
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable agent-os
sudo systemctl start agent-os

print_step "agent-os.service created and started"

# Wait for it to come up
print_progress "Waiting for dashboard to start"
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" "http://localhost:${APP_PORT}" 2>/dev/null | grep -q "200\|304"; then
    print_step "Dashboard is live on port ${APP_PORT}"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    print_warn "Dashboard hasn't responded yet — it may still be starting"
    print_info "Check: sudo journalctl -u agent-os -f"
  fi
done

# ============================================================================
# Step 7: Manual kiosk launcher + utilities
# ============================================================================
print_header "Step 7 of 7 — Creating utility scripts"

# Manual kiosk launcher
cat > "/home/${PI_USER}/start-kiosk.sh" << 'MANEOF'
#!/bin/bash
echo "Starting Agent-OS kiosk..."
startx /usr/bin/openbox-session
MANEOF
chmod +x "/home/${PI_USER}/start-kiosk.sh"
print_step "~/start-kiosk.sh — manual kiosk launcher"

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
echo -e "http://\${IP:-?}:${APP_PORT}"
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
if [ "$HAS_TOUCHSCREEN" = true ]; then
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
sudo chown -R "${PI_USER}:${PI_USER}" "/home/${PI_USER}/"

# ============================================================================
# Done!
# ============================================================================
IP=$(hostname -I 2>/dev/null | awk '{print $1}')

echo ""
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}"
echo "     ✓ Agent-OS installed successfully!"
echo -e "${NC}${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}Dashboard:${NC}  http://localhost:${APP_PORT}"
[ -n "$IP" ] && echo -e "  ${BOLD}Network:${NC}    http://${IP}:${APP_PORT}"
echo ""
echo -e "  ${BOLD}What happens on reboot:${NC}"
echo -e "    1. Pi boots and auto-logs in as ${PI_USER}"
echo -e "    2. agent-os service starts the dashboard"
echo -e "    3. Openbox launches Chromium in fullscreen kiosk"
echo -e "    4. Dashboard loads — ready for touch"
echo ""
echo -e "  ${BOLD}Handy scripts:${NC}"
echo -e "    ~/agent-os-status.sh     ${DIM}— check everything's running${NC}"
echo -e "    ~/agent-os-update.sh     ${DIM}— pull, rebuild, restart${NC}"
echo -e "    ~/start-kiosk.sh         ${DIM}— launch kiosk manually${NC}"
[ "$HAS_TOUCHSCREEN" = true ] && echo -e "    ~/calibrate-touch.sh     ${DIM}— calibrate touchscreen${NC}"
echo ""
echo -e "  ${BOLD}Exit kiosk:${NC}  Alt+F4  |  ${BOLD}Terminal:${NC}  Ctrl+Alt+F2"
echo -e "  ${BOLD}Restart app:${NC} sudo systemctl restart agent-os"
echo -e "  ${BOLD}View logs:${NC}   sudo journalctl -u agent-os -f"
echo ""

if ask_yes_no "Reboot now to enter kiosk mode?"; then
  echo ""
  echo -e "  ${CYAN}Rebooting in 3 seconds...${NC}"
  sleep 3
  sudo reboot
else
  echo ""
  echo -e "  ${DIM}Reboot when you're ready:  sudo reboot${NC}"
  echo ""
fi
