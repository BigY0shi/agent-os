// Which configured SEO site a file belongs to, from the site's repo path (settings.seo.sites[].dir).
// Client-safe (no node: imports) so SEOView can call it while a generation streams.
// Slashes are normalised; drive-letter paths compare case-insensitively; the longest
// matching root wins when one site's repo sits inside another's.

const norm = (p: string) => p.split(String.fromCharCode(92)).join("/").replace(/\/+$/, "");

export function siteIdForFile(filePath: string, sites: { id: string; path: string }[]): string | null {
  const f = norm(filePath || "");
  if (!f) return null;
  let best: { id: string; len: number } | null = null;
  for (const s of sites) {
    const root = norm(s.path || "");
    if (!root) continue;
    const win = /^[A-Za-z]:\//.test(root);
    const hit = win ? f.toLowerCase().startsWith(root.toLowerCase() + "/") : f.startsWith(root + "/");
    if (hit && (!best || root.length > best.len)) best = { id: s.id, len: root.length };
  }
  return best?.id ?? null;
}
