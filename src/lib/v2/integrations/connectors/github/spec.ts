import type { ConnectorSpec } from "../../types";

/**
 * SPEC-D G3.4 — GitHub connector spec. PAT api-key auth per §3.3
 * (`fields:[{key:'token'}]` — our Param shape names it `name`); no upstream
 * verbatim port (§4: pattern-only, lean REST v3 fetch tools). Sync =
 * notifications + assigned-issues poll every 30 min with an
 * If-Modified-Since / updated-cursor watermark.
 */
export const githubSpec: ConnectorSpec = {
  name: "GitHub",
  slug: "github",
  description:
    "Connect your workspace to GitHub. Browse repos, manage issues and pull requests, and track notifications",
  icon: "github",
  category: "developer",
  auth: {
    apiKey: {
      fields: [
        {
          name: "token",
          label: "Personal access token",
          placeholder: "ghp_… or github_pat_…",
          description:
            "Fine-grained or classic PAT. Needs repo + notifications scopes (classic) or the equivalent fine-grained permissions for the repos you care about.",
        },
      ],
    },
  },
  schedule: { frequency: "*/30 * * * *" }, // §3.3: notifications + assigned-issues poll (30 min)
  triggers: [
    { key: "GITHUB_NOTIFICATION", label: "New notification" },
    { key: "GITHUB_ISSUE_ASSIGNED", label: "Issue assigned or updated" },
  ],
  uiHint:
    "Create the PAT at github.com → Settings → Developer settings. The token is validated against " +
    "GET /user on connect; the account shows up under your GitHub login.",
};
