// SPEC-F K1.1 — the addy.io REST client.
//
// Every call rides config.addyFetch(), which is the only holder of the API key.
// This module never sees it. Non-2xx is LOUD (AddyError with the status + a
// body snippet) — an alias that silently failed to create would mean a
// newsletter signed up to an address that does not exist.
//
// Endpoints (addy.io API v1): GET/POST /aliases, PATCH-ish activation via
// POST /active-aliases (activate) and DELETE /active-aliases/:id (deactivate),
// which is how addy models the active flag.

import { addyFetch, AddyError } from "./config";

export interface AddyAlias {
  id: string;
  email: string;
  description: string | null;
  active: boolean;
  domain: string | null;
  createdAt: string | null;
}

interface AddyAliasWire {
  id?: unknown;
  email?: unknown;
  description?: unknown;
  active?: unknown;
  domain?: unknown;
  created_at?: unknown;
}

function toAlias(raw: unknown): AddyAlias | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as AddyAliasWire;
  if (typeof w.id !== "string" || typeof w.email !== "string") return null;
  return {
    id: w.id,
    email: w.email,
    description: typeof w.description === "string" ? w.description : null,
    active: w.active !== false,
    domain: typeof w.domain === "string" ? w.domain : null,
    createdAt: typeof w.created_at === "string" ? w.created_at : null,
  };
}

function unwrapData(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    return (payload as Record<string, unknown>).data;
  }
  return payload;
}

/** The description we stamp on every alias we create (SPEC-F §5). */
export function aliasDescription(name: string): string {
  return `agentos-newsletter: ${name}`;
}

/** Create an alias. `domain` defaults to the account's default addy domain. */
export async function createAlias(input: {
  description: string;
  domain?: string;
  format?: string;
}): Promise<AddyAlias> {
  const body: Record<string, unknown> = { description: input.description };
  if (input.domain) body.domain = input.domain;
  if (input.format) body.format = input.format;
  const alias = toAlias(unwrapData(await addyFetch("/aliases", { method: "POST", body })));
  if (!alias) {
    throw new AddyError("addy.io: alias create returned an unrecognised payload", 502);
  }
  return alias;
}

/** List aliases (the --addy-ping leg prints the COUNT only, never a value). */
export async function listAliases(): Promise<AddyAlias[]> {
  const data = unwrapData(await addyFetch("/aliases"));
  if (!Array.isArray(data)) {
    throw new AddyError("addy.io: alias list returned an unrecognised payload", 502);
  }
  return data.map(toAlias).filter((a): a is AddyAlias => a !== null);
}

/**
 * Toggle an alias. addy models "active" as its own collection: POST to add,
 * DELETE to remove. A 404 on deactivate means it was already inactive — still
 * surfaced, because a pause that did not take is a real problem.
 */
export async function setAliasActive(aliasId: string, active: boolean): Promise<void> {
  if (active) {
    await addyFetch("/active-aliases", { method: "POST", body: { id: aliasId } });
    return;
  }
  await addyFetch(`/active-aliases/${encodeURIComponent(aliasId)}`, { method: "DELETE" });
}

export { AddyError };
