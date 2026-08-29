import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // node-pty is a NATIVE module (.node binary). The bundler must not try to trace
  // or inline it — leave it as a plain runtime require, or the terminal route dies
  // with "Cannot find module ...pty.node" in the production build.
  serverExternalPackages: ["node-pty", "better-sqlite3", "sqlite-vec"],
};

export default nextConfig;
