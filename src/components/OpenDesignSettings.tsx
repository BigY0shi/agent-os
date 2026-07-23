"use client";

import { useEffect, useState } from "react";
import ConfigMenu, { useSettings, Field, TextInput, SaveBar } from "./ConfigMenu";

const ACCENT = "#e879f9";

// Open Design config — point the dashboard at YOUR install (URL/ports) and tell it how to
// start/stop OD on your machine. Replaces the old hardcoded :7455/:7456 + macOS-only scripts.
export default function OpenDesignSettings() {
  const { settings, saving, save } = useSettings();
  const [webUrl, setWebUrl] = useState("");
  const [daemonUrl, setDaemonUrl] = useState("");
  const [launchCmd, setLaunchCmd] = useState("");
  const [stopCmd, setStopCmd] = useState("");
  const [installPath, setInstallPath] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    const od = settings.opendesign || {};
    setWebUrl(od.webUrl || "http://127.0.0.1:7456");
    setDaemonUrl(od.daemonUrl || "http://127.0.0.1:7455");
    setLaunchCmd(od.launchCmd || "");
    setStopCmd(od.stopCmd || "");
    setInstallPath(od.installPath || "");
  }, [settings]);

  async function onSave() {
    await save({ opendesign: { webUrl: webUrl.trim(), daemonUrl: daemonUrl.trim(), launchCmd: launchCmd.trim(), stopCmd: stopCmd.trim(), installPath: installPath.trim() } });
    setSaved(true); setTimeout(() => setSaved(false), 1800);
  }

  return (
    <ConfigMenu title="Open Design settings" accent={ACCENT} buttonLabel="Configure">
      <p className="text-[11.5px] mb-4" style={{ color: "var(--fg-dimmer, #6b6478)" }}>
        Point the dashboard at your Open Design install and tell it how to start/stop OD. No API keys.
      </p>
      <Field label="Web UI URL" hint="The Open Design studio the dashboard embeds + pops out.">
        <TextInput placeholder="http://127.0.0.1:7456" value={webUrl} onChange={(e) => setWebUrl(e.target.value)} />
      </Field>
      <Field label="Daemon URL" hint="Health-check endpoint used to detect if OD is running.">
        <TextInput placeholder="http://127.0.0.1:7455" value={daemonUrl} onChange={(e) => setDaemonUrl(e.target.value)} />
      </Field>
      <Field label="Launch command" hint="How you start Open Design on this machine. Runs through your OS shell.">
        <TextInput placeholder="e.g. npm run start  (or a .bat / full command)" value={launchCmd} onChange={(e) => setLaunchCmd(e.target.value)} />
      </Field>
      <Field label="Stop command" hint="Optional — how to stop it.">
        <TextInput placeholder="optional" value={stopCmd} onChange={(e) => setStopCmd(e.target.value)} />
      </Field>
      <Field label="Working directory" hint="The folder the start/stop commands run from (your OD install dir).">
        <TextInput placeholder="e.g. C:\\Users\\you\\open-design" value={installPath} onChange={(e) => setInstallPath(e.target.value)} />
      </Field>
      <SaveBar saving={saving} saved={saved} onSave={onSave} accent={ACCENT} />
    </ConfigMenu>
  );
}
