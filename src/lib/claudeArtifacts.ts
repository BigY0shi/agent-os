// Artifacts — publish anything your agents built to a shareable public link.
// (Agent OS's take on Claude Code "Artifacts": turn a build into a page you can
// share at a link.) Publishing deploys to a DEDICATED Netlify site so it never
// touches the guides / SEO sites.

import { readFile, writeFile, mkdir, readdir, stat, rename } from "node:fs/promises";
import { exileFile } from "@/lib/exileFile";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { augmentPath, POSIX_TOOL_DIRS, resolveCli } from "@/lib/platform";
import { readSettings } from "@/lib/settings";

const HOME = os.homedir();
export const PUBLISHED_DIR = path.join(HOME, ".agentic-os", "published");
const MANIFEST = path.join(PUBLISHED_DIR, "manifest.json");
const LOOP_BUILDS = path.join(HOME, ".agentic-os", "loop-builds");
const CLAUDE_PROJECTS = path.join(HOME, ".agentic-os", "claude-projects");

// netlify CLI needs a real PATH when the dev server was launched detached.
// Platform-correct PATH extension — the old ":"-join corrupted Windows' ";"-delimited PATH.
// Read per deploy, not at import, so the CLI is looked up on the PATH of the moment.
const deployPath = () => augmentPath(POSIX_TOOL_DIRS);

// BACK-COMPAT FALLBACK ONLY. The site used to live in this file; since 2026-10-01 it is
// `settings.artifacts`, set from the gear on the Artifacts tab (rule 16). The file is read
// when that siteId is blank and is never written by the app.
export const LEGACY_SITE_FILE = path.join(HOME, ".agentic-os", "artifacts-site.json");

export const SITE_MISSING = "Artifacts site not configured: open Configure (the gear) on the Artifacts tab and enter the Netlify site ID and base URL.";
export const SITE_URL_MISSING = "Artifacts site has no base URL: open Configure (the gear) on the Artifacts tab and enter the site's https address.";
export const NETLIFY_INSTALL_HINT = 'Install it with "npm install -g netlify-cli", then run "netlify login" once in your own terminal.';

export interface ArtifactSite { siteId: string; name: string; baseUrl: string; source: "settings" | "file" }
function normalizeSite(raw: unknown, source: ArtifactSite["source"]): ArtifactSite | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const siteId = String(r.siteId ?? "").trim();
  if (!siteId) return null;
  const baseUrl = String(r.baseUrl ?? "").trim().replace(/\/+$/, "");
  return { siteId, name: String(r.name ?? "").trim() || siteId, baseUrl, source };
}
/** The site publishes go to: settings.artifacts first, the legacy file only when that is blank. */
export function artifactSite(): ArtifactSite | null {
  const fromSettings = normalizeSite(readSettings().artifacts, "settings");
  if (fromSettings) return fromSettings;
  try { return normalizeSite(JSON.parse(readFileSync(LEGACY_SITE_FILE, "utf8")), "file"); } catch { return null; }
}

export interface PublishedItem { slug: string; title: string; source: string; url: string; publishedAt: number; bytes: number }
export interface Publishable { id: string; title: string; source: string; path: string; mtime: number; bytes: number }

function titleFromHtml(html: string, fallback: string): string {
  const t = /<title>([^<]+)<\/title>/i.exec(html)?.[1]?.trim();
  if (t) return t.slice(0, 70);
  return fallback.replace(/[-_]/g, " ").replace(/\.html$/, "").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 70);
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "artifact";
}

async function readManifest(): Promise<PublishedItem[]> {
  try { return JSON.parse(await readFile(MANIFEST, "utf8")); } catch { return []; }
}
async function writeManifest(items: PublishedItem[]): Promise<void> {
  await mkdir(PUBLISHED_DIR, { recursive: true });
  await writeFile(MANIFEST, JSON.stringify(items, null, 2), "utf8");
}
export async function listPublished(): Promise<PublishedItem[]> {
  return (await readManifest()).sort((a, b) => b.publishedAt - a.publishedAt);
}

// Everything the agents built that CAN be published (HTML). Sources: Loop builds + Claude workspace.
export async function listPublishable(): Promise<Publishable[]> {
  const out: Publishable[] = [];
  // Loop builds (flat dir of .html)
  if (existsSync(LOOP_BUILDS)) {
    for (const f of await readdir(LOOP_BUILDS)) {
      if (!f.endsWith(".html")) continue;
      const p = path.join(LOOP_BUILDS, f);
      const st = await stat(p).catch(() => null); if (!st?.isFile()) continue;
      let head = ""; try { head = (await readFile(p, "utf8")).slice(0, 4000); } catch {}
      out.push({ id: `loop:${f}`, title: titleFromHtml(head, f), source: "Loop build", path: p, mtime: st.mtimeMs, bytes: st.size });
    }
  }
  // Claude workspace projects (recursive, shallow)
  if (existsSync(CLAUDE_PROJECTS)) {
    async function walk(dir: string, rel: string, project: string, depth: number) {
      if (depth > 4) return;
      let items; try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const it of items) {
        if (it.name === "node_modules" || it.name.startsWith(".")) continue;
        const full = path.join(dir, it.name); const r = rel ? `${rel}/${it.name}` : it.name;
        if (it.isDirectory()) await walk(full, r, project, depth + 1);
        else if (/\.html?$/i.test(it.name)) {
          const st = await stat(full).catch(() => null); if (!st) continue;
          let head = ""; try { head = (await readFile(full, "utf8")).slice(0, 4000); } catch {}
          out.push({ id: `claude:${project}/${r}`, title: titleFromHtml(head, it.name), source: `Claude · ${project}`, path: full, mtime: st.mtimeMs, bytes: st.size });
        }
      }
    }
    for (const proj of await readdir(CLAUDE_PROJECTS, { withFileTypes: true }).catch(() => [])) {
      if (proj.isDirectory()) await walk(path.join(CLAUDE_PROJECTS, proj.name), "", proj.name, 0);
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Resolve a publishable id back to an absolute path (containment-checked).
function resolveSource(id: string): string | null {
  if (id.startsWith("loop:")) {
    const f = id.slice(5);
    if (!/^[A-Za-z0-9_.-]+\.html$/.test(f)) return null;
    const p = path.resolve(LOOP_BUILDS, f);
    return p.startsWith(LOOP_BUILDS + path.sep) && existsSync(p) ? p : null;
  }
  if (id.startsWith("claude:")) {
    const rel = id.slice(7);
    const p = path.resolve(CLAUDE_PROJECTS, rel);
    return p.startsWith(CLAUDE_PROJECTS + path.sep) && existsSync(p) ? p : null;
  }
  return null;
}

function galleryHtml(items: PublishedItem[]): string {
  const cards = items.map((i) => `    <a class="card" href="/${i.slug}/"><div class="t">${i.title.replace(/</g, "&lt;")}</div><div class="m">${new Date(i.publishedAt).toISOString().slice(0, 10)}</div></a>`).join("\n");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Agent OS · Shared Artifacts</title>
<style>
  body{margin:0;background:#15101a;color:#f3ebda;font-family:'Manrope',system-ui,sans-serif;padding:48px 24px;}
  .wrap{max-width:880px;margin:0 auto;}
  h1{font-family:'Bricolage Grotesque',sans-serif;font-weight:500;font-size:2.2rem;margin:0 0 6px;}
  p.sub{color:#a59783;margin:0 0 32px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;}
  .card{display:block;background:#251d2c;border:1px solid rgba(243,235,218,.08);border-radius:14px;padding:18px 20px;text-decoration:none;color:inherit;transition:transform .15s,border-color .15s;}
  .card:hover{transform:translateY(-2px);border-color:#d4a574;}
  .card .t{font-family:'Bricolage Grotesque',sans-serif;font-weight:600;font-size:1.05rem;color:#f3ebda;}
  .card .m{font-family:monospace;font-size:.74rem;color:#a59783;margin-top:6px;}
</style></head><body><div class="wrap">
  <h1>Shared Artifacts</h1>
  <p class="sub">Built with Agent OS · ${items.length} published</p>
  <div class="grid">
${cards || '<p style="color:#6e6353">Nothing published yet.</p>'}
  </div>
</div></body></html>`;
}

function deploy(): Promise<{ ok: boolean; log: string }> {
  const site = artifactSite();
  return new Promise((resolve) => {
    if (!site) return resolve({ ok: false, log: SITE_MISSING });
    // On Windows the npm-installed netlify CLI is a .cmd shim, which spawn() cannot run
    // without a shell (ENOENT, so no publish ever reached Netlify from this machine).
    // resolveCli turns it into `node <netlify entry>` with a clean arg array, or says
    // exactly what is missing; the args are never joined into a shell string.
    const PATH = deployPath();
    const cli = resolveCli("netlify", PATH);
    if ("error" in cli) return resolve({ ok: false, log: `netlify CLI not found (${cli.error}). ${NETLIFY_INSTALL_HINT}` });
    const args = [...cli.pre, "deploy", "--prod", "--dir", PUBLISHED_DIR, "--site", site.siteId, "--no-build"];
    const child = spawn(cli.cmd, args,
      { env: { ...process.env, PATH, NO_COLOR: "1", CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let log = `$ ${cli.found} ${args.slice(cli.pre.length).join(" ")}\n`;
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve({ ok: false, log: log + "\n[deploy timeout]" }); }, 180_000);
    child.stdout.on("data", (d) => { log += String(d); });
    child.stderr.on("data", (d) => { log += String(d); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, log: log.slice(-1200) }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, log: String(e) }); });
  });
}

// Publish a source artifact (by id) → returns the public URL.
export async function publish(id: string, customTitle?: string): Promise<{ ok: boolean; item?: PublishedItem; error?: string }> {
  const site = artifactSite();
  if (!site) return { ok: false, error: SITE_MISSING };
  if (!/^https?:\/\//i.test(site.baseUrl)) return { ok: false, error: SITE_URL_MISSING };
  const src = resolveSource(id);
  if (!src) return { ok: false, error: "source not found" };
  const html = await readFile(src, "utf8").catch(() => null);
  if (!html) return { ok: false, error: "could not read source" };

  const title = (customTitle || titleFromHtml(html, path.basename(src))).slice(0, 70);
  const items = await readManifest();
  // stable slug from title; if it collides with a DIFFERENT source, suffix it
  let slug = slugify(title);
  const existing = items.find((i) => i.slug === slug);
  if (existing && existing.source !== id) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const dir = path.join(PUBLISHED_DIR, slug);
  const pagePath = path.join(dir, "index.html");
  // What was live for this slug before (an update re-publishes the same slug), so a failed
  // deploy can put it back instead of leaving the new copy queued for the next deploy.
  const prevHtml = await readFile(pagePath, "utf8").catch(() => null);
  await mkdir(dir, { recursive: true });
  await writeFile(pagePath, html, "utf8");

  const item: PublishedItem = { slug, title, source: id, url: `${site.baseUrl}/${slug}/`, publishedAt: Date.now(), bytes: Buffer.byteLength(html) };
  const next = [item, ...items.filter((i) => i.slug !== slug)];
  await writeFile(path.join(PUBLISHED_DIR, "index.html"), galleryHtml(next), "utf8");
  await writeManifest(next);

  const d = await deploy();
  if (!d.ok) {
    // Nothing went live, so nothing may say it did: put the gallery and manifest back, and
    // either restore the slug's previous page or move the new copy out of the published
    // folder (exiled beside it, never deleted) so the next deploy cannot ship it unseen.
    await writeFile(path.join(PUBLISHED_DIR, "index.html"), galleryHtml(items), "utf8");
    await writeManifest(items);
    if (prevHtml !== null) await writeFile(pagePath, prevHtml, "utf8");
    else await exileFile(dir, path.dirname(PUBLISHED_DIR)).catch(() => null);
    return { ok: false, error: `Deploy failed, so nothing was published: ${d.log.slice(-300)}` };
  }
  return { ok: true, item };
}

export async function unpublish(slug: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^(?!\.)[A-Za-z0-9_.-]+$/.test(slug)) return { ok: false, error: "bad slug" };
  if (!artifactSite()) return { ok: false, error: SITE_MISSING };
  const all = await readManifest();
  const items = all.filter((i) => i.slug !== slug);
  // Exiled, never deleted, and OUTSIDE the published folder (that whole folder is deployed,
  // so an .exile inside it would go public): ~/.agentic-os/.exile/<stamp>/published/<slug>.
  const dir = path.join(PUBLISHED_DIR, slug);
  const moved = await exileFile(dir, path.dirname(PUBLISHED_DIR)).catch(() => null);
  await writeFile(path.join(PUBLISHED_DIR, "index.html"), galleryHtml(items), "utf8");
  await writeManifest(items);
  const d = await deploy();
  if (d.ok) return { ok: true };
  // The page is still live, so put it back where it was and keep listing it.
  if (moved) await rename(moved, dir).catch(() => {});
  await writeFile(path.join(PUBLISHED_DIR, "index.html"), galleryHtml(all), "utf8");
  await writeManifest(all);
  return { ok: false, error: `Unpublish deploy failed, so it is still live: ${d.log.slice(-200)}` };
}
