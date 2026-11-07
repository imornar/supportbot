import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "./src"),
      "server-only": path.resolve(root, "./tests/server-only-stub.ts"),
    },
  },
});
