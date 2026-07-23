# Agent OS Evolution Compendium & AI Command Playbook

Welcome to the **Agent OS Compendium**. This single-source-of-truth document integrates and summarizes all 24 setup and configuration guides from the `install/` directory. For each section, it outlines its purpose, requirements, key files, manual setup commands, and **custom AI prompts** that you can copy and paste directly into your AI assistant (e.g., Claude Code, Codex, or Cursor) to configure and activate each feature automatically.

---

## 🗺️ Master Setup Map

| File | Feature / Section | Status | Core Dependency / Key Needed |
| :--- | :--- | :--- | :--- |
| **0** | [How It All Works](#0-how-it-all-works) | 🧭 **Read First** | Understanding model routing (No key) |
| **1** | [Core Dashboard](#1-core-dashboard) | ✅ **Required** | Node.js 20+ (No key) |
| **11** | [Memory Galaxy & Obsidian](#11-memory-galaxy--obsidian) | ⭐ **Recommended** | Obsidian Vault path (No key) |
| **2** | [Voice Building / Agent Factory](#2-voice-building--the-agent-factory) | ⭐ **Recommended** | Ollama (`gemma2` or `qwen2.5-coder`) |
| **3** | [Jarvis Talking Voice](#3-jarvis--the-talking-voice) | ⭐ **Recommended** | ElevenLabs API Key (Free tier) |
| **4** | [Hermes Agent](#4-hermes--the-agent-that-does-things) | Optional | Python 3.10+, OpenRouter API Key |
| **5** | [Free Claude Code Proxy](#5-free-claude-code--0-ai-coding) | Optional | Ollama / OpenRouter Free models |
| **6** | [Paperclip AI Company](#6-paperclip--run-an-ai-company) | Optional | Node.js (No key to install) |
| **7** | [Agent CLI Tabs](#7-the-agent-tabs) | Optional | Claude Code, Codex, Antigravity, OpenClaw |
| **10** | [Thumbnail Studio](#10-thumbnail-studio) | ⭐ **Recommended** | OpenAI API Key (prepaid credits), Pillow |
| **12** | [Video Studio](#12-video-studio) | Optional | HeyGen API Key (for avatars) |
| **13** | [Game Studio](#13-game-studio) | Optional | Same as Voice Building (Ollama) |
| **14** | [Music Studio](#14-music-studio) | Optional | Suno API Key |
| **15** | [NotebookLM Tab](#15-notebooklm--the-notebook-tab) | Optional | Google Account, `notebooklm-mcp-cli` |
| **16** | [Kimi Code](#16-kimi-code) | Optional | Kimi Account & Kimi Code CLI |
| **17** | [Extra AI Models](#17-extra-ai-models) | Optional | Zhipu Key (GLM 5.2), Sakana Key (Fugu) |
| **18** | [Grok Build](#18-grok-build--xais-coding-agent) | Optional | X Premium+ (SuperGrok), Grok CLI |
| **19** | [Loop Engineering](#19-loop-engineering) | Optional (Adv.) | OpenRouter / Sakana Key |
| **20** | [Agent Kanban](#20-agent-kanban) | Optional | Same as Voice Building (Ollama) |
| **21** | [Open Design Studio](#21-open-design) | Optional (Adv.) | Node 24, pnpm 10.33, Git |
| **22** | [Leads Finder](#22-leads--find-people-to-reach-out-to) | Optional | Hunter.io Key, Apollo Key, Firecrawl Key |
| **23** | [Radar AI News Watcher](#23-radar--your-247-ai-news-watcher) | Optional | Hermes + Grok Login, WordPress (optional) |
| **9** | [Phone Agent](#9-phone-agent--call-your-agent) | Optional (Adv.) | Twilio, ElevenLabs, Cloudflare Tunnel |
| **8** | [Troubleshooting Guide](#8-troubleshooting--when-something-wont-cooperate) | 🆘 | General debugging playbook |

---

## 0 · How It All Works

### Overview
The mental model of the Agent OS is a centralized hub (Mission Control) where sidebar tabs act as independent specialist tools powered by their own models:
- **Claude Tab** → Claude Code CLI (requires a subscription login).
- **Free Claude Code (FCC)** → Routes Claude Code to free cloud models (e.g., N2) or local models.
- **Hermes Tab** → Nous Research's tool-using agent powered by OpenRouter.
- **Jarvis** → The voice layer running on top of Hermes (its intelligence matches Hermes' model).
- **Local Builder** → Ollama model running free/offline builds (Gemma2/Qwen).

> [!IMPORTANT]
> **The #1 Routing Rule**: The local Ollama model (`gemma2`) is ONLY for the free, on-device builder (Agent Factory, Agent Kanban, Game Studio). Do **NOT** set it as the default for Hermes, video generation, or heavy coding agents. Weak local models will fail to execute tools or produce low-quality visual results.

### AI Setup & Control Prompt
```text
Read install/0-HOW-IT-ALL-WORKS.md and explain the model routing rules to make sure we don't accidentally set local Gemma2 as the global default for heavy tasks like video or coding agents.
```

---

## 1 · The Core Dashboard

### Overview
The foundation of the OS: a Next.js web dashboard that aggregates all agent CLIs, tools, and interfaces into a unified workspace.
- **Status**: Required
- **Default URL**: `http://localhost:3737` (Chrome is highly recommended for microphone features)
- **Key Files**: `~/.agentic-os/config.json` (Optional custom configuration)

### Manual Terminal Commands
```bash
cd source
npm install
PORT=3737 npm run build
PORT=3737 npm start
```
*For Windows Native (PowerShell):*
```powershell
$env:PORT=3737
cd source
npm install
npm run build
npm start
```

### AI Setup & Control Prompt
```text
Set up the Core Dashboard for me. Verify Node.js version, run npm install, build the project on port 3737, start it, and confirm the localhost link is active.
```

---

## 2 · Voice Building — The Agent Factory

### Overview
Allows you to describe a web page or visual application (e.g., "build me a colorful starfield") and watch it write and run code live in 15 seconds on your own machine.
- **Status**: Recommended
- **Key Files**: `~/.fcc/.env` (Holds model configuration)

### Manual Terminal Commands
```bash
# Install Ollama (or download from https://ollama.com)
brew install ollama

# Pull the standard model
ollama pull gemma2

# Or pull the coder-specific model (for computers with 16GB+ RAM)
ollama pull qwen2.5-coder:14b

# Configure the agent to use the model
mkdir -p ~/.fcc && echo 'MODEL="ollama/gemma2"' > ~/.fcc/.env
```

### AI Setup & Control Prompt
```text
Set up local voice building for me. Check if Ollama is running, pull the gemma2 model (or qwen2.5-coder:14b if I have 16GB+ RAM), create the .env configuration pointing to it, and tell me how to build my first page in the Agent Factory.
```

---

## 3 · Jarvis — The Talking Voice

### Overview
An Iron Man-style voice assistant (Oracle Control System) that responds to your voice out loud, reads your Obsidian notes to remember tasks, and triggers visual panels.
- **Status**: Recommended
- **Key Files**: `~/.hermes/profiles/main/.env` (Stores ElevenLabs API Key)
- **Environment Variable**: `AGENTIC_OS_TTS_VOICE` (Sets a custom voice ID default)

### Manual Configuration
Paste your ElevenLabs key into `~/.hermes/profiles/main/.env`:
```env
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
AGENTIC_OS_TTS_VOICE=your_voice_id_here
```

### AI Setup & Control Prompt
```text
Connect my ElevenLabs API key: <paste key> to Jarvis. Set the default TTS voice to the British butler voice (or a custom voice ID if provided), restart the dashboard, and configure the wake word listener.
```

---

## 4 · Hermes — The Agent That Does Things

### Overview
Hermes is a tool-using agent that writes files, searches the web, runs shell commands, and remembers history. The Hermes tab has 10 sub-sections: Chat, Talk, Jarvis (Voice), Studio (Media Gen), Sessions, Workspace, MCPs, Manage, Control Room, and Goal Mode.
- **Status**: Optional
- **Key Files**: `~/.hermes/profiles/main/.env`, `~/.hermes/profiles/main/config.yaml`
- **Profiles Path**: `~/.hermes/profiles/` (Isolated custom personas/keys)

### Manual Terminal Commands
```bash
pip install hermes-agent

# Create a profile
hermes profile create seo --clone
hermes profile list
hermes profile use seo
```

### AI Setup & Control Prompt
```text
Install the hermes-agent CLI and configure it. Here is my OpenRouter API key: <paste key>. Create the main profile, set a cost-effective default model (like Haiku 4.5), and verify the installation.
```

---

## 5 · Free Claude Code — $0 AI Coding

### Overview
A local server proxy (`fcc-server`) that routes Claude Code CLI commands to free on-device or cloud models, giving you full chat and workspace features without a subscription.
- **Status**: Optional (Advanced)
- **Key Files**: `~/.fcc/.env`

### Manual Terminal Commands
```bash
# Starts the proxy (runs in the background)
fcc-server
```

### AI Setup & Control Prompt
```text
Configure Free Claude Code. Set up the fcc-server proxy to route my Claude Code CLI chats to my local Ollama model or a free OpenRouter model, and start the proxy in the background.
```

---

## 6 · Paperclip — Run an AI Company

### Overview
Paperclip runs a virtual department of AI agents (CEO, Marketing, Developer) under an org chart. You assign a company-wide mission, and the agents coordinate tasks on a live board.
- **Status**: Optional
- **Default URL**: `http://localhost:3100`

### Manual Terminal Commands
```bash
npx paperclipai onboard --yes
```

### AI Setup & Control Prompt
```text
Install and onboard Paperclip for me. Once it is running, script a demo company with a few agents (like CEO, Developer, Researcher), set up an initial goal, and verify the Paperclip dashboard embeds successfully.
```

---

## 7 · The Agent Tabs

### Overview
Enables individual sidebar tabs for Claude Code, Codex, Antigravity, and OpenClaw. 
- **Important**: The Claude tab uses **`claude login`** (browser oauth) and matches your Claude Pro/Max subscription. Do **not** set an empty `ANTHROPIC_API_KEY=` in `.env` as it overrides browser authorization.
- **Antigravity Successor**: Google retired the Gemini CLI on June 18, 2026. It has been replaced by **Antigravity** (`agy`).
- **Key Files**: `~/.agentic-os/config.json`, `~/.agentic-os/gemini.env` (Holds Gemini key for live translation features)

### Manual Terminal Commands
```bash
# Sign in to Claude Code
claude login

# Optional Gemini translation key setup
mkdir -p ~/.agentic-os
echo 'GEMINI_API_KEY=your_key_here' > ~/.agentic-os/gemini.env
chmod 600 ~/.agentic-os/gemini.env
```

### AI Setup & Control Prompt
```text
Check which coding CLIs (Claude, Codex, Antigravity, OpenClaw) are currently installed on my system, log me into the active ones, and add my Gemini API key: <paste key> for optional live translations.
```

---

## 8 · Troubleshooting — When Something Won't Cooperate

### Overview
Solutions for common dashboard, local models, ElevenLabs voice, Paperclip, or CLI authentication issues.
- **Status**: Diagnostic

### AI Setup & Control Prompt
```text
I am having trouble with [describe issue]. Read install/8-TROUBLESHOOTING.md and check my logs to troubleshoot and fix it for me.
```

---

## 9 · Phone Agent — Call Your Agent

### Overview
Configures a Twilio phone number pointing to an ElevenLabs custom LLM endpoint, which tunnels into your local Hermes agent server on port 8642.
- **Status**: Optional (Advanced)
- **Key Files**: `~/.hermes/profiles/main/.env`, `~/.hermes/profiles/main/config.yaml`
- **Dependencies**: `cloudflared` (tunnel tool)

### Manual Terminal Commands
```bash
# Add keys to main Hermes profile
echo 'API_SERVER_ENABLED=true' >> ~/.hermes/profiles/main/.env
echo 'API_SERVER_PORT=8642' >> ~/.hermes/profiles/main/.env
echo 'API_SERVER_KEY=your_random_hex_here' >> ~/.hermes/profiles/main/.env

# Restart gateway
hermes gateway restart

# Start Cloudflare tunnel
cloudflared tunnel --url http://localhost:8642
```

### AI Setup & Control Prompt
```text
Configure the Phone Agent for me. Enable the API server in my Hermes configuration on port 8642, generate a secure random API key, and show me the command to start the cloudflared tunnel.
```

---

## 10 · Thumbnail Studio

### Overview
Refines YouTube thumbnail ideas using OpenAI's `gpt-image-2`. Uploads reference images, applies styled instructions, and saves all generated files and metadata directly to your Obsidian vault.
- **Status**: Recommended
- **Key Files**: `~/.claude/skills/youtube-thumbnails/scripts/generate.py`, `~/.claude/skills/youtube-thumbnails/.env`

### Manual Terminal Commands
```bash
mkdir -p ~/.claude/skills/youtube-thumbnails/scripts
cp extras/thumbnail-generator/generate.py ~/.claude/skills/youtube-thumbnails/scripts/
python3 -m pip install --user Pillow
echo 'OPENAI_API_KEY=sk-your_prepaid_openai_key' > ~/.claude/skills/youtube-thumbnails/.env
```

### AI Setup & Control Prompt
```text
Set up the Thumbnail Studio. Copy the generate.py script from extras, install Pillow, and write my OpenAI API key: <paste key> to the thumbnail environment file.
```

---

## 11 · Memory Galaxy & Obsidian

### Overview
Bridges your Obsidian markdown notes into a beautiful 3D particle constellation (Memory Galaxy) in the **Memory** tab. It stores logs of your Jarvis voice chats, thumbnail runs, and builds so they are indexable.
- **Status**: Recommended
- **Key Files**: `~/.agentic-os/config.json` (`vaultRoot` property)

### AI Setup & Control Prompt
```text
Connect my Obsidian vault to the Agent OS. Scan my home directory or iCloud to find my vault folder, set it in the configuration file, and restart the dashboard to load the Memory Galaxy.
```

---

## 12 · Video Studio

### Overview
A video-rendering studio utilizing HyperFrames for visual compositions, and talking-head animations using a HeyGen avatar connection.
- **Status**: Optional
- **Key Files**: `~/.agentic-os/heygen.env`

### Manual Terminal Commands
```bash
mkdir -p ~/.agentic-os
echo 'HEYGEN_API_KEY=your_key_here' > ~/.agentic-os/heygen.env
chmod 600 ~/.agentic-os/heygen.env
```

### AI Setup & Control Prompt
```text
Set up Video Studio. Save my HeyGen API key: <paste key> in the heygen.env configuration file and restart the dashboard.
```

---

## 13 · Game Studio

### Overview
Describe a browser game, click build, and play the completed game right in your browser. Billed at $0 since it runs on local Ollama models.
- **Status**: Optional (Free & local)
- **Target Folder**: Output saved to `~/freeclaude-scratch/games/`

### AI Setup & Control Prompt
```text
Check if my local Ollama engine is ready for Game Studio. Let's make sure it's pointed to gemma2 or qwen2.5-coder so we can start generating games.
```

---

## 14 · Music Studio

### Overview
Produces full tracks (music, beats, and synthesized vocals) from text prompts using Suno API integrations.
- **Status**: Optional
- **Key Files**: `~/.agentic-os/suno.env`

### Manual Terminal Commands
```bash
mkdir -p ~/.agentic-os
echo 'SUNO_API_KEY=your_key_here' > ~/.agentic-os/suno.env
chmod 600 ~/.agentic-os/suno.env
```

### AI Setup & Control Prompt
```text
Configure Music Studio. Save my Suno API key: <paste key> to the suno.env configuration file and restart the dashboard so I can generate songs.
```

---

## 15 · NotebookLM Tab

### Overview
Links your dashboard to Google NotebookLM. Lets you chat with sources, browse notebooks, and render audio summaries or mind-maps.
- **Status**: Optional
- **Key Files**: `~/.agentic-os/config.json` (`nlmBin`)

### Manual Terminal Commands
```bash
# Install tool via uv
uv tool install notebooklm-mcp-cli

# Log in to Google account
nlm login
```

### AI Setup & Control Prompt
```text
Install the NotebookLM MCP CLI using uv or pipx, and prompt me to run the login command in terminal so I can authenticate with my Google account.
```

---

## 16 · Kimi Code

### Overview
Integrates Moonshot's Kimi K2.7 coding agent as a dedicated sidebar tab.
- **Status**: Optional
- **Key Files**: `~/.agentic-os/config.json` (`kimi`)
- **Workspace Path**: `~/.agentic-os/kimi-projects/`

### Manual Terminal Commands
```bash
# Sign in to Kimi
kimi login
```

### AI Setup & Control Prompt
```text
Install the Kimi Code CLI from Kimi, set up the environment, and tell me when to run 'kimi login' to authenticate with my Moonshot account.
```

---

## 17 · Extra AI Models

### Overview
Links simple API key tabs for GLM 5.2 (Zhipu), OpenRouter Fusion (combines top models), and Sakana Fugu (ensemble council priced ~4x cheaper than Fusion).
- **Status**: Optional
- **Key Files**: 
  - `~/.hermes/profiles/glm-5-2/.env`
  - `~/.hermes/profiles/sakana-fugu/.env`
  - `~/.hermes/profiles/main/.env` (reused for OpenRouter Fusion)

### Manual Configuration
```bash
# GLM 5.2
mkdir -p ~/.hermes/profiles/glm-5-2
echo 'GLM_API_KEY=your_key' > ~/.hermes/profiles/glm-5-2/.env

# Sakana Fugu
mkdir -p ~/.hermes/profiles/sakana-fugu
echo 'SAKANA_API_KEY=your_key' > ~/.hermes/profiles/sakana-fugu/.env
```

### AI Setup & Control Prompt
```text
Set up the extra model tabs. Here are my API keys: Zhipu (GLM 5.2): <key>, Sakana Fugu: <key>, OpenRouter Fusion: <key>. Write them to their respective profiles and restart the dashboard.
```

---

## 18 · Grok Build — xAI's Coding Agent

### Overview
Embeds xAI's `grok-build` CLI agent into the dashboard, letting you compile apps on X Premium+ (no extra API charges).
- **Status**: Optional
- **Key Files**: `~/.hermes/profiles/grok-build/workspace`

### Manual Terminal Commands
```bash
# Log in via device flow
grok login --device-auth
```

### AI Setup & Control Prompt
```text
Install the xAI Grok CLI on my machine, verify the version, and prompt me to run 'grok login --device-auth' to authorize the agent with my X Premium+ account.
```

---

## 19 · Loop Engineering

### Overview
Automates a build-test-verify loop. The Builder model writes code, and the Fusion Council tests it adversarially against your criteria ("done gate") until it passes or progress stalls.
- **Status**: Optional (Advanced)
- **Key Files**: `~/.hermes/profiles/main/.env`

### AI Setup & Control Prompt
```text
Configure the Loop engineering environment. Verify my OpenRouter key is set up in my Hermes main profile so we can run builder-reviewer loops.
```

---

## 20 · Agent Kanban

### Overview
Runs a free, local multi-agent department (Planner -> Builder -> Reviewer) that organizes goals into kanban cards and builds/verifies pages entirely on your computer.
- **Status**: Optional
- **Engine**: Shared with Voice Building (Ollama)

### AI Setup & Control Prompt
```text
Let's test the local Agent Kanban board. Check if the local Ollama daemon is active, configure it to use our coder model, and show me how to kick off a multi-agent project board.
```

---

## 21 · Open Design

### Overview
A local-first Figma/design tool alternative. Generates prototypes, decks, and graphics embedded directly in your Agent OS.
- **Status**: Optional (Advanced)
- **Dependencies**: Node.js 24, pnpm 10.33, Git
- **Embed Ports**: Daemon `7455`, Web `7456`

### Manual Bridge Setup
Create the host-start and host-stop scripts inside `~/open-design/`:
```bash
cat > ~/open-design/od-host-start.sh <<'SH'
#!/bin/bash
cd "$HOME/open-design" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec pnpm tools-dev start web --prod --daemon-port 7455 --web-port 7456
SH

cat > ~/open-design/od-host-stop.sh <<'SH'
#!/bin/bash
cd "$HOME/open-design" || exit 1
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
exec pnpm tools-dev stop
SH

chmod +x ~/open-design/od-host-start.sh ~/open-design/od-host-stop.sh
```

### AI Setup & Control Prompt
```text
Clone the Open Design repository to my home folder, install its pnpm dependencies using Node 24, generate the custom host-start and host-stop bridge scripts, and verify the server ports 7455 and 7456 are clear.
```

---

## 22 · Leads — Find People to Reach Out To

### Overview
Pulls contact information and company profiles based on your Ideal Customer Profile (ICP) or domain lists.
- **Status**: Optional
- **Integrations**: Hunter.io (email finder), Apollo.io (databases), Firecrawl (enrichment)
- **Key Files**: `~/.agentic-os/outreach/config.json`

### AI Setup & Control Prompt
```text
Connect my outreach keys to the Leads finder. Here are my keys: Hunter: <key>, Apollo: <key>, Firecrawl: <key>. Write them to the outreach configuration file and check that they load.
```

---

## 23 · Radar — Your 24/7 AI-News Watcher

### Overview
Pulls hot news from X (Twitter) using Hermes + Grok search, generates ready-to-use hooks, and publishes unique SEO articles to your own WordPress.
- **Status**: Optional
- **Key Files**: `~/.agentic-os/wordpress.json` (WordPress login/passwords config)

### AI Setup & Control Prompt
```text
Configure the Radar news system. Set up my WordPress site endpoint: <url> and application password: <password> in ~/.agentic-os/wordpress.json so Radar can auto-publish blog posts for me.
```
