import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mpforge/linter": path.resolve("../linter/src/index.ts"),
      "@mpforge/renderer": path.resolve("../renderer/src/sha256.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
