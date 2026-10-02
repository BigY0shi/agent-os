// Ollama, one door for every module (S30 settings sweep; owner 2026-09-30: "every parameter
// needs to be in the settings for every module").
//
// Before this file, nine places read process.env.OLLAMA_API_KEY themselves and six carried
// their own copy of the host literal. Now the settings.ollama block (edited in the Ollama
// Cloud page's gear) is read PER CALL, so a change applies to the next request with no
// rebuild and no restart, and the environment is the fallback for an install that still
// configures it in .env.local.
//
// Precedence everywhere: settings value, then the environment, then the literal default.
// The key is the one secret here: it is returned only to the request that uses it (the
// Authorization header), never through an API or a getter the browser can reach
// (AGENTS.md "Credentials leave through exactly one door"); /api/settings masks it.

import { readSettings } from "./settings";

export const OLLAMA_CLOUD_HOST_DEFAULT = "https://ollama.com";
export const OLLAMA_LOCAL_URL_DEFAULT = "http://127.0.0.1:11434";

function block(): { apiKey?: string; host?: string; defaultModel?: string; localUrl?: string } {
  return (readSettings().ollama ?? {}) as { apiKey?: string; host?: string; defaultModel?: string; localUrl?: string };
}
const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const noSlash = (u: string): string => u.replace(/\/+$/, "");

/** The Ollama Cloud key: settings.ollama.apiKey, else OLLAMA_API_KEY / OLLAMA_CLOUD_KEY. null = none. */
export function ollamaCloudKey(): string | null {
  const k = clean(block().apiKey) || clean(process.env.OLLAMA_API_KEY) || clean(process.env.OLLAMA_CLOUD_KEY);
  return k || null;
}

/** Where the key came from, for status lines ("set in settings" / "from OLLAMA_API_KEY"); never the key. */
export function ollamaCloudKeySource(): "settings" | "env" | null {
  if (clean(block().apiKey)) return "settings";
  if (clean(process.env.OLLAMA_API_KEY) || clean(process.env.OLLAMA_CLOUD_KEY)) return "env";
  return null;
}

/** The Ollama Cloud host, no trailing slash: settings.ollama.host, else OLLAMA_CLOUD_HOST, else https://ollama.com. */
export function ollamaCloudHost(): string {
  return noSlash(clean(block().host) || clean(process.env.OLLAMA_CLOUD_HOST) || OLLAMA_CLOUD_HOST_DEFAULT);
}

/**
 * The Ollama Cloud model a caller uses when nothing picked one: settings.ollama.defaultModel,
 * else OLLAMA_CLOUD_MODEL, else the caller's own last resort (`fallback`), else "". The
 * Ollama page passes its qwen3-coder:480b; a Room "auto" agent passes nothing and takes the
 * account's first listed model when this is "", exactly as before the sweep.
 */
export function ollamaCloudDefaultModel(fallback = ""): string {
  return clean(block().defaultModel) || clean(process.env.OLLAMA_CLOUD_MODEL) || fallback;
}

/** The local Ollama daemon, no trailing slash: settings.ollama.localUrl, else OLLAMA_URL, else `fallback`. */
export function ollamaLocalUrl(fallback = OLLAMA_LOCAL_URL_DEFAULT): string {
  return noSlash(clean(block().localUrl) || clean(process.env.OLLAMA_URL) || fallback);
}
