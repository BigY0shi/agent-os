<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Learned Rules

11. [PROCESS] Never let Agent Kanban silently fall back to the local Ollama/Gemma path when the user selected a CLI agent - because Planner and Builder must both honor the selected CLI routing or fail loudly.
12. [PROCESS] Never restart the Agent OS server unless the user explicitly asks for a restart - because the user may be actively using the live app and will restart it themselves at a stopping point.
13. [PROCESS] Always ground CYD-style ESP32 hardware upgrade proposals in actual CYD board variants before calling something an upgrade - because some commonly suggested features such as ESP32-S3 and microSD may already be stock on the user's target CYD.
14. [PROCESS] Always account for multiplexers, bridge chips, and existing UART/Grove-style CYD connector breakouts before declaring CYD expansion pin budget exhausted - because the board can expose more practical expansion than direct spare GPIO counting suggests.
15. [PROCESS] Never end a response by telling the user to run `npm run build`, and never tally "N commits waiting on a rebuild" - the user already rebuilds after every change (stated 2026-07-26). Rule 12 (never restart the server yourself) still holds; this only retires the nagging.
