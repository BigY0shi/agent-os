"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";

const ACCENT = "#d4a574";

// Where the dashboard's "Open Paperclip" links point. Blank = auto-detect from the host you're
// on (localhost on this PC, the LAN IP from a phone). Override for a fixed IP / Tailscale / domain.
export default function PaperclipSettings({ autoUrl }: { autoUrl: string }) {
  const { settings, saving, save } = useSettings();
  const [url, setUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (settings) setUrl(settings.paperclip?.url || ""); }, [settings]);

  async function onSave() {
    await save({ paperclip: { url: url.trim().replace(/\/+$/, "") } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Paperclip settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Where Paperclip runs. Leave blank to auto-detect from whatever host you opened the dashboard on. Override it for a fixed LAN IP, a Tailscale MagicDNS name, or a custom domain.
      </p>
      <Field label="Paperclip URL" hint={`Blank = auto (${autoUrl})`}>
        <TextInput placeholder={autoUrl} value={url} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
