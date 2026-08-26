# Device BOM & handoff card

## Hardware bill of materials

| Qty | Item | Spec | Purpose |
|-----|------|------|---------|
| 1 | Raspberry Pi 5 (or 4 4GB+) | 64-bit | Control plane host |
| 1 | microSD 32GB+ A2 (or NVMe) | Bookworm image | System disk |
| 1 | Official PSU | Pi 5: 27W USB-C | Stable power |
| 1 | Touch display | 7" DSI or HDMI touch | Kiosk UI |
| 1 | Case / stand | VESA or official | Desk / wall |
| 1 | Ethernet cable (preferred) | Cat5e+ | Reliable LAN |
| 1 | USB keyboard (spare) | Any | Demo recovery |
| Optional | USB SSD | Boot/data | Faster IO |

## Software image

| Component | Version / note |
|-----------|----------------|
| OS | **Raspberry Pi OS Bookworm 64-bit** (Desktop or Lite) |
| Node.js | 20.x (installed by deploy script) |
| App | Agent OS from this repo (`npm run build` + `next start`) |
| Browser | Chromium `--kiosk` |
| Init | systemd `agent-os.service` + desktop autostart |

## Flash checklist

1. Raspberry Pi Imager → Bookworm 64-bit  
2. Enable SSH + set user `pi` + Wi‑Fi if needed  
3. First boot → `git clone` / copy repo → `./deploy-pi.sh` or `./deploy-pi-lite.sh`  
4. Verify `curl localhost:3000`  
5. Reboot → confirm kiosk  

## Handoff card (print & tape to device)

```text
╔══════════════════════════════════════════╗
║  AGENT OS KIOSK                          ║
║  Hostname: agent-os-pi                   ║
║  User:     pi                            ║
║  App:      http://localhost:3000         ║
║  LAN IP:   _________________________     ║
║                                          ║
║  Restart app:  sudo systemctl restart agent-os
║  Start kiosk:  ~/start-kiosk.sh          ║
║  Logs:         journalctl -u agent-os -f ║
║                                          ║
║  OS MUST stay Bookworm (not Trixie)      ║
║  Docs: docs/agent-os/WEEK_1_DEVICE_FIRMWARE.md
╚══════════════════════════════════════════╝
```

## Network labels (fill in)

| Host | IP | Port | Role |
|------|-----|------|------|
| Pi (Agent OS) | | 3000 | Control plane + kiosk |
| Hermes | 192.168.0.168 | 3000 / 8642 | Runtime |
| Honcho | 192.168.0.99 | 8000 | Memory |
| OpenClaw | | 18789 | Runtime (optional) |
