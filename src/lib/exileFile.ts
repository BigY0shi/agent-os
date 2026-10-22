import { mkdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** A folder-safe timestamp for one exile batch, e.g. 2026-09-29_18-46-32. */
export function exileStamp(d = new Date()): string {
  return d.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
}

/**
 * House rule: nothing is hard-deleted. Moves `file` into `<root>/.exile/<stamp>/`,
 * keeping its path relative to `root`, so a "delete" in the UI is always recoverable.
 * Returns the new path, or null when the file was not there. Throws when `file` is not
 * inside `root` (a caller bug, never something to paper over).
 */
export async function exileFile(file: string, root: string, stamp: string = exileStamp()): Promise<string | null> {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`exileFile: ${file} is not inside ${root}`);
  }
  if (!existsSync(file)) return null;
  const dest = path.join(root, ".exile", stamp, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await rename(file, dest);
  return dest;
}
