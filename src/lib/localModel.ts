// Single source of truth for "which local model is the Local agent using right now".
// The agent FOLLOWS whatever model you've pinned warm in Ollama, so labels never lie
// and you never eat a cold-load. Precedence:
//   1. LOCAL_MODEL env (explicit override) — respected even if not warm
//   2. whatever model is currently loaded/warm (ollama ps) — the common case
//   3. any model actually installed (ollama /api/tags)
//   4. FALLBACK_MODEL — last resort only
export const OLLAMA = "http://127.0.0.1:11434";
// NOTE: this tag is NOT installed on every machine. It used to be returned whenever
// Ollama was down or nothing was warm, so callers then requested a model that doesn't
// exist and got a 404 they reported as "Ollama isn't running". We now ask Ollama what
// it actually has before falling back to this.
export const FALLBACK_MODEL = "xentriom/gemma-4-12B-coder-fable5-composer2.5-v1";

/** Models actually present on the local daemon (empty if it's down). */
export async function installedModels(): Promise<string[]> {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { cache: "no-store" });
    if (!r.ok) return [];
    const j = await r.json();
    return ((j?.models as { name?: string }[]) || []).map((m) => m?.name || "").filter(Boolean);
  } catch { return []; }
}

export async function resolveModel(): Promise<{ model: string; warm: boolean }> {
  const forced = process.env.LOCAL_MODEL;
  if (forced) return { model: forced, warm: true };
  try {
    const r = await fetch(`${OLLAMA}/api/ps`, { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      const loaded: string[] = (j.models || [])
        .map((m: { name?: string; model?: string }) => m.name || m.model)
        .filter(Boolean);
      if (loaded.length) return { model: loaded[0], warm: true };
    }
  } catch { /* ollama down — fall through */ }
  // Nothing warm: use something that's actually installed rather than a fixed tag.
  const installed = await installedModels();
  if (installed.length) {
    const pick = installed.find((m) => /coder|code|glm|kimi|qwen|llama/i.test(m)) || installed[0];
    return { model: pick, warm: false };
  }
  return { model: FALLBACK_MODEL, warm: false };
}
