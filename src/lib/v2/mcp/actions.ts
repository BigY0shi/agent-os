import { z } from "zod";
import { registerAction } from "./registry";
import { execSlot, filesSlot, codingSlot } from "../capability/slots";

/**
 * F4.4 core capability actions. Registered lazily (ensureCoreActions) — never
 * at module import time. External (strict) callers hit the deny-by-default
 * gates in capability/gate.ts (CONVENTIONS §9.1).
 */

declare global {
  // eslint-disable-next-line no-var
  var __agentosCoreActions: boolean | undefined;
}

export function ensureCoreActions(): void {
  if (globalThis.__agentosCoreActions) return;
  globalThis.__agentosCoreActions = true;

  registerAction({
    key: "exec_command",
    module: "capability",
    description:
      "Run a shell command on the host. Validated against deny lists and Bash(<glob>) allow patterns; external callers are deny-all until commands are opted in via Settings → Capabilities.",
    inputSchema: z.object({
      command: z.string().min(1).describe("The shell command to run"),
      cwd: z.string().optional().describe("Working directory (must be exec-scoped)"),
      timeoutMs: z.number().int().positive().max(600000).optional(),
    }),
    handler: (args, ctx) =>
      execSlot(
        { command: String(args.command), cwd: args.cwd as string | undefined, timeoutMs: args.timeoutMs as number | undefined },
        { strict: ctx.strict },
      ),
  });

  registerAction({
    key: "read_file",
    module: "capability",
    description: "Read a text file from a files-scoped folder.",
    inputSchema: z.object({ path: z.string().min(1) }),
    handler: (args, ctx) => filesSlot({ op: "read", path: String(args.path) }, { strict: ctx.strict }),
  });

  registerAction({
    key: "write_file",
    module: "capability",
    description:
      "Write a text file inside a files-scoped folder. Overwrites exile the previous copy first (never destructive).",
    inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
    handler: (args, ctx) =>
      filesSlot({ op: "write", path: String(args.path), content: String(args.content) }, { strict: ctx.strict }),
  });

  registerAction({
    key: "list_files",
    module: "capability",
    description: "Glob for files under a files-scoped directory (e.g. pattern '*.ts').",
    inputSchema: z.object({ dir: z.string().min(1), pattern: z.string().default("*") }),
    handler: (args, ctx) =>
      filesSlot(
        { op: "glob", dir: String(args.dir), pattern: String(args.pattern ?? "*") },
        { strict: ctx.strict },
      ),
  });

  registerAction({
    key: "grep_files",
    module: "capability",
    description: "Search file contents under a files-scoped directory for a query string.",
    inputSchema: z.object({
      dir: z.string().min(1),
      query: z.string().min(1),
      filePattern: z.string().optional(),
    }),
    handler: (args, ctx) =>
      filesSlot(
        {
          op: "grep",
          dir: String(args.dir),
          query: String(args.query),
          filePattern: args.filePattern as string | undefined,
        },
        { strict: ctx.strict },
      ),
  });

  registerAction({
    key: "coding_ask",
    module: "capability",
    description:
      "One-shot coding-agent completion (Claude/Codex/etc per configured routing) rooted in a coding-scoped folder.",
    inputSchema: z.object({
      agent: z.string().default("claude"),
      prompt: z.string().min(1),
      cwd: z.string().min(1),
      timeoutMs: z.number().int().positive().max(600000).optional(),
    }),
    handler: (args, ctx) =>
      codingSlot(
        {
          agent: String(args.agent ?? "claude"),
          prompt: String(args.prompt),
          cwd: String(args.cwd),
          timeoutMs: args.timeoutMs as number | undefined,
        },
        { strict: ctx.strict },
      ),
  });
}
