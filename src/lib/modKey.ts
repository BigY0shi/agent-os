// The platform's command modifier, for keyboard HINTS only.
//
// The shortcut HANDLERS were already right: CommandPalette checks
// `(e.metaKey || e.ctrlKey)`, so Ctrl+K has always worked here. Only the labels
// were wrong - 25 of them hardcoded the macOS glyph on an app whose host is
// Windows, telling the owner to press a key his keyboard does not have.
//
// Resolved once, synchronously, at module load rather than through a hook. On
// the server there is no `navigator`, so it is "Ctrl" - which is also the right
// answer on the Windows host, so the value never changes between render passes
// and hydration always matches. A viewer opening the LAN address from a Mac
// gets the glyph on the client and one hydration warning for the swapped label.
//
// That trade is deliberate: a hook would be strictly more correct for the Mac
// case, but it would mean adding a hook call to 22 components, several of which
// use these labels inside nested render helpers where a hook cannot go. Wrong
// modifier on the machine that actually runs this beat a rules-of-hooks hazard.
export const MOD: "\u2318" | "Ctrl" =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent)
    ? "\u2318"
    : "Ctrl";
