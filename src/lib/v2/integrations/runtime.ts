import { readSettings } from "../../settings";
import { getConnector } from "./registry";
import {
  IntegrationError,
  getAccount,
  getAccountConfig,
  getDefinitionConfig,
  insertCallLog,
  upsertAccount,
  type AccountRow,
} from "./store";
import {
  ConnectorConfigError,
  type ConnectorTool,
  type SetupInput,
  type ToolResult,
} from "./types";

/**
 * SPEC-D G2.2 — the execution seam every caller goes through. Rules enforced
 * HERE, not per connector (§3.1): decrypt/encrypt of config, timezone
 * injection (decision 10), VERBATIM tool-name pass-through (decision 2),
 * redacted call logging, and the soft/loud error split (decision 6):
 *   - integration-API failures are SOFT → ToolResult {isError:true, text:"Error: ..."}
 *   - config/contract failures (ConnectorConfigError, unknown account/connector)
 *     are LOUD → thrown.
 */

/** Single timezone source: settings.tasks.timezone (CONVENTIONS §10), Intl fallback. */
export function getTimezone(): string {
  return (
    readSettings().tasks?.timezone ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC"
  );
}

function requireConnector(slug: string) {
  const connector = getConnector(slug);
  if (!connector) throw new IntegrationError(`unknown connector '${slug}'`, 404);
  return connector;
}

/** Decrypted call context for an account. Server-side only. */
export function buildCallCtx(account: AccountRow) {
  const config = getAccountConfig(account.id);
  const defConfig = getDefinitionConfig(account.definitionSlug);
  return {
    config,
    defConfig,
    timezone: getTimezone(),
    /** every decrypted value — feed redactArgs value-equality masking */
    secretValues: [...Object.values(config), ...Object.values(defConfig)],
  };
}

/**
 * Run a connector's setup() and upsert the resulting account.
 * Connector-side validation failures (bad api key etc.) surface as
 * IntegrationError 422 with the connector's error text (§5.3); contract
 * violations (ConnectorConfigError) stay 400 and are rethrown as-is.
 */
export async function setupAccount(
  slug: string,
  input: Omit<SetupInput, "defConfig">,
): Promise<AccountRow> {
  const connector = requireConnector(slug);
  const defConfig = getDefinitionConfig(slug);
  let created;
  try {
    created = await connector.setup({ ...input, defConfig });
  } catch (err) {
    if (err instanceof ConnectorConfigError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new IntegrationError(msg, 422);
  }
  return upsertAccount({
    definitionSlug: slug,
    accountId: created.accountId,
    displayName: created.displayName,
    config: created.config,
    settings: created.settings,
  });
}

/** All tools a connector advertises — names are ALREADY slug-prefixed. */
export function getTools(slug: string): ConnectorTool[] {
  return requireConnector(slug).getTools();
}

/**
 * Call one tool on one account. `toolName` is passed to the connector
 * VERBATIM — no prefix-then-strip round trip (decision 2). Every call is
 * logged with redacted args.
 */
export async function callTool(
  accountId: string,
  toolName: string,
  args: Record<string, unknown>,
  opts: { source?: string } = {},
): Promise<ToolResult> {
  const account = getAccount(accountId);
  if (!account) throw new IntegrationError(`account ${accountId} not found`, 404);
  if (!account.isActive) throw new IntegrationError(`account ${accountId} is disconnected`, 409);
  const connector = requireConnector(account.definitionSlug);
  const ctx = buildCallCtx(account);
  const started = Date.now();

  const log = (ok: boolean, error?: string) =>
    insertCallLog({
      accountId,
      toolName,
      source: opts.source,
      args,
      secretValues: ctx.secretValues,
      ok,
      error,
      durationMs: Date.now() - started,
    });

  try {
    const result = await connector.callTool(toolName, args, {
      config: ctx.config,
      defConfig: ctx.defConfig,
      timezone: ctx.timezone,
      accountId: account.id, // G3: token-refresh persistence seam (googleClient)
    });
    log(!result.isError, result.isError ? result.text : undefined);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(false, msg);
    if (err instanceof ConnectorConfigError) throw err; // LOUD
    return { text: `Error: ${msg}`, isError: true }; // SOFT
  }
}

// SPEC-D §3.1 runtime surface parity: the sync/webhook drivers live in
// sync.ts / webhooks.ts (they own activity creation + ingest); re-exported
// here so runtime.ts is the one import a caller needs.
export { runAccountSync as runSync } from "./sync";
export { runProcess } from "./webhooks";
