// smoke-jarvis-stop-queue: Jarvis can be stopped, interrupted and queued (owner, 2026-10-08:
// "once jarvis gets going, I cannot interrupt or even stop him" + "make sure queueing
// messages works"). The three surfaces are React components with no offline test harness,
// so this is a static guard on the wiring that makes each guarantee true; the live check is
// the owner's (talk over Jarvis, press Stop/Esc, type while he is busy).
//   A. main Jarvis view (JarvisView.tsx)
//   B. Voice tab (jarvis/VoiceTab.tsx)
//   C. chat overlay (v2/jarvis/ChatboxOverlay.tsx)
//   D. the brain route really cancels a turn on abort (the server half every surface relies on)
// Offline: reads source files only. Run: npx tsx scripts/v2/smoke-jarvis-stop-queue.mjs
import fs from "node:fs";

let failures = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failures++; };
const read = (p) => fs.readFileSync(p, "utf8");

// ── A ───────────────────────────────────────────────────────────────────────
const v = read("src/components/JarvisView.tsx");
check("A1 the ask request carries an abort signal", /fetch\("\/api\/v2\/jarvis\/ask", \{\s*method: "POST",\s*signal: ac\.signal/.test(v));
check("A2 stopJarvis aborts the ask, pauses the voice and bumps the speak generation",
  /const stopJarvis = useCallback/.test(v) && /ask\?\.abort\(\)/.test(v) && /a\.pause\(\)/.test(v) && /speakGenRef\.current\+\+/.test(v));
check("A3 a voice that arrives after a stop never plays", /const gen = speakGenRef\.current;/.test(v) && /if \(gen !== speakGenRef\.current\) return;/.test(v));
check("A4 a new message interrupts instead of being dropped (old `|| busyRef.current) return` gone)",
  !/if \(!p \|\| busyRef\.current\) return;/.test(v) && /stopJarvis\("Interrupted\."\)/.test(v));
check("A5 talking (startListening) interrupts him", /function startListening\(\) \{\s*\/\/[^\n]*\n\s*if \(askAbortRef\.current \|\| phaseRef\.current === "speaking"\) stopJarvis/.test(v));
check("A6 Esc stops him before it exits wall mode", /if \(askAbortRef\.current \|\| phaseRef\.current === "speaking"\) \{ holdQueue\(\); stopJarvis\(\); resumeAfterReply\(\); return; \}\s*if \(wall\) setWall\(false\);/.test(v));
check("A7 a visible Stop button while thinking or speaking", /\{canStop && \(/.test(v) && /aria-label="Stop Jarvis"/.test(v));
check("A8 typed while busy is queued; Send stays enabled", /const submitTyped = /.test(v) && /setQueue\(\(q\) => \[\.\.\.q, \{ id: \+\+queueIdRef\.current, text: v \}\]\)/.test(v) && !/disabled=\{busy \|\| !input\.trim\(\)\}/.test(v));
check("A9 the queue drains one at a time when idle", /if \(!queue\.length \|\| busy \|\| phaseState !== "idle" \|\| listening\) return;/.test(v));
check("A10 Stop puts queued text back in the box (nothing lost, nothing auto-sent)", /const holdQueue = /.test(v) && /holdQueue\(\); stopJarvis\(\)/.test(v));
check("A11 an aborted ask is labelled (stopped), not reported as an error", /if \(ac\.signal\.aborted\) \{/.test(v) && /"\(stopped\)"/.test(v));

// ── B ───────────────────────────────────────────────────────────────────────
const t = read("src/components/jarvis/VoiceTab.tsx");
check("B1 stopAll aborts the ask and pauses the voice", /const stopAll = useCallback/.test(t) && /askAbortRef\.current\?\.abort\(\)/.test(t) && /a\.pause\(\)/.test(t));
check("B2 Jarvis ask carries the signal", /fetch\("\/api\/v2\/jarvis\/ask", \{ method: "POST", signal: ac\.signal/.test(t));
check("B3 hold-to-talk and Space work while busy and interrupt", !/disabled=\{busy \|\| capture\.available !== true\}/.test(t) && /onPointerDown=\{\(\) => \{ stopAll\(\); capture\.start\(\); \}\}/.test(t) && /e\.code === "Space" && !e\.repeat\) \{ e\.preventDefault\(\); stopAll\(\);/.test(t));
check("B4 a late voice never plays", /if \(gen !== speakGenRef\.current\) return;/.test(t));
check("B5 typed while busy is queued and drained; Stop button + Esc hold the queue",
  /setQueue\(\(q\) => \[\.\.\.q, \{ id: \+\+queueIdRef\.current, text: t \}\]\)/.test(t) && /const \[next, \.\.\.rest\] = queue;/.test(t) && /holdQueue\(\); stopAll\(\);/.test(t));

// ── C ───────────────────────────────────────────────────────────────────────
const o = read("src/components/v2/jarvis/ChatboxOverlay.tsx");
check("C1 sending while busy queues instead of doing nothing", /if \(busyRef\.current\) \{ setQueue\(\(q\) => \[\.\.\.q, \{ id: \+\+queueIdRef\.current, text \}\]\); return; \}/.test(o) && !/if \(!text \|\| busyRef\.current\) return;/.test(o));
check("C2 the queue drains when idle and done reading aloud", /if \(!queue\.length \|\| busy \|\| speech\.speaking\) return;/.test(o));
check("C3 Send stays enabled while busy", !/disabled=\{busy \|\| !value\.trim\(\)\}/.test(o));
check("C4 Stop actions holds the queue and an abort reads (stopped)", /holdQueue\(\); askAbortRef\.current\?\.abort\(\)/.test(o) && /askAbort\.signal\.aborted \?/.test(o));

// ── D ───────────────────────────────────────────────────────────────────────
const r = read("src/app/api/v2/jarvis/ask/route.ts");
const b = read("src/lib/v2/jarvis/brain.ts");
check("D1 the ask route passes the request's abort signal to the brain", /req\.signal\.addEventListener\("abort"/.test(r) && /signal: req\.signal/.test(r));
check("D2 the brain interrupts the running turn on abort", /signal\?\.addEventListener\("abort", abort/.test(b) && /b\.q\.interrupt\(\)/.test(b));

console.log(failures ? `\n${failures} failure(s)` : "\nALL PASS");
process.exit(failures ? 1 : 0);
