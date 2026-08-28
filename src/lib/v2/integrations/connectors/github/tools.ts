import { z } from "zod";
import { ConnectorConfigError, type CallCtx, type ConnectorTool, type ToolResult } from "../../types";
import { githubRequest } from "./client";

/**
 * SPEC-D G3.4 — GitHub tools per §3.3: repos list, issues list/create/comment,
 * PRs list/get, search code/issues, notifications list/mark-read. Lean REST v3
 * via client.ts (pattern-only — no upstream verbatim source, §4). House rules:
 * `github_*` names verbatim, zod4 z.toJSONSchema, throw = runtime's soft
 * `Error: ...` path, unknown tool = LOUD ConnectorConfigError.
 */

type AnyRecord = Record<string, unknown>;

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ListReposSchema = z.object({
  visibility: z.enum(["all", "public", "private"]).optional().default("all").describe("Repo visibility filter"),
  sort: z.enum(["created", "updated", "pushed", "full_name"]).optional().default("pushed").describe("Sort order"),
  per_page: z.number().optional().default(30).describe("Results per page (max 100)"),
});

const ListIssuesSchema = z.object({
  owner: z.string().describe("Repository owner (user or org)"),
  repo: z.string().describe("Repository name"),
  state: z.enum(["open", "closed", "all"]).optional().default("open").describe("Issue state"),
  per_page: z.number().optional().default(30).describe("Results per page (max 100)"),
});

const CreateIssueSchema = z.object({
  owner: z.string().describe("Repository owner (user or org)"),
  repo: z.string().describe("Repository name"),
  title: z.string().describe("Issue title"),
  body: z.string().optional().describe("Issue body (Markdown)"),
  labels: z.array(z.string()).optional().describe("Labels to apply"),
  assignees: z.array(z.string()).optional().describe("Logins to assign"),
});

const CommentIssueSchema = z.object({
  owner: z.string().describe("Repository owner (user or org)"),
  repo: z.string().describe("Repository name"),
  issue_number: z.number().describe("Issue (or PR) number"),
  body: z.string().describe("Comment body (Markdown)"),
});

const ListPrsSchema = z.object({
  owner: z.string().describe("Repository owner (user or org)"),
  repo: z.string().describe("Repository name"),
  state: z.enum(["open", "closed", "all"]).optional().default("open").describe("PR state"),
  per_page: z.number().optional().default(30).describe("Results per page (max 100)"),
});

const GetPrSchema = z.object({
  owner: z.string().describe("Repository owner (user or org)"),
  repo: z.string().describe("Repository name"),
  pull_number: z.number().describe("Pull request number"),
});

const SearchCodeSchema = z.object({
  q: z.string().describe('Search query (GitHub code-search syntax, e.g. "addClass repo:jquery/jquery")'),
  per_page: z.number().optional().default(10).describe("Results per page (max 100)"),
});

const SearchIssuesSchema = z.object({
  q: z.string().describe('Search query (GitHub issue-search syntax, e.g. "is:open is:issue author:me")'),
  per_page: z.number().optional().default(10).describe("Results per page (max 100)"),
});

const ListNotificationsSchema = z.object({
  all: z.boolean().optional().default(false).describe("Include notifications already marked read"),
  per_page: z.number().optional().default(30).describe("Results per page (max 50)"),
});

const MarkNotificationReadSchema = z.object({
  thread_id: z.string().describe("Notification thread id (from github_list_notifications)"),
});

const jsonSchema = (schema: z.ZodType): Record<string, unknown> =>
  z.toJSONSchema(schema) as Record<string, unknown>;

// ─── Tool list ───────────────────────────────────────────────────────────────

export function getGithubTools(): ConnectorTool[] {
  return [
    {
      name: "github_list_repos",
      description: "Lists repositories the authenticated user can access",
      inputSchema: jsonSchema(ListReposSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "github_list_issues",
      description: "Lists issues in a repository",
      inputSchema: jsonSchema(ListIssuesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "github_create_issue",
      description: "Creates a new issue in a repository",
      inputSchema: jsonSchema(CreateIssueSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "github_comment_issue",
      description: "Adds a comment to an issue or pull request",
      inputSchema: jsonSchema(CommentIssueSchema),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    {
      name: "github_list_prs",
      description: "Lists pull requests in a repository",
      inputSchema: jsonSchema(ListPrsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "github_get_pr",
      description: "Gets details of a pull request (state, branches, mergeability, stats)",
      inputSchema: jsonSchema(GetPrSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "github_search_code",
      description: "Searches code across GitHub with the code-search syntax",
      inputSchema: jsonSchema(SearchCodeSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "github_search_issues",
      description: "Searches issues and pull requests with the issue-search syntax",
      inputSchema: jsonSchema(SearchIssuesSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "github_list_notifications",
      description: "Lists the authenticated user's notifications",
      inputSchema: jsonSchema(ListNotificationsSchema),
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    {
      name: "github_mark_notification_read",
      description: "Marks one notification thread as read",
      inputSchema: jsonSchema(MarkNotificationReadSchema),
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
  ];
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

export async function callGithubTool(
  name: string,
  args: Record<string, unknown>,
  ctx: CallCtx,
): Promise<ToolResult> {
  const token = ctx.config.token;

  switch (name) {
    case "github_list_repos": {
      const a = ListReposSchema.parse(args);
      const res = await githubRequest(token, "GET", "/user/repos", {
        params: { visibility: a.visibility, sort: a.sort, per_page: String(a.per_page) },
      });
      const repos = (res.data as AnyRecord[]) || [];
      if (repos.length === 0) return { text: "No repositories found." };
      const list = repos
        .map(
          (r) =>
            `- ${r.full_name}${r.private ? " (private)" : ""}\n  ${r.description || "No description"}\n  Updated: ${r.updated_at} · ★${r.stargazers_count} · ${r.html_url}`,
        )
        .join("\n");
      return { text: `Found ${repos.length} repositories:\n${list}` };
    }

    case "github_list_issues": {
      const a = ListIssuesSchema.parse(args);
      const res = await githubRequest(token, "GET", `/repos/${a.owner}/${a.repo}/issues`, {
        params: { state: a.state, per_page: String(a.per_page) },
      });
      const issues = ((res.data as AnyRecord[]) || []).filter((i) => !i.pull_request);
      if (issues.length === 0) return { text: `No ${a.state} issues found in ${a.owner}/${a.repo}.` };
      const list = issues
        .map(
          (i) =>
            `- #${i.number} ${i.title} [${i.state}]\n  by ${(i.user as AnyRecord)?.login} · updated ${i.updated_at} · ${i.html_url}`,
        )
        .join("\n");
      return { text: `Found ${issues.length} issues in ${a.owner}/${a.repo}:\n${list}` };
    }

    case "github_create_issue": {
      const a = CreateIssueSchema.parse(args);
      const res = await githubRequest(token, "POST", `/repos/${a.owner}/${a.repo}/issues`, {
        body: { title: a.title, body: a.body, labels: a.labels, assignees: a.assignees },
      });
      const issue = res.data as AnyRecord;
      return {
        text: `Issue created!\nNumber: #${issue.number}\nTitle: ${issue.title}\nURL: ${issue.html_url}`,
      };
    }

    case "github_comment_issue": {
      const a = CommentIssueSchema.parse(args);
      const res = await githubRequest(
        token,
        "POST",
        `/repos/${a.owner}/${a.repo}/issues/${a.issue_number}/comments`,
        { body: { body: a.body } },
      );
      const comment = res.data as AnyRecord;
      return { text: `Comment posted on #${a.issue_number}!\nURL: ${comment.html_url}` };
    }

    case "github_list_prs": {
      const a = ListPrsSchema.parse(args);
      const res = await githubRequest(token, "GET", `/repos/${a.owner}/${a.repo}/pulls`, {
        params: { state: a.state, per_page: String(a.per_page) },
      });
      const prs = (res.data as AnyRecord[]) || [];
      if (prs.length === 0) return { text: `No ${a.state} pull requests found in ${a.owner}/${a.repo}.` };
      const list = prs
        .map(
          (p) =>
            `- #${p.number} ${p.title} [${p.state}${p.draft ? ", draft" : ""}]\n  ${(p.head as AnyRecord)?.ref} → ${(p.base as AnyRecord)?.ref} · by ${(p.user as AnyRecord)?.login} · ${p.html_url}`,
        )
        .join("\n");
      return { text: `Found ${prs.length} pull requests in ${a.owner}/${a.repo}:\n${list}` };
    }

    case "github_get_pr": {
      const a = GetPrSchema.parse(args);
      const res = await githubRequest(token, "GET", `/repos/${a.owner}/${a.repo}/pulls/${a.pull_number}`);
      const p = res.data as AnyRecord;
      return {
        text: `PR #${p.number}: ${p.title}\nState: ${p.state}${p.draft ? " (draft)" : ""}\nBranches: ${(p.head as AnyRecord)?.ref} → ${(p.base as AnyRecord)?.ref}\nAuthor: ${(p.user as AnyRecord)?.login}\nMergeable: ${p.mergeable ?? "unknown"}\nChanges: +${p.additions} −${p.deletions} in ${p.changed_files} file(s)\nURL: ${p.html_url}\n\n${p.body || "(no description)"}`,
      };
    }

    case "github_search_code": {
      const a = SearchCodeSchema.parse(args);
      const res = await githubRequest(token, "GET", "/search/code", {
        params: { q: a.q, per_page: String(a.per_page) },
      });
      const data = res.data as AnyRecord;
      const items = (data.items as AnyRecord[]) || [];
      if (items.length === 0) return { text: "No code results found." };
      const list = items
        .map((i) => `- ${(i.repository as AnyRecord)?.full_name}: ${i.path}\n  ${i.html_url}`)
        .join("\n");
      return { text: `Found ${data.total_count} code results (showing ${items.length}):\n${list}` };
    }

    case "github_search_issues": {
      const a = SearchIssuesSchema.parse(args);
      const res = await githubRequest(token, "GET", "/search/issues", {
        params: { q: a.q, per_page: String(a.per_page) },
      });
      const data = res.data as AnyRecord;
      const items = (data.items as AnyRecord[]) || [];
      if (items.length === 0) return { text: "No issue results found." };
      const list = items
        .map((i) => `- #${i.number} ${i.title} [${i.state}]\n  ${i.html_url}`)
        .join("\n");
      return { text: `Found ${data.total_count} results (showing ${items.length}):\n${list}` };
    }

    case "github_list_notifications": {
      const a = ListNotificationsSchema.parse(args);
      const res = await githubRequest(token, "GET", "/notifications", {
        params: { all: String(a.all), per_page: String(a.per_page) },
      });
      const notifications = (res.data as AnyRecord[]) || [];
      if (notifications.length === 0) return { text: "No notifications." };
      const list = notifications
        .map(
          (n) =>
            `- [${n.id}] ${(n.repository as AnyRecord)?.full_name}: ${(n.subject as AnyRecord)?.title} (${n.reason}, ${(n.subject as AnyRecord)?.type})\n  updated ${n.updated_at}${n.unread ? " · UNREAD" : ""}`,
        )
        .join("\n");
      return { text: `Found ${notifications.length} notifications:\n${list}` };
    }

    case "github_mark_notification_read": {
      const a = MarkNotificationReadSchema.parse(args);
      await githubRequest(token, "PATCH", `/notifications/threads/${a.thread_id}`, {
        // 205 Reset Content on success — allow it explicitly.
        allowStatuses: [205],
      });
      return { text: `Notification thread ${a.thread_id} marked as read` };
    }

    default:
      // Unknown tool = caller contract violation → LOUD (decision 6).
      throw new ConnectorConfigError(`unknown tool '${name}'`);
  }
}
