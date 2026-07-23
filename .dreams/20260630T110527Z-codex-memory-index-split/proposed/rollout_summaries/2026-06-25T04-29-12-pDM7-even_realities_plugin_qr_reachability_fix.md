thread_id: 019efd0a-01e8-7680-abd8-601913bd90db
updated_at: 2026-06-25T04:29:12+00:00
rollout_path: C:\Users\Yoshi\.codex\sessions\2026\06\24\rollout-2026-06-24T21-29-12-019efd0a-01e8-7680-abd8-601913bd90db.jsonl
cwd: \\?\C:\Users\Yoshi\AppData\Local\Temp

# Plugin QR / reachability fix for Even Realities dev

Rollout context: The user was troubleshooting a Claude Code/Even Realities plugin setup on Windows/WSL, where the QR + URL flow was confusing because the script was printing a WSL IP and the phone/app couldn’t load the prototype.

## Task 1: Fix plugin URL / QR and remote reachability

Outcome: partial

Preference signals:
- The user asked, "It gives me the plugin url, backend url and token. I just need the plugin url as the qr code?" -> they wanted the QR to contain only the plugin URL, with backend URL/token handled separately.
- When told the phone would not be on the same Wi‑Fi, the user said, "ok perfect. It's already isntalled on both devices" -> they were receptive to a tunnel-based solution and already had Tailscale on both devices, so future help can assume that option may already be available.

Key steps:
- The assistant said the QR should use only the plugin URL and that backend URL/token are entered inside the plugin after loading.
- To diagnose the long-loading prototype, the assistant suggested testing the plugin URL directly in a phone browser and, if needed, opening Windows Firewall for ports 5173 and 8787.
- When the script produced `http://172.22.32.1:5173`, the assistant identified it as a WSL virtual adapter IP and instructed using the actual Wi‑Fi/internal LAN IP instead.
- Because the user would not be on the same Wi‑Fi, the assistant pivoted to tunnel options and recommended Tailscale as the durable choice, with ngrok as a quick fallback.

Failures and how to do differently:
- The printed `172.22.32.1` address was the wrong interface for phone reachability; future runs should treat WSL/virtual adapter IPs as invalid for this use case and immediately look for a reachable LAN/VPN address.
- If the user cannot be on the same Wi‑Fi, do not keep iterating on local LAN URLs; pivot quickly to Tailscale/ngrok or another tunnel.

Reusable knowledge:
- For this Even Realities plugin flow, the QR uses only the plugin URL; backend URL and token are entered later in the app UI.
- A WSL IP like `172.22.32.1` is not reachable from a phone for sideload testing; it indicates the script selected the wrong interface.
- Tailscale can provide a stable `100.x.x.x` address across devices/networks, which is useful when phone and PC are not on the same Wi‑Fi.

References:
- Plugin dev path touched: `C:\Users\Yoshi\.agent_even\cc-g2-win\dev.ps1`
- QR helper written: `C:\Users\Yoshi\.agent_even\cc-g2-win\backend\gen_qr.py`
- Exact bad URL reported: `http://172.22.32.1:5173`
- Suggested LAN IP discovery command: `Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch "^(127\.|169\.|172\.)" } | Select-Object IPAddress, InterfaceAlias`
- Suggested tunnel options: Tailscale or `ngrok http 5173` / `ngrok http 8787`
