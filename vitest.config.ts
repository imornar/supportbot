import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  ssr: {
    // Auth.js imports `next/server` without a file extension. Vite must bundle
    // that import so the test runner can resolve Next's package entry.
    noExternal: ["next-auth"],
  },
  test: {
    environment: "node",
    exclude: ["e2e/**", "**/node_modules/**", "**/.git/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "server-only": path.resolve(root, "./tests/server-only-stub.ts"),
    },
  },
});
