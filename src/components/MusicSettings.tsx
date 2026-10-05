"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";
import { isMaskedSecret } from "@/lib/settingsRedact";

const ACCENT = "#c084fc";

// Music (Suno) config. Suno has no official public API, so this holds whichever the user
// uses: a third-party Suno API key, OR their Suno account cookie (self-host suno-api style).
// Both scaffolded; the key path is wired into lib/suno.ts. No project-shipped keys.
export default function MusicSettings() {
  const { settings, saving, save } = useSettings();
  const [backend, setBackend] = useState<"key" | "cookie">("key");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [cookie, setCookie] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const m = settings.music || {};
    setBackend(m.backend === "cookie" ? "cookie" : "key");
    setApiKey(m.sunoApiKey || ""); setBaseUrl(m.sunoBaseUrl || ""); setCookie(m.sunoCookie || "");
  }, [settings]);

  async function onSave() {
    await save({ music: { backend, sunoApiKey: apiKey.trim(), sunoBaseUrl: baseUrl.trim(), sunoCookie: cookie.trim() } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Music / Suno settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Suno has no official public API. Add whichever you use — a third-party Suno API key, or your Suno login cookie. Stored locally in <span className="mono">~/.agentic-os/settings.json</span>.
      </p>

      <Field label="Backend">
        <div className="flex gap-2">
          {(["key", "cookie"] as const).map((b) => (
            <button key={b} onClick={() => setBackend(b)}
              className="px-3 h-8 rounded-lg text-[12px] font-medium transition"
              style={backend === b
                ? { background: `${ACCENT}22`, border: `1px solid ${ACCENT}`, color: "var(--fg, #e8e2f0)" }
                : { border: "1px solid var(--panel-border, #2a2436)", color: "var(--fg-dim, #9aa)" }}>
              {b === "key" ? "Third-party API key" : "Account cookie"}
            </button>
          ))}
        </div>
      </Field>

      {backend === "key" ? (
        <>
          <Field label="Suno API key" hint="From an unofficial Suno API (e.g. sunoapi.org). Used server-side.">
            <TextInput type={isMaskedSecret(apiKey) ? "text" : "password"} placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </Field>
          <Field label="API base URL" hint="Defaults to https://api.sunoapi.org if blank.">
            <TextInput placeholder="https://api.sunoapi.org" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
          </Field>
        </>
      ) : (
        <Field label="Suno account cookie" hint="Your suno.com session cookie (self-host suno-api style). Scaffolded — not yet wired into generation.">
          <TextInput type={isMaskedSecret(cookie) ? "text" : "password"} placeholder="paste cookie…" value={cookie} onChange={(e) => setCookie(e.target.value)} />
        </Field>
      )}

      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
