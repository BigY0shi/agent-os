// Guard for the glass positioning bug (2026-09-29), offline.
// Tailwind v4 puts utilities in a cascade layer; unlayered CSS beats every layer. The
// `.glass*` rule used to set `position: relative` UNLAYERED, so any glass element that
// also used `absolute`, `fixed` or `sticky` was silently made relative (the Voice dial
// piled up, the Agent City hover card fell out of place, the Archive reader and the
// Mastermind rail stopped sticking). The position must live in a layer below utilities.
// Run: npx tsx scripts/v2/smoke-glass-layer.mjs
import fs from "node:fs";

let failures = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failures++; };
const css = fs.readFileSync("src/app/globals.css", "utf8");
const layered = /@layer components \{\s*\.glass, \.glass-strong, \.glass-frost, \.glass-inset \{ position: relative; \}\s*\}/.test(css);
check("G1 the glass position sits in the components layer", layered);
// Any unlayered rule that targets a glass class must not set position.
const unlayered = css.replace(/@layer[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
const glassRules = [...unlayered.matchAll(/([^{}]*\.glass(?:-strong|-frost|-inset)?\b[^{}]*)\{([^{}]*)\}/g)];
const offenders = glassRules.filter(([, sel, body]) => !/::(after|before)/.test(sel) && /(^|;|\s)position\s*:/.test(body)).map(([, sel]) => sel.trim());
check("G2 no unlayered glass rule sets position", offenders.length === 0);
if (offenders.length) console.log("      offenders:", offenders.join(" | "));
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
