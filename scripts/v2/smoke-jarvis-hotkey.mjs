// SPEC-C chunk-1 smoke: the OS-global hotkey routes, direct-import (no server).
//   - setup GET generates + persists the secret (file asserted on disk);
//     second GET returns the SAME secret (idempotent)
//   - POST without/with-wrong x-agentos-hotkey-secret → 401 (route's own auth;
//     the proxy exemption itself can't be unit-tested here — it's asserted
//     statically in smoke-jarvis-ui)
//   - POST with the valid secret → 200 {subscribers} + fires the globalThis
//     bus (subscribed listener receives the event)
//   - subscriber count reflects registered mock subscribers (0 → 1 → 2 → 0)
// Env is set BEFORE imports so the secret lives in a temp file, never the
// live ~/.agentic-os/jarvis-hotkey.secret.
// Run: npx tsx scripts/v2/smoke-jarvis-hotkey.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-jarvis-hotkey-"));
const secretFile = path.join(tmpDir, "jarvis-hotkey.secret");
process.env.AGENTIC_OS_HOTKEY_SECRET = secretFile;

// ── imports AFTER env (routes/libs resolve the temp secret path) ────────────
const setupRoute = await import("../../src/app/api/jarvis/hotkey/setup/route.ts");
const hotkeyRoute = await import("../../src/app/api/jarvis/hotkey/route.ts");
const bus = await import("../../src/lib/v2/jarvis/hotkeyBus.ts");

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

try {
  // 0. Before setup: no secret configured → POST is refused loudly (503).
  {
    const res = await postHotkey({ "x-agentos-hotkey-secret": "deadbeef" });
    check("POST before setup → 503 not-configured", res.status === 503, res.status);
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

  // 2. Second setup GET → SAME secret (idempotent, no rotation).
  const setup2 = await (await setupRoute.GET()).json();
  check("second setup GET returns the SAME secret", setup2.secret === setup1.secret);

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
    const res = await postHotkey({ "x-agentos-hotkey-secret": setup1.secret });
    const j = await res.json();
    check("valid POST → 200", res.status === 200, res.status);
    check("zero SSE subscribers reported", j.subscribers === 0, j);
  }

  // 5. Subscribe via the exported bus → event received + count reflects it.
  const received = [];
  const off1 = bus.subscribeHotkey((ev) => received.push(ev));
  {
    const res = await postHotkey({ "x-agentos-hotkey-secret": setup1.secret }, { key: "F13" });
    const j = await res.json();
    check("POST with 1 subscriber → subscribers: 1", j.subscribers === 1, j);
    check("bus event received", received.length === 1, received);
    check("event shape {type:'hotkey', ts, key}",
      received[0]?.type === "hotkey" && typeof received[0]?.ts === "string" && received[0]?.key === "F13",
      received[0]);
  }

  // 6. Second mock subscriber → count 2; unsubscribes drop it back to 0.
  const off2 = bus.subscribeHotkey(() => {});
  {
    const res = await postHotkey({ "x-agentos-hotkey-secret": setup1.secret });
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

  // NOTE: the src/proxy.ts exemption (POST + header passes without a cookie)
  // runs in the Next proxy layer and is asserted statically by smoke-jarvis-ui.
} catch (e) {
  check("smoke ran without throwing", false, String(e?.stack || e));
}

console.log(failures === 0 ? "\nsmoke-jarvis-hotkey: ALL PASS" : `\nsmoke-jarvis-hotkey: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
