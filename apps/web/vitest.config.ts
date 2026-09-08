/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  define: {
    __MPFORGE_DEMO_MODE__: false,
  },
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@mpforge/content-schema": path.resolve(
        __dirname,
        "../../packages/content-schema/src/index.ts",
      ),
      "@mpforge/linter": path.resolve(
        __dirname,
        "../../packages/linter/src/index.ts",
      ),
      "@mpforge/renderer": path.resolve(
        __dirname,
        "../../packages/renderer/src/index.ts",
      ),
      "@mpforge/review-gate": path.resolve(
        __dirname,
        "../../packages/review-gate/src/index.ts",
      ),
      "@mpforge/themes": path.resolve(
        __dirname,
        "../../packages/themes/src/index.ts",
      ),
      "@wemd/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
    },
  },
});
