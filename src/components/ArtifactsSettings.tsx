"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";

const ACCENT = "#d97757"; // Claude rust, same as the Artifacts tab

// Artifacts config (rule 16): the dedicated Netlify site publishes deploy to. Saved to
// settings.artifacts and read per publish; ~/.agentic-os/artifacts-site.json is only a
// legacy fallback while the site ID here is blank. No key: the netlify CLI is logged in
// from your own terminal.
export interface ArtifactsSite { siteId: string; name: string; baseUrl: string; source: "settings" | "file" }

export default function ArtifactsSettings({ site, onSaved }: { site?: ArtifactsSite | null; onSaved?: () => void }) {
  const { settings, saving, save } = useSettings();
  const [siteId, setSiteId] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const a = settings.artifacts || {};
    // Settings first; while they are blank and the tab is running on the legacy file, prefill
    // from that file so one Save moves it into settings instead of typing it again.
    const fromFile = !a.siteId && site?.source === "file" ? site : null;
    setSiteId(a.siteId || fromFile?.siteId || ""); setName(a.name || fromFile?.name || ""); setBaseUrl(a.baseUrl || fromFile?.baseUrl || "");
  }, [settings, site]);

  async function onSave() {
    await save({ artifacts: { siteId: siteId.trim(), name: name.trim(), baseUrl: baseUrl.trim().replace(/\/+$/, "") } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
    onSaved?.();
  }

  return (
    <ConfigMenu title="Artifacts settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        The Netlify site every Publish deploys to. Keep it separate from your guides and SEO sites: a deploy replaces the whole site. No key here; log in once with <code>netlify login</code> in your own terminal.
      </p>
      <Field label="Netlify site ID" hint="Netlify > the site > Site configuration > Site ID (a UUID). Blank means Publish is refused.">
        <TextInput placeholder="e.g. 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d" value={siteId} onChange={(e) => setSiteId(e.target.value)} />
      </Field>
      <Field label="Site name" hint="A label for you; defaults to the site ID.">
        <TextInput placeholder="e.g. agent-os-artifacts" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Base URL" hint="The site's public https address; every published link is <base URL>/<slug>/.">
        <TextInput placeholder="https://your-artifacts.netlify.app" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
