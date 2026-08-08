import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // QA builds and serves from its own tree so a user's live `.next` server or
  // another build cannot delete chunks underneath the Playwright webServer.
  distDir: process.env.AGENTIC_OS_NEXT_DIST_DIR ?? ".next",
  turbopack: {
    root: path.resolve(__dirname),
  },
  // node-pty is a native module; it must be require()d at runtime, not bundled.
  serverExternalPackages: ["node-pty"],
};

export default nextConfig;
