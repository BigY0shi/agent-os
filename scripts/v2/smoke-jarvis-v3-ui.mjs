// Jarvis v3 UI (S11 glass + faces, S12 tab shell), offline.
//
// Run: npx tsx scripts/v2/smoke-jarvis-v3-ui.mjs
//
// Two layers:
//  A. Source contract: the hub, the moves out of Hermes, the honest face mapping,
//     and the removal of the invented Wall-mode telemetry.
//  B. The face in a real browser: AgentFace is bundled with esbuild and rendered in
//     headless Chromium (Playwright, as smoke-jarvis-screen-control does). The
//     rendered DOM must carry the state it was GIVEN, change when the state changes,
//     and fall back to its poster when WebGL is missing. No server, no network.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? `  [${String(extra).slice(0, 200)}]` : ""}`);
  if (!cond) failures++;
};
const read = (rel) => fs.readFileSync(rel, "utf8");

// ── A. source contract ─────────────────────────────────────────────────────────
const hub = read("src/components/jarvis/JarvisHub.tsx");
const page = read("src/app/jarvis/page.tsx");
const hermes = read("src/app/hermes/page.tsx");
const view = read("src/components/JarvisView.tsx");
const oracle = read("src/components/OracleView.tsx");
const news = read("src/components/NewsView.tsx");
const css = read("src/app/globals.css");
const face = read("src/components/faces/AgentFace.tsx");

check("/jarvis renders the hub inside Suspense (useSearchParams)", page.includes("<JarvisHub />") && page.includes("<Suspense"));
for (const [key, comp] of [["console", "JarvisView"], ["oracle", "OracleView"], ["radar", "NewsView"], ["outreach", "HermesOutreach"]])
  check(`hub registers the ${key} tab -> ${comp}`, new RegExp(`key: "${key}"[^\\n]*<${comp} />`).test(hub));
check("hub keeps the tab in ?tab= (deep links, screen control)", hub.includes('q.set("tab", next)') && hub.includes('params.get("tab")'));
check("hub tabs are an accessible tablist", hub.includes('role="tablist"') && hub.includes('role="tab"') && hub.includes("aria-selected") && hub.includes('role="tabpanel"'));
check("hub honours reduced motion before any GSAP timeline", /if \(!el \|\| reduced\) return;/.test(hub) && hub.split("if (!el || reduced) return;").length === 3);
check("Hermes no longer mounts Oracle / News Radar / Outreach", !/OracleView|NewsView|HermesOutreach/.test(hermes));
check("old Hermes deep links redirect to the Jarvis tab", hermes.includes("window.location.replace(`/jarvis?tab=${moved[t]}`)") && /oracle: "oracle", radar: "radar", outreach: "outreach"/.test(hermes));
check("Console uses the constellation face, not the old reactor", view.includes('variant="constellation"') && !view.includes("ArcReactor"));
check("Console face state derives from real signals only", /const faceState: FaceState = status\.startsWith\("Brain error"\)/.test(view) && view.includes('building ? "working"'));
check("Wall-mode random-walk telemetry is gone", !/setTelem|telem\.|NEURAL THROUGHPUT|CORE LOAD/.test(view));
check("Wall mode shows measured readouts (last reply, turns)", view.includes('"LAST REPLY"') && view.includes('"TURNS THIS SESSION"') && view.includes("setLastReplySec((Date.now() - started) / 1000)"));
check("Wall mode no longer hardcodes a voice name", !view.includes("DANIEL · EN-GB"));
check("Oracle face: galaxy, state from busy/tts/err", oracle.includes('variant="galaxy"') && oracle.includes('const oracleFace: FaceState = err ? "error" : busy ? "thinking" : tts === "playing" ? "speaking"'));
check("News Radar face: radar, working only while busy", news.includes('variant="radar"') && news.includes('state={err ? "error" : busy ? "working" : "idle"}'));
for (const cls of [".glass,", ".glass-strong", ".glass-frost", ".glass-inset", ".neon-ring", ".hud-corners .hud-c1", ".glass-tabs", ".glass-tab[aria-selected=\"true\"]"])
  check(`globals.css defines ${cls}`, css.includes(cls));
check("face palette: Jarvis idle violet, replying electric blue", /idle: "#8b5cf6"/.test(face) && /speaking: "#22d3ff"/.test(face));
check("face pauses offscreen and when hidden", face.includes("IntersectionObserver") && face.includes('document.addEventListener("visibilitychange", sync)'));
check("face handles WebGL context loss", face.includes("webglcontextlost"));
check("face caps DPR at 2", face.includes("Math.min(window.devicePixelRatio, 2)"));
check("constellation allocates no Color per frame", !/update:[\s\S]*new THREE\.Color\(1, 1, 1\)\)/.test(face.split("function buildConstellation")[1].split("function buildGalaxy")[0].split("update:")[1] ?? ""));

// ── B. browser: the face renders the state it is given ─────────────────────────
let chromium, build;
try { ({ chromium } = await import("playwright")); ({ build } = await import("esbuild")); } catch (e) { check("playwright + esbuild available", false, e); }
if (chromium && build) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-v3-ui-"));
  const entry = path.join(tmp, "entry.jsx");
  fs.writeFileSync(entry, `
    import React, { useState } from "react";
    import { createRoot } from "react-dom/client";
    import { AgentFace } from ${JSON.stringify(path.resolve("src/components/faces/AgentFace.tsx"))};
    function App() {
      const [s, setS] = useState("idle");
      window.__setState = setS;
      return <div>
        <AgentFace variant="constellation" state={s} style={{ width: 240, height: 240 }} label="Jarvis" />
        <AgentFace variant="galaxy" state="thinking" style={{ width: 200, height: 200 }} />
        <AgentFace variant="radar" state="working" style={{ width: 200, height: 200 }} />
      </div>;
    }
    createRoot(document.getElementById("root")).render(<App />);
  `);
  const out = await build({
    entryPoints: [entry], bundle: true, write: false, format: "iife", platform: "browser",
    jsx: "automatic", loader: { ".tsx": "tsx" }, define: { "process.env.NODE_ENV": '"production"' },
    nodePaths: [path.resolve("node_modules")], logLevel: "silent",
  });
  const js = out.outputFiles[0].text;
  const html = `<!doctype html><html><body style="background:#000"><div id="root"></div><script>${js.replace(/<\/script>/g, "<\\/script>")}</script></body></html>`;

  const run = async (launchArgs, label, fn) => {
    const browser = await chromium.launch({ args: launchArgs });
    try {
      const pg = await browser.newPage();
      const errors = [];
      pg.on("pageerror", (e) => errors.push(String(e)));
      await pg.setContent(html);
      await fn(pg, errors);
    } catch (e) { check(`${label}: browser run`, false, e); }
    finally { await browser.close(); }
  };

  await run(["--use-angle=swiftshader", "--enable-unsafe-swiftshader"], "webgl", async (pg, errors) => {
    await pg.waitForFunction(() => document.querySelectorAll("[data-face-live='1']").length === 3, null, { timeout: 15000 }).catch(() => {});
    const live = await pg.$$eval("[data-face-variant]", (els) => els.map((e) => [e.getAttribute("data-face-variant"), e.getAttribute("data-face-live"), e.getAttribute("data-face-state")]));
    check("all three variants start a live WebGL face", live.length === 3 && live.every((r) => r[1] === "1"), JSON.stringify(live));
    check("faces report the state they were given", JSON.stringify(live.map((r) => r[2])) === JSON.stringify(["idle", "thinking", "working"]), JSON.stringify(live));
    const drew = await pg.$eval("[data-face-variant='constellation'] canvas", (c) => c.width > 0 && c.height > 0);
    check("constellation canvas sized from its container", drew);
    await pg.evaluate(() => window.__setState("speaking"));
    await pg.waitForFunction(() => document.querySelector("[data-face-variant='constellation']")?.getAttribute("data-face-state") === "speaking", null, { timeout: 5000 }).catch(() => {});
    const now = await pg.$eval("[data-face-variant='constellation']", (e) => [e.getAttribute("data-face-state"), e.getAttribute("aria-label")]);
    check("a state change reaches the rendered face", now[0] === "speaking", JSON.stringify(now));
    check("the accessible label is the caller's", now[1] === "Jarvis");
    check("no page errors while rendering", errors.length === 0, errors.join(" | "));
  });

  await run(["--disable-gpu", "--disable-webgl", "--disable-3d-apis"], "no-webgl", async (pg, errors) => {
    await pg.waitForTimeout(1500);
    const rows = await pg.$$eval("[data-face-variant]", (els) => els.map((e) => [e.getAttribute("data-face-error"), e.querySelector("div[aria-hidden]")?.getAttribute("style") ?? ""]));
    check("without WebGL each face falls back to its poster", rows.length === 3 && rows.every((r) => r[0] === "webgl-unavailable" && r[1].includes("radial-gradient")), JSON.stringify(rows));
    check("no page errors without WebGL", errors.length === 0, errors.join(" | "));
  });
}

console.log(failures ? `smoke-jarvis-v3-ui: ${failures} FAILURES` : "smoke-jarvis-v3-ui: all checks passed");
process.exit(failures ? 1 : 0);
