import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // node-pty is a NATIVE module (.node binary). The bundler must not try to trace
  // or inline it — leave it as a plain runtime require, or the terminal route dies
  // with "Cannot find module ...pty.node" in the production build.
  // "ws" ships optional native accelerators (bufferutil/utf-8-validate) that a
  // bundler trace trips over, and "playwright" must resolve its own browser
  // registry at runtime — both stay plain runtime requires (SPEC-E E2.2/E1).
  serverExternalPackages: ["node-pty", "better-sqlite3", "sqlite-vec", "ws", "playwright"],
};

export default nextConfig;
