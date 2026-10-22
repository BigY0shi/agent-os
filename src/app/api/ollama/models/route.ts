export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lists the Ollama Cloud models the account can run (GET /api/tags on ollama.com).
// Feeds the model dropdown in the Ollama Cloud panel so we never hardcode tags.
// Key and host: settings.ollama (the page's gear), then the environment (lib/ollamaCloud.ts).
import { ollamaCloudHost, ollamaCloudKey } from "@/lib/ollamaCloud";

// Surfaced first in the dropdown — strongest coders, if present on the account.
const PREFERRED = ["qwen3-coder:480b", "qwen3-coder-next", "kimi-k2.7-code", "deepseek-v4-pro", "glm-5.2", "gpt-oss:120b"];

export async function GET() {
  const key = ollamaCloudKey();
  if (!key) {
    return Response.json({ ok: false, models: [], error: "No Ollama Cloud key: add it in the gear, or set OLLAMA_API_KEY." }, { status: 200 });
  }
  try {
    const r = await fetch(`${ollamaCloudHost()}/api/tags`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return Response.json({ ok: false, models: [], error: `HTTP ${r.status}: ${t.slice(0, 200)}` }, { status: 200 });
    }
    const j = await r.json();
    const names: string[] = (j.models || []).map((m: { name?: string; model?: string }) => m.name || m.model).filter(Boolean);
    // preferred coders first, then the rest alphabetically
    const pref = PREFERRED.filter((p) => names.includes(p));
    const rest = names.filter((n) => !pref.includes(n)).sort((a, b) => a.localeCompare(b));
    return Response.json({ ok: true, models: [...pref, ...rest] });
  } catch (e) {
    return Response.json({ ok: false, models: [], error: String(e) }, { status: 200 });
  }
}
