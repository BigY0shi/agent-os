// S29 Guide (_design/jarvis-v3-plan.md): the in-app wiki. Its source of truth is the repo's
// own markdown, the same files GitHub shows:
//   docs/guide/{start-here,around-every-page,how-it-works}.md   the general sections
//   docs/modules/<slug>.md                                       one per module, written from the code
// Read at request time, so a doc edit shows on the next visit with no rebuild.
// AGENTIC_OS_DOCS_DIR points it elsewhere for smokes.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface GuideDoc { slug: string; title: string; route: string | null; intro: string; body: string; words: number }

export function docsDir(): string {
  return process.env.AGENTIC_OS_DOCS_DIR || path.join(process.cwd(), "docs");
}

export function parseDoc(slug: string, md: string): GuideDoc {
  const text = md.replace(/\r\n/g, "\n");
  const title = /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? slug;
  const route = /^Route:\s*`([^`]+)`/m.exec(text)?.[1] ?? null;
  const body = text.replace(/^#\s+.+\n?/, "").trim();
  const intro = body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith("Route:") && !p.startsWith("#") && !p.startsWith("|")) ?? "";
  return { slug, title, route, intro: intro.replace(/\s+/g, " ").slice(0, 280), body, words: (body.match(/\S+/g) ?? []).length };
}

const GENERAL_ORDER = ["start-here", "around-every-page", "how-it-works"];

export function loadGuide(): { general: GuideDoc[]; modules: GuideDoc[] } {
  const read = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md") : []);
  const g = path.join(docsDir(), "guide"), m = path.join(docsDir(), "modules");
  const general = read(g).map((f) => parseDoc(f.slice(0, -3), readFileSync(path.join(g, f), "utf8")))
    .sort((a, b) => GENERAL_ORDER.indexOf(a.slug) - GENERAL_ORDER.indexOf(b.slug));
  const modules = read(m).map((f) => parseDoc(f.slice(0, -3), readFileSync(path.join(m, f), "utf8")))
    .sort((a, b) => (a.route === "/" ? -1 : b.route === "/" ? 1 : a.title.localeCompare(b.title)));
  return { general, modules };
}
