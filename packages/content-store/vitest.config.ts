import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mpforge/content-schema": path.resolve(
        here,
        "../content-schema/src/index.ts",
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
