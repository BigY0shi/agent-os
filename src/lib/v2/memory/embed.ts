import { getDb } from "../db";
import { readSettings } from "../../settings";

/**
 * F1.5 embeddings via Ollama (/api/embed). L2-normalized on the way out so
 * cosine distance semantics hold everywhere (vec0 tables assume it).
 * Hard-fails on dimension mismatch — silent zero-padding degrades recall
 * (upstream localEmbeddings dim-guard, kept).
 */

function baseUrl(): { url: string; headers: Record<string, string> } {
  const provider = readSettings().memory?.embedProvider ?? "ollama-local";
  if (provider === "ollama-cloud") {
    const key = process.env.OLLAMA_API_KEY || "";
    return {
      url: "https://ollama.com",
      headers: key ? { authorization: `Bearer ${key}` } : {},
    };
  }
  return { url: process.env.OLLAMA_URL || "http://127.0.0.1:11434", headers: {} };
}

function expectedDim(): number {
  const row = getDb()
    .prepare("SELECT value FROM meta WHERE key = 'embed_dim'")
    .get() as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : 768;
}

function l2normalize(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0 || Number.isNaN(norm)) return v;
  return v.map((x) => x / norm);
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = readSettings().memory?.embedModel ?? "nomic-embed-text";
  const { url, headers } = baseUrl();

  const res = await fetch(`${url}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `embed failed (${res.status}) against ${url} model=${model}: ${body.slice(0, 300)}. ` +
        `Is Ollama running and is the model pulled? (ollama pull ${model})`,
    );
  }
  const data = (await res.json()) as { embeddings?: number[][] };
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error(`embed returned ${data.embeddings?.length ?? 0} vectors for ${texts.length} inputs`);
  }

  const dim = expectedDim();
  return data.embeddings.map((v, i) => {
    if (v.length !== dim) {
      throw new Error(
        `embed dimension mismatch: model '${model}' returned ${v.length}d but agentos.db is pinned to ${dim}d ` +
          `(meta.embed_dim). Changing the embed model requires re-embedding everything: run scripts/v2/reembed.mjs ` +
          `(input ${i}).`,
      );
    }
    return l2normalize(v);
  });
}

export async function getEmbedding(text: string): Promise<number[]> {
  const [v] = await getEmbeddings([text]);
  return v;
}
