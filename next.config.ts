import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // When NEXT_DEV_DIST_DIR=1 (dev servers started by tooling), use a separate
  // build directory so a dev server never collides with the production
  // server's `.next` on the same checkout.
  ...(process.env.NEXT_DEV_DIST_DIR === "1" ? { distDir: ".next-dev" } : {}),
};

export default nextConfig;
