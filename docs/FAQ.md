# FAQ & Troubleshooting

---

## General

**Q: What is Agent-OS?**  
Agent-OS is a self-hosted dashboard for managing AI agents organized as a corporate hierarchy. It handles the full agent lifecycle — from ideation and spec authoring through to deployment and observation — and generates deploy-ready AGENT.md and SKILL.md files for your agent harnesses (CrewAI, OpenClaw, etc.).

**Q: Does Agent-OS run the agents itself?**  
Not yet. In v1.0, Agent-OS is a management and scaffolding layer. Your agents actually execute in your harness (CrewAI on Proxmox, OpenClaw, etc.). Live harness integration is on the roadmap for v1.2.

**Q: Is my data stored in the cloud?**  
No. Everything is stored in `data/agent-os.db` — a local SQLite file on your machine or Pi. Nothing leaves your network.

**Q: What browsers are supported?**  
Any modern browser. Optimized for Chrome/Chromium on the Pi kiosk. Firefox and Safari work for desktop access.

---

## Installation

**Q: `npm install` fails with EACCES permission errors**  
You have a global npm permissions issue. Fix:

```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install
```

**Q: `npm run dev` shows `Error: Cannot find module 'next'`**  
Dependencies weren't installed. Run `npm install` first.

**Q: Port 3000 is already in use**  
Run on a different port:

```bash
PORT=3001 npm run dev
```

Or find and kill the process using port 3000:

```bash
# Mac/Linux
lsof -ti:3000 | xargs kill

# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Q: The app starts but shows a blank white page**  
Open your browser's developer console (F12). Usually caused by a JavaScript error on first load. Common causes:
- `data/` directory doesn't exist — create it with `mkdir data`
- SQLite WASM failed to load — try a hard refresh (Ctrl+Shift+R)
- Next.js build cache is stale — run `rm -rf .next && npm run dev`

---

## Database

**Q: Where is my data stored?**  
`data/agent-os.db` in the project root. This is a standard SQLite file — you can open it with any SQLite viewer (DB Browser for SQLite, TablePlus, etc.).

**Q: How do I reset to the seed data?**  
Delete the database file and restart:

```bash
rm data/agent-os.db
npm run dev
```

On next startup Agent-OS creates a fresh database and runs the seed data.

**Q: How do I back up my data?**  
Simply copy `data/agent-os.db` somewhere safe. That's your entire dataset.

```bash
cp data/agent-os.db ~/backups/agent-os-$(date +%Y%m%d).db
```

**Q: Can I migrate data between machines?**  
Yes — copy `data/agent-os.db` from one machine to the other. The schema is the same on all installs.

---

## Raspberry Pi Deployment

**Q: Which Pi OS should I use?**  
**Raspberry Pi OS Bookworm 64-bit.** Both Desktop and Lite variants work with the deploy scripts.

**Q: Can I use Trixie?**  
Not recommended. Trixie replaced X11/openbox with Wayland/labwc, which breaks the kiosk autostart, screen blanking controls, xrandr rotation, and LightDM autologin used by the deploy scripts. Trixie support is planned for v1.5. For now, flash Bookworm: [raspberrypi.com/software/operating-systems](https://www.raspberrypi.com/software/operating-systems/)

**Q: The Next.js build crashes on Pi with out-of-memory errors**  
Increase the swap file before building:

```bash
sudo dphys-swapfile swapoff
sudo sed -i 's/CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

Then re-run the build. You can reduce swap back to 200MB after the build completes to reduce SD card wear.

**Q: What SD card size do I need?**  
- **Minimum:** 16 GB — covers the full install with some headroom
- **Recommended:** 32 GB — comfortable for updates, logs, and future growth
- Use an **endurance-rated** card (Samsung Pro Endurance, SanDisk Max Endurance) for 24/7 kiosk use.

**Q: The kiosk doesn't start automatically after reboot**  
Check the systemd service and LightDM:

```bash
sudo systemctl status agent-os
sudo systemctl status lightdm
sudo journalctl -u agent-os -n 50
sudo journalctl -u lightdm -n 50
```

Common fixes:
- Service failed to start: `sudo systemctl restart agent-os`
- LightDM not finding the session: verify `/usr/share/xsessions/agent-os.desktop` exists
- Autologin not configured: check `/etc/lightdm/lightdm.conf.d/50-agent-os.conf` has the correct username

**Q: The touchscreen isn't responding correctly**  
Run the calibration helper:

```bash
~/calibrate-touch.sh
```

Follow the on-screen instructions. Copy the output into `/etc/X11/xorg.conf.d/99-calibration.conf` and reboot.

**Q: How do I exit kiosk mode?**  
- **Desktop deploy:** Alt+F4 closes Chromium. Ctrl+Alt+T opens a terminal.
- **Lite deploy:** Ctrl+Alt+F2 drops to a TTY. Log in and run `sudo systemctl stop lightdm` to kill the desktop session.

**Q: How do I check if everything is running correctly?**  
```bash
~/agent-os-status.sh
```

This shows service state, HTTP health, network IP, CPU temperature, and memory usage.

**Q: How do I update Agent-OS on the Pi?**  
```bash
~/agent-os-update.sh
```

This pulls from GitHub, reinstalls dependencies, rebuilds, and restarts the service automatically.

---

## Agents

**Q: What's the difference between Worker and Manager agent types?**  
- **Worker** agents execute tasks directly — they call tools, run prompts, and produce outputs.
- **Manager** agents delegate work to workers in their department, synthesize results, and handle escalations. In v1.4, manager agents will auto-route tasks to available workers.

**Q: What is the Vibe field?**  
Vibe is the personality archetype of your agent — it influences the tone and approach of the system prompt. Use a preset (Analyst, Builder, Strategist, Creative, Guardian, Optimizer) or write a custom vibe. It's a creative shorthand; the actual behavior is determined by the System Prompt.

**Q: What is an AGENT.md file?**  
A deploy-ready markdown spec file that your harness (CrewAI, OpenClaw, etc.) reads to instantiate the agent. It contains YAML frontmatter (metadata) and a markdown body (role, goal, system prompt, tools, skills, memory config). Export one from any agent's detail view.

**Q: Can I assign the same tool to multiple agents?**  
Yes. Tools are shared across your fleet. Assign them to as many agents as needed.

---

## Skills & Tools

**Q: What's the difference between a Skill and a Tool?**  
- **Skills** are capabilities an agent has developed or been trained for — things like "Research", "Summarization", or "Code Review". They're often backed by a SKILL.md spec.
- **Tools** are concrete functions or APIs an agent can call — like a web search API, a database query tool, or a file writer.
- **MCP Servers** are Model Context Protocol servers that expose tools to Claude-based agents.

**Q: What is a SKILL.md file?**  
A YAML + markdown spec file describing a skill — its inputs, outputs, instructions, and examples. It's the portable unit for sharing and reusing agent capabilities. Export one from any skill card by hovering and clicking the download icon.

---

## Content & Decisions

**Q: What is the Content page for?**  
It's a review queue for agent-generated content. When an agent produces an output (a blog post, report, email draft, etc.), it appears here for human review. You can vote thumbs up/down, add tags, and leave a comment before approving it for use.

**Q: What is the Decisions queue?**  
When an agent reaches a decision point that requires human judgment, it logs the decision here. You review the context and approve or reject it. Approved decisions trigger the next step; rejected decisions send feedback back to the agent.

---

## Still Stuck?

Open an issue on GitHub: [github.com/BigY0shi/agent-os/issues](https://github.com/BigY0shi/agent-os/issues)

Use the bug report template and include:
- Your OS and Node.js version
- Steps to reproduce
- The error message or unexpected behavior
- Output of `~/agent-os-status.sh` (if on Pi)
