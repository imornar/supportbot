import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the repository AGENTS.md. Next's generator would replace it on dev.
  agentRules: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
