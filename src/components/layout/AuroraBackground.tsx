"use client";

import { motion } from "framer-motion";

/**
 * Ambient backdrop — calm, cool, cinematic. Two slow-drifting accent glows
 * (teal top-right, neon-green bottom-left), a deep focus vignette, a faint
 * HUD grid, and a thin top accent hairline. Pure CSS / motion; sits at -z-10.
 */
export function AuroraBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      {/* faint hud grid, masked to fade toward the edges */}
      <div
        className="absolute inset-0 bg-hud-grid opacity-[0.22]"
        style={{ maskImage: "radial-gradient(120% 90% at 50% 35%, #000 0%, transparent 78%)", WebkitMaskImage: "radial-gradient(120% 90% at 50% 35%, #000 0%, transparent 78%)" }}
      />

      {/* drifting cool glow — top right (teal/blue) */}
      <motion.div
        className="absolute -top-1/4 right-[-10%] h-[90vmin] w-[90vmin] rounded-full blur-3xl"
        style={{
          background: "radial-gradient(circle, rgba(43,182,255,0.16) 0%, rgba(43,182,255,0.05) 40%, transparent 65%)",
          mixBlendMode: "screen",
        }}
        animate={{ x: [0, -28, 0], y: [0, 22, 0] }}
        transition={{ repeat: Infinity, duration: 26, ease: "easeInOut" }}
      />

      {/* drifting accent glow — bottom left (neon green) */}
      <motion.div
        className="absolute -bottom-1/3 -left-[12%] h-[85vmin] w-[85vmin] rounded-full blur-3xl"
        style={{
          background: "radial-gradient(circle, rgba(111,255,155,0.14) 0%, rgba(111,255,155,0.04) 42%, transparent 66%)",
          mixBlendMode: "screen",
        }}
        animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
        transition={{ repeat: Infinity, duration: 32, ease: "easeInOut" }}
      />

      {/* faint deep-violet richness, far bottom-center */}
      <div
        className="absolute bottom-[-30%] left-1/2 h-[70vmin] w-[110vmin] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, rgba(108,75,255,0.10) 0%, transparent 60%)", mixBlendMode: "screen" }}
      />

      {/* deep focus vignette */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(85% 70% at 50% 38%, transparent 0%, rgba(2,4,8,0.55) 92%)" }}
      />

      {/* thin top accent hairline */}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(111,255,155,0.35), rgba(43,182,255,0.25), transparent)" }}
      />
    </div>
  );
}
