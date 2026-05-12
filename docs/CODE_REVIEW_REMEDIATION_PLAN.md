# Code review remediation plan

**Status:** Implemented in-repo (see git history). Original review items below.

This document tracks remediation for the Agent OS security and reliability review.

## 1. RBAC on all control-plane APIs (Critical)

**Issue:** Only memory, pipeline, and audit routes enforced `AGENT_OS_API_KEYS`. Other mutating routes stayed open when keys were configured.

**Remediation:**

- Add `authorizeRead(request, minRole, options?)` and `authorizeWrite(request, minRole)` in [`lib/authz.js`](../lib/authz.js).
- **Read (GET):** When keys are **not** configured → treat as `admin` (local dev). When keys **are** configured → valid token must map to a role ≥ `minRole`, **unless** anonymous browser reads are allowed: unauthenticated callers receive **viewer** (so the dashboard keeps working). Set `AGENT_OS_REQUIRE_API_KEY_FOR_READ=true` to require a key for every GET.
- **Write (POST/PUT/PATCH/DELETE):** When keys configured → require valid token with role ≥ `operator` (default). When keys not configured → `admin`.

**Apply to:** `agents`, `alerts`, `analytics`, `costs`, `content`, `dashboard`, `decisions`, `outputs`, `reports`, `sections`, `skills` (incl. tools/mcp sub-resources), `tasks`, `tools`, `mcp-servers`.

## 2. Next.js dependency (Critical)

**Issue:** `next@14.2.3` has known vulnerabilities.

**Remediation:** Pin `next` to patched **14.2.35** (or newer patched 14.2.x) in `package.json` and refresh lockfile.

## 3. MCP secret exposure (High)

**Issue:** `env` / `args` returned verbatim from MCP APIs.

**Remediation:**

- [`lib/mcpRedact.js`](../lib/mcpRedact.js) — `sanitizeMcpServer(row, includeSecrets)`.
- Default GET responses redact `env` and `args` to `[REDACTED]`.
- Full payload only when caller is **operator** or **admin** **and** `?include_secrets=1` is present.

## 4. Memory confidentiality (High)

**Issue:** Viewers could list/read confidential rows; `agent-runtime` could set `status` via PUT and bypass tombstone-only delete.

**Remediation:**

- Filter `sensitivity = 'confidential'` for roles below **operator** in list/retrieve/single GET (404 on single GET to avoid existence leak).
- On PUT: **operator+** may change `status` / `sensitivity`; **agent-runtime** cannot change `status` (always keep existing unless operator).

## 5. Pi deploy build deps (High)

**Issue:** `npm ci --production` / `npm install --production` before `next build` omits Tailwind/PostCSS.

**Remediation:** Full install → build → `npm prune --omit=dev` (optional). Document `AGENT_OS_API_KEYS` in systemd drop-in / env file.

## 6. Modal wiring (High)

**Issue:** `<Modal>` used without required `isOpen` prop (`components/Modal.jsx`).

**Remediation:** Pass `isOpen={showModal}` / `isOpen={showApprovalModal}` on pipeline and content pages.

## 7. Alert dismissal API (Medium)

**Issue:** Dashboard called `DELETE /api/alerts/:id` but route only exposed PUT.

**Remediation:** Add [`app/api/alerts/[id]/route.js`](../app/api/alerts/[id]/route.js) with `DELETE` (and auth).

## 8. SQLite / sql.js concurrency (Medium)

**Issue:** In-memory DB + whole-file rewrite is unsafe for multi-process or multi-instance deployments.

**Remediation:** Document in [`lib/db.js`](../lib/db.js) header and link here; production multi-instance should use external DB (future work).

## 9. ESLint (Medium)

**Issue:** `next lint` prompted for interactive setup.

**Remediation:** Add minimal `.eslintrc.json` extending `next/core-web-vitals`.

---

## Verification

- `npm ci` && `npm run build`
- `npm audit` (expect Next issue cleared or reduced)
- With `AGENT_OS_API_KEYS` set: unauthenticated GET still works for dashboard reads (unless `AGENT_OS_REQUIRE_API_KEY_FOR_READ=true`); unauthenticated POST returns 401.
- MCP GET without `include_secrets=1`: no raw `env`/`args`.
- Memory: confidential rows hidden for viewer; PUT cannot flip `status` as `agent-runtime`.
