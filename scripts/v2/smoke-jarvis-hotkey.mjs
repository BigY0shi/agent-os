// SPEC-C chunk-1 + S38 smoke: the OS-global hotkey routes, direct-import (no server).
//   - setup GET generates + persists the secret (file asserted on disk);
//     second GET returns the SAME secret (idempotent)
//   - POST without/with-wrong x-agentos-hotkey-secret → 401 (route's own auth;
//     the proxy exemption itself can't be unit-tested here — it's asserted
//     statically in smoke-jarvis-ui)
//   - POST with the valid secret → 200 {subscribers} + fires the globalThis
//     bus (subscribed listener receives the event)
//   - subscriber count reflects registered mock subscribers (0 → 1 → 2 → 0)
//   - S38: "down"/"up" actions travel through the bus AND the SSE stream route
//     (a real ReadableStream read); no action = "press"; a bad action is 400
//   - S38: GET /config needs the secret, returns {key, mode} ONLY, and follows
//     the Jarvis gear (settings.jarvis.hotkey) with hold as the default mode
//   - S38: the AHK helper reads key+mode from /config, posts down/up, 3737
// Env is set BEFORE imports so the secret AND the settings live in temp files,
// never the live ~/.agentic-os/jarvis-hotkey.secret or settings.json (rule 19).
// Run: npx tsx scripts/v2/smoke-jarvis-hotkey.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jarvis-hotkey-"));
const secretFile = path.join(tmpDir, "jarvis-hotkey.secret");
process.env.AGENTIC_OS_HOTKEY_SECRET = secretFile;
process.env.AGENTIC_OS_SETTINGS = path.join(tmpDir, "settings.json");

// ── imports AFTER env (routes/libs resolve the temp secret path) ────────────
const setupRoute = await import("../../src/app/api/jarvis/hotkey/setup/route.ts");
const hotkeyRoute = await import("../../src/app/api/jarvis/hotkey/route.ts");
const configRoute = await import("../../src/app/api/jarvis/hotkey/config/route.ts");
const streamRoute = await import("../../src/app/api/jarvis/hotkey/stream/route.ts");
const bus = await import("../../src/lib/v2/jarvis/hotkeyBus.ts");
const settings = await import("../../src/lib/settings.ts");
const { NextRequest } = await import("next/server");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

const postHotkey = (headers = {}, body = { key: "F13" }) =>
  hotkeyRoute.POST(
    new Request("http://127.0.0.1/api/jarvis/hotkey", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
const getConfig = (headers = {}) => configRoute.GET(new Request("http://127.0.0.1/api/jarvis/hotkey/config", { headers }));

try {
  // 0. Before setup: no secret configured → POST and config GET are refused loudly (503).
  {
    const res = await postHotkey({ "x-agentos-hotkey-secret": "deadbeef" });
    check("POST before setup → 503 not-configured", res.status === 503, res.status);
    const cfg = await getConfig({ "x-agentos-hotkey-secret": "deadbeef" });
    check("config GET before setup → 503 not-configured", cfg.status === 503, cfg.status);
  }

  // 1. setup GET generates + persists the secret.
  const setup1 = await (await setupRoute.GET()).json();
  check("setup GET → configured", setup1.configured === true, setup1);
  check("setup secret is 64 hex", /^[0-9a-f]{64}$/.test(setup1.secret ?? ""), setup1.secret);
  check("secret file persisted at temp path", fs.existsSync(secretFile));
  check(
    "secret file content matches response",
    fs.readFileSync(secretFile, "utf8").trim() === setup1.secret,
  );
  check("setup returns install instructions", Array.isArray(setup1.instructions) && setup1.instructions.length >= 4);
  check(
    "setup returns the AHK script content (WinHttpRequest inside)",
    typeof setup1.script === "string" && setup1.script.includes("WinHttp.WinHttpRequest.5.1"),
  );
  check("setup names the gear's key + mode (S38)", setup1.key === "F13" && setup1.mode === "hold", setup1);
  check("setup instructions point at 3737 and the gear, not the script", setup1.instructions.some((l) => l.includes("3737")) && setup1.instructions.some((l) => /gear/i.test(l)));

  // 2. Second setup GET → SAME secret (idempotent, no rotation).
  const setup2 = await (await setupRoute.GET()).json();
  check("second setup GET returns the SAME secret", setup2.secret === setup1.secret);
  const auth = { "x-agentos-hotkey-secret": setup1.secret };

  // 3. Route-level auth.
  {
    const res = await postHotkey(); // no header at all
    check("POST without secret header → 401", res.status === 401, res.status);
  }
  {
    const res = await postHotkey({ "x-agentos-hotkey-secret": "f".repeat(64) });
    check("POST with wrong secret → 401", res.status === 401, res.status);
  }

  // 4. Valid POST with ZERO subscribers → {subscribers: 0} (the helper's
  //    open-a-new-tab signal).
  {
    const res = await postHotkey(auth);
    const j = await res.json();
    check("valid POST → 200", res.status === 200, res.status);
    check("zero SSE subscribers reported", j.subscribers === 0, j);
    check("no action in the body → action 'press' (pre-S38 helper)", j.action === "press", j);
  }

  // 5. Subscribe via the exported bus → event received + count reflects it.
  const received = [];
  const off1 = bus.subscribeHotkey((ev) => received.push(ev));
  {
    const res = await postHotkey(auth, { key: "F13" });
    const j = await res.json();
    check("POST with 1 subscriber → subscribers: 1", j.subscribers === 1, j);
    check("bus event received", received.length === 1, received);
    check("event shape {type:'hotkey', ts, action:'press', key}",
      received[0]?.type === "hotkey" && typeof received[0]?.ts === "string" && received[0]?.action === "press" && received[0]?.key === "F13",
      received[0]);
  }

  // 6. Second mock subscriber → count 2; unsubscribes drop it back to 0.
  const off2 = bus.subscribeHotkey(() => {});
  {
    const res = await postHotkey(auth);
    const j = await res.json();
    check("two subscribers reported", j.subscribers === 2, j);
  }
  off1();
  off2();
  check("unsubscribe drops count to 0", bus.hotkeySubscriberCount() === 0, bus.hotkeySubscriberCount());
  check("both events reached subscriber 1 before unsubscribe", received.length === 2, received.length);

  // 7. Status GET for the settings panel.
  {
    const j = await (await hotkeyRoute.GET()).json();
    check("status GET → configured + lastFireAt set", j.configured === true && typeof j.lastFireAt === "string", j);
  }

  // ── S38 ────────────────────────────────────────────────────────────────────
  // 8. down / up through the bus; a bad action is refused.
  {
    const got = [];
    const off = bus.subscribeHotkey((ev) => got.push(ev));
    const down = await (await postHotkey(auth, { key: "F13", action: "down" })).json();
    const up = await (await postHotkey(auth, { key: "F13", action: "up" })).json();
    off();
    check("POST action down → echoed", down.ok === true && down.action === "down", down);
    check("POST action up → echoed", up.ok === true && up.action === "up", up);
    check("bus carries down then up with the key", got.map((e) => e.action).join(",") === "down,up" && got.every((e) => e.key === "F13"), got);
    const bad = await postHotkey(auth, { key: "F13", action: "sideways" });
    check("POST unknown action → 400", bad.status === 400, bad.status);
    check("bus did not fire for the bad action", got.length === 2, got.length);
    const noAuthDown = await postHotkey({}, { action: "down" });
    check("down without the secret → 401 (secret still required)", noAuthDown.status === 401, noAuthDown.status);
  }

  // 9. down / up through the real SSE stream route (a ReadableStream read).
  {
    const ac = new AbortController();
    const res = await streamRoute.GET(new NextRequest("http://127.0.0.1/api/jarvis/hotkey/stream", { signal: ac.signal }));
    check("stream GET → text/event-stream", res.headers.get("content-type") === "text/event-stream", res.headers.get("content-type"));
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const readUntil = async (n, ms = 2000) => {
      const deadline = Date.now() + ms;
      while ((buf.match(/^data: /gm) ?? []).length < n && Date.now() < deadline) {
        const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ done: true }), 200))]);
        if (value) buf += dec.decode(value, { stream: true });
        if (done) break;
      }
    };
    await readUntil(0, 100);
    check("stream counts as a subscriber", bus.hotkeySubscriberCount() === 1, bus.hotkeySubscriberCount());
    await postHotkey(auth, { key: "F14", action: "down" });
    await postHotkey(auth, { key: "F14", action: "up" });
    await readUntil(2);
    const frames = [...buf.matchAll(/^data: (.+)$/gm)].map((m) => JSON.parse(m[1]));
    check("SSE delivered down then up", frames.map((f) => f.action).join(",") === "down,up" && frames.every((f) => f.key === "F14" && f.type === "hotkey"), frames);
    check("stream opened with a retry hint", buf.startsWith("retry: 3000"), buf.slice(0, 20));
    ac.abort();
    await new Promise((r) => setTimeout(r, 50));
    check("aborting the stream unsubscribes", bus.hotkeySubscriberCount() === 0, bus.hotkeySubscriberCount());
  }

  // 10. config GET: secret-gated, {key, mode} only, follows the gear.
  {
    const noAuth = await getConfig();
    check("config GET without secret → 401", noAuth.status === 401, noAuth.status);
    const wrong = await getConfig({ "x-agentos-hotkey-secret": "f".repeat(64) });
    check("config GET wrong secret → 401", wrong.status === 401, wrong.status);
    const ok = await getConfig(auth);
    const j = await ok.json();
    check("config GET → 200 {key:'F13', mode:'hold'} by default", ok.status === 200 && j.key === "F13" && j.mode === "hold", j);
    check("config GET returns key + mode ONLY (no secret, nothing else)", Object.keys(j).sort().join(",") === "key,mode", Object.keys(j));
    const defaults = settings.DEFAULT_SETTINGS.jarvis.hotkey;
    check("settings default: mode hold, sendOnRelease true (owner is away from the screen)", defaults.mode === "hold" && defaults.sendOnRelease === true && defaults.key === "F13", defaults);
    settings.writeSettings({ jarvis: { hotkey: { key: "F20", mode: "open" } } });
    const j2 = await (await getConfig(auth)).json();
    check("config GET follows the gear (key F20, mode open)", j2.key === "F20" && j2.mode === "open", j2);
    settings.writeSettings({ jarvis: { hotkey: { key: "   ", mode: "nonsense" } } });
    const j3 = await (await getConfig(auth)).json();
    check("blank key / unknown mode fall back to F13 + hold", j3.key === "F13" && j3.mode === "hold", j3);
    check("settings were written to the temp file, not the live one", fs.existsSync(process.env.AGENTIC_OS_SETTINGS));
  }

  // 11. The helper script (static): reads key+mode from /config, posts down/up, 3737.
  {
    const ahk = fs.readFileSync("scripts/v2/jarvis-hotkey.ahk", "utf8");
    const code = ahk.split(/\r?\n/).filter((l) => !l.trim().startsWith(";")).join("\n");
    check("AHK AppUrl is 3737 (the live bug was 3033)", /AppUrl\s*:=\s*"http:\/\/127\.0\.0\.1:3737"/.test(code) && !ahk.includes("3033"));
    check("AHK reads key + mode from /api/jarvis/hotkey/config", code.includes("/api/jarvis/hotkey/config") && code.includes('"mode"') && code.includes('"key"'));
    check("AHK re-reads the config on a timer", /SetTimer\s+LoadConfig/.test(code));
    check("AHK registers the key AND its release", /Hotkey key, OnKeyDown/.test(code) && /Hotkey key " up", OnKeyUp/.test(code));
    check("AHK posts action down and up (and press in open mode)", code.includes('FireJarvis("down")') && code.includes('FireJarvis("up")') && code.includes('FireJarvis("press")') && code.includes('"action":"'));
    check("AHK swallows key autorepeat while held", /if Held/.test(code));
    check("AHK never opens a tab or fronts on the release", /if \(action = "up"\)\s*\n\s*return/.test(code));
  }
} catch (e) {
  check("smoke ran without throwing", false, String(e?.stack || e));
}

console.log(failures === 0 ? "\nsmoke-jarvis-hotkey: ALL PASS" : `\nsmoke-jarvis-hotkey: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
