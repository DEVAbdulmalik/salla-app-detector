import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages are consumed as TypeScript source, with no build step between them.
  transpilePackages: [
    "@salla-app-detector/engine",
    "@salla-app-detector/jobs",
    "@salla-app-detector/knowledge",
    "@salla-app-detector/salla",
    "@salla-app-detector/shared",
  ],
  // Next writes assistant instruction files into the project unless this is off.
  agentRules: false,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
