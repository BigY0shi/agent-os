// SPEC-D §9 connector-schemas smoke: for EVERY registered connector (gmail,
// gcal, notion, github, slack, buzz, _test): every tool name is slug-prefixed,
// every inputSchema is valid JSON Schema (round-trips through JSON,
// object-typed, required ⊆ properties), spec completeness (auth params
// present, schedule frequency valid per cronToRrule), and destructive tools
// carry destructiveHint. No DB writes, no network.
// Run: npx tsx scripts/v2/smoke-connector-schemas.mjs
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Defensive env overrides — nothing here should open the live DB/settings/key,
// but a regression that does must never touch them.
const stamp = Date.now();
process.env.AGENTIC_OS_DB = path.join(os.tmpdir(), `agentos-smoke-schemas-${stamp}.db`);
const settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-schemas-"));
process.env.AGENTIC_OS_SETTINGS = path.join(settingsDir, "settings.json");
process.env.AGENTIC_OS_KEY = path.join(settingsDir, "agentos.key");

const registry = await import("../../src/lib/v2/integrations/registry.ts");
const { cronToRrule } = await import("../../src/lib/v2/scheduler.ts");

let failures = 0;
const check = (name, cond, extra) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  if (!cond) failures++;
};

const connectors = registry.listConnectors({ includeHidden: true });
check(
  "registry lists gmail + gcal + notion + github + slack + buzz + _test",
  ["gmail", "gcal", "notion", "github", "slack", "buzz", "_test"].every((slug) =>
    connectors.some((c) => c.spec.slug === slug),
  ),
  connectors.map((c) => c.spec.slug),
);

// Name-based destructive heuristic: a tool whose action verb implies a write
// with side effects MUST be annotated destructive. (draft/read/list/get/search
// are deliberately outside the net.)
const DESTRUCTIVE_NAME = /(send|delete|create|update|modify|batch|quick_add)/;

const EXPECTED_TOOL_COUNTS = { gmail: 20, gcal: 8, notion: 16, github: 10, slack: 5, buzz: 3, _test: 2 };

for (const connector of connectors) {
  const { spec } = connector;
  const slug = spec.slug;

  // ── spec completeness ─────────────────────────────────────────────────────
  check(`[${slug}] spec has name/slug/description`, !!spec.name && !!spec.slug && !!spec.description);
  const auth = spec.auth ?? {};
  const oauthOk = !!auth.oauth2 && !!auth.oauth2.authorization_url && !!auth.oauth2.token_url;
  const apiKeyOk =
    !!auth.apiKey && Array.isArray(auth.apiKey.fields) && auth.apiKey.fields.length > 0 &&
    auth.apiKey.fields.every((f) => !!f.name);
  const localOk = auth.local === true;
  check(`[${slug}] auth params present (oauth2/apiKey/local)`, oauthOk || apiKeyOk || localOk, auth);
  if (auth.oauth2) {
    // Declared-empty arrays are allowed for scope-less providers (Notion's
    // OAuth has no scope concept — upstream ships scopes: []).
    check(
      `[${slug}] oauth2 scopes declared (array present; empty only for scope-less providers)`,
      Array.isArray(auth.oauth2.scopes) || Array.isArray(auth.oauth2.default_scopes),
    );
    if (slug !== "notion") {
      check(
        `[${slug}] oauth2 scopes non-empty`,
        (auth.oauth2.scopes?.length ?? 0) + (auth.oauth2.default_scopes?.length ?? 0) > 0,
      );
    }
  }
  if (spec.schedule) {
    let rrule = null;
    let scheduleErr = null;
    try {
      rrule = cronToRrule(spec.schedule.frequency);
    } catch (err) {
      scheduleErr = err;
    }
    check(
      `[${slug}] schedule frequency '${spec.schedule.frequency}' valid per cronToRrule`,
      !!rrule && !scheduleErr,
      scheduleErr?.message,
    );
  }
  for (const trigger of spec.triggers ?? []) {
    check(`[${slug}] trigger ${trigger.key} has key + label`, !!trigger.key && !!trigger.label);
  }

  // ── tools ─────────────────────────────────────────────────────────────────
  const tools = connector.getTools();
  const expected = EXPECTED_TOOL_COUNTS[slug];
  if (expected !== undefined) {
    check(`[${slug}] tool count ${tools.length} === ${expected}`, tools.length === expected);
  }
  check(`[${slug}] tool names unique`, new Set(tools.map((t) => t.name)).size === tools.length);

  for (const tool of tools) {
    const t = `[${slug}] ${tool.name}`;
    check(`${t}: slug-prefixed name`, tool.name.startsWith(slug), tool.name);
    check(`${t}: has description`, typeof tool.description === "string" && tool.description.length > 0);

    // JSON Schema validity: JSON round-trip, object-typed, required ⊆ properties.
    let schema = null;
    try {
      schema = JSON.parse(JSON.stringify(tool.inputSchema));
    } catch {
      /* fallthrough */
    }
    const isObjectSchema =
      !!schema && typeof schema === "object" && schema.type === "object" &&
      (schema.properties === undefined || typeof schema.properties === "object");
    check(`${t}: inputSchema is a valid object JSON Schema`, isObjectSchema, tool.inputSchema);
    if (isObjectSchema && Array.isArray(schema.required)) {
      const propKeys = Object.keys(schema.properties ?? {});
      check(
        `${t}: required ⊆ properties`,
        schema.required.every((r) => propKeys.includes(r)),
        { required: schema.required, properties: propKeys },
      );
    }

    // Destructive annotation discipline.
    const local = tool.name.slice(slug.length); // action part after the prefix
    if (DESTRUCTIVE_NAME.test(local) && !local.includes("draft")) {
      check(
        `${t}: destructive-named tool carries destructiveHint`,
        tool.annotations?.destructiveHint === true,
        tool.annotations,
      );
    }
    if (tool.annotations?.readOnlyHint === true) {
      check(
        `${t}: readOnly tool is not ALSO destructive`,
        tool.annotations?.destructiveHint !== true,
      );
    }
  }
}

// Named G3.1/G3.5 spot checks (the ones the spec calls out).
const gmailTools = registry.getConnector("gmail").getTools();
const sendEmail = gmailTools.find((t) => t.name === "gmail_send_email");
check("gmail_send_email exists + destructiveHint", sendEmail?.annotations?.destructiveHint === true);
const search = gmailTools.find((t) => t.name === "gmail_search_emails");
check("gmail_search_emails read-only", search?.annotations?.readOnlyHint === true && !search?.annotations?.destructiveHint);
check("gmail_search_emails schema requires query", JSON.parse(JSON.stringify(search.inputSchema)).required?.includes("query"));
const gcalTools = registry.getConnector("gcal").getTools();
check("gcal_list_events + gcal_create_event exist", ["gcal_list_events", "gcal_create_event"].every((n) => gcalTools.some((t) => t.name === n)));
check("gcal_create_event destructiveHint", gcalTools.find((t) => t.name === "gcal_create_event")?.annotations?.destructiveHint === true);
check("gcal spec declares GCAL_EVENT_SOON trigger", registry.getConnector("gcal").spec.triggers.some((tr) => tr.key === "GCAL_EVENT_SOON"));
check("gmail spec declares GMAIL_MESSAGE_RECEIVED trigger", registry.getConnector("gmail").spec.triggers.some((tr) => tr.key === "GMAIL_MESSAGE_RECEIVED"));
check("google connectors disable PKCE (web-app flow)", ["gmail", "gcal"].every((s) => registry.getConnector(s).spec.auth.oauth2.disable_pkce === true));

// Named G3.3/G3.4/G3.6/G3.7 spot checks (chunk 3).
const notionSpec = registry.getConnector("notion").spec;
check(
  "notion oauth: basic token auth + owner=user + PKCE disabled (§3.3)",
  notionSpec.auth.oauth2.token_request_auth_method === "basic" &&
    notionSpec.auth.oauth2.authorization_params?.owner === "user" &&
    notionSpec.auth.oauth2.disable_pkce === true,
);
check("notion also offers the api-key lane (internal integration token)", !!notionSpec.auth.apiKey);
check("notion has NO sync (wave 1 — nothing upstream to port)", !registry.getConnector("notion").sync && !notionSpec.schedule);
const notionTools = registry.getConnector("notion").getTools();
check(
  "notion_update_page destructive + notion_get_page read-only (upstream annotations)",
  notionTools.find((t) => t.name === "notion_update_page")?.annotations?.destructiveHint === true &&
    notionTools.find((t) => t.name === "notion_get_page")?.annotations?.readOnlyHint === true,
);
check(
  "notion_create_page keeps the upstream prompt-description verbatim (spot phrase)",
  notionTools.find((t) => t.name === "notion_create_page")?.description.includes("Notion-flavored Markdown"),
);

const githubC = registry.getConnector("github");
check("github is api-key (PAT) auth with a token field", githubC.spec.auth.apiKey?.fields?.[0]?.name === "token" && !githubC.spec.auth.oauth2);
check("github declares GITHUB_NOTIFICATION + GITHUB_ISSUE_ASSIGNED triggers", ["GITHUB_NOTIFICATION", "GITHUB_ISSUE_ASSIGNED"].every((k) => githubC.spec.triggers.some((t) => t.key === k)));
check("github has a sync (notifications poll)", typeof githubC.sync === "function");
check("github_create_issue destructiveHint", githubC.getTools().find((t) => t.name === "github_create_issue")?.annotations?.destructiveHint === true);

const slackC = registry.getConnector("slack");
check("slack is bot-token api-key auth (token + defaultChannel fields)", slackC.spec.auth.apiKey?.fields?.some((f) => f.name === "token") && slackC.spec.auth.apiKey?.fields?.some((f) => f.name === "defaultChannel"));
check("slack implements verifyWebhook + webhookChallenge + identify/process (G3.6)", typeof slackC.verifyWebhook === "function" && typeof slackC.webhookChallenge === "function" && typeof slackC.identify === "function" && typeof slackC.process === "function");
check("slack declares SLACK_MESSAGE_RECEIVED + SLACK_REACTION_ADDED", ["SLACK_MESSAGE_RECEIVED", "SLACK_REACTION_ADDED"].every((k) => slackC.spec.triggers.some((t) => t.key === k)));
check("slack_post_message destructiveHint", slackC.getTools().find((t) => t.name === "slack_post_message")?.annotations?.destructiveHint === true);

const buzzC = registry.getConnector("buzz");
check("buzz is LOCAL auth (no fields)", buzzC.spec.auth.local === true && !buzzC.spec.auth.apiKey && !buzzC.spec.auth.oauth2);
check("buzz declares BUZZ_MESSAGE_RECEIVED + has a sync", buzzC.spec.triggers.some((t) => t.key === "BUZZ_MESSAGE_RECEIVED") && typeof buzzC.sync === "function");
check("buzz_post_message destructiveHint (messages real people)", buzzC.getTools().find((t) => t.name === "buzz_post_message")?.annotations?.destructiveHint === true);
check(
  "google connectors request offline access + consent",
  ["gmail", "gcal"].every((s) => {
    const p = registry.getConnector(s).spec.auth.oauth2.authorization_params;
    return p?.access_type === "offline" && p?.prompt === "consent";
  }),
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
