import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  agentRules: false,
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
