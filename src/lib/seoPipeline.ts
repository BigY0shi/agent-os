import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readSettings } from "./settings";

export interface Site {
  id: string;
  name: string;
  url: string;
  path: string;
  postsDir: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "site";
}

// The user's SEO target sites — sourced from ~/.agentic-os/settings.json (seo.sites),
// editable in the SEO config menu. No hardcoded sites: a fresh install has none until
// the user adds their own. Read per call so edits take effect without a restart.
export function getSites(): Site[] {
  const { seo } = readSettings();
  return (seo.sites || [])
    .filter((s) => s && (s.url || s.dir))
    .map((s, i) => {
      const root = s.dir || "";
      return {
        id: slugify(s.label || s.url || `site-${i}`),
        name: s.label || s.url || `site-${i + 1}`,
        url: (s.url || "").replace(/\/+$/, ""),
        path: root,
        postsDir: s.postsDir || (root ? path.join(root, "src", "blog", "posts") : ""),
      };
    });
}

// Transcripts + the blog-post skill default to living under the first configured site's
// .claude dir (the old convention), overridable in settings, with a neutral last resort.
const _firstSitePath = (() => { try { return getSites()[0]?.path || ""; } catch { return ""; } })();
const _seo = (() => { try { return readSettings().seo; } catch { return {} as ReturnType<typeof readSettings>["seo"]; } })();
export const TRANSCRIPTS_DIR =
  _seo.transcriptsDir
  || (_firstSitePath ? path.join(_firstSitePath, ".claude", "transcripts") : path.join(os.homedir(), ".agentic-os", "seo", "transcripts"));
export const BLOG_POST_SKILL =
  _seo.skillPath
  || (_firstSitePath ? path.join(_firstSitePath, ".claude", "skills", "blog-post.md") : path.join(os.homedir(), ".agentic-os", "seo", "blog-post.md"));

export interface SiteStats {
  site: Site;
  postCount: number;
  recent: { slug: string; mtime: number; title?: string; date?: string }[];
}

async function listFilesMtime(dir: string, n = 6): Promise<{ name: string; mtime: number }[]> {
  try {
    const items = await readdir(dir);
    const mds = items.filter((f) => /\.md$/.test(f));
    const stats = await Promise.all(mds.map(async (f) => {
      try { const s = await stat(path.join(dir, f)); return { name: f, mtime: s.mtimeMs }; }
      catch { return { name: f, mtime: 0 }; }
    }));
    stats.sort((a, b) => b.mtime - a.mtime);
    return stats.slice(0, n);
  } catch { return []; }
}

async function readFrontMatter(file: string): Promise<{ title?: string; date?: string }> {
  try {
    const data = await readFile(file, "utf8");
    const m = data.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!m) return {};
    const fm = m[1];
    const titleMatch = fm.match(/^title:\s*["']?([^"'\n]+)["']?\s*$/m);
    const dateMatch = fm.match(/^date:\s*["']?([^"'\n]+)["']?\s*$/m);
    return {
      title: titleMatch ? titleMatch[1].trim() : undefined,
      date: dateMatch ? dateMatch[1].trim() : undefined,
    };
  } catch { return {}; }
}

export async function getSiteStats(site: Site): Promise<SiteStats> {
  const recent = await listFilesMtime(site.postsDir, 6);
  let postCount = 0;
  try { postCount = (await readdir(site.postsDir)).filter((f) => /\.md$/.test(f)).length; }
  catch {}
  const enriched = await Promise.all(recent.map(async (r) => {
    const fm = await readFrontMatter(path.join(site.postsDir, r.name));
    return { slug: r.name.replace(/\.md$/, ""), mtime: r.mtime, ...fm };
  }));
  return { site, postCount, recent: enriched };
}

export async function getAllSiteStats(): Promise<SiteStats[]> {
  return Promise.all(getSites().map(getSiteStats));
}

export interface TranscriptMeta { slug: string; bytes: number; mtime: number; preview: string; }

export async function listTranscripts(): Promise<TranscriptMeta[]> {
  try {
    const items = await readdir(TRANSCRIPTS_DIR);
    const txts = items.filter((f) => /\.txt$/.test(f));
    const out: TranscriptMeta[] = [];
    for (const t of txts) {
      const full = path.join(TRANSCRIPTS_DIR, t);
      try {
        const s = await stat(full);
        const head = (await readFile(full, "utf8")).slice(0, 220).replace(/\s+/g, " ").trim();
        out.push({ slug: t.replace(/\.txt$/, ""), bytes: s.size, mtime: s.mtimeMs, preview: head });
      } catch {}
    }
    out.sort((a, b) => b.mtime - a.mtime);
    return out;
  } catch { return []; }
}

export async function readTranscript(slug: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return null;
  const file = path.join(TRANSCRIPTS_DIR, `${slug}.txt`);
  try { return await readFile(file, "utf8"); }
  catch { return null; }
}
