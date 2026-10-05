import { randomUUID } from "node:crypto";
import type { UiCommand, UiRequestEvent, UiResult } from "./uiProtocol";

type Pending = { token: string; finish: (result: UiResult) => void };
const globalBus = globalThis as typeof globalThis & { __jarvisUiRequests?: Map<string, Pending> };
const pending = globalBus.__jarvisUiRequests ??= new Map<string, Pending>();

/** Result tokens are per command, never stored or exposed in model output. */
export function requestUi(command: UiCommand, emit: (event: UiRequestEvent) => void,
  signal?: AbortSignal, timeoutMs = 30000): Promise<UiResult> {
  if (signal?.aborted) return Promise.resolve({ ok: false, error: "UI request cancelled" });
  return new Promise((resolve) => {
    const id = randomUUID(), token = randomUUID();
    const finish = (result: UiResult) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      pending.delete(id);
      resolve(result);
    };
    const abort = () => finish({ ok: false, error: "UI request cancelled" });
    const timer = setTimeout(() => finish({ ok: false, error: "Active tab did not acknowledge the command. Do not claim success or retry a write without inspecting." }), timeoutMs);
    pending.set(id, { token, finish });
    signal?.addEventListener("abort", abort, { once: true });
    try { emit({ type: "ui_request", id, token, expiresAt: Date.now() + timeoutMs, command }); }
    catch { finish({ ok: false, error: "Browser stream unavailable" }); }
  });
}

export function resolveUi(id: string, token: string, result: UiResult): boolean {
  const entry = pending.get(id);
  if (!entry || entry.token !== token) return false;
  entry.finish(result);
  return true;
}
