import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@wemd/core": path.resolve("../core/src/index.ts"),
      "@mpforge/themes": path.resolve("../themes/src/index.ts"),
      "markdown-it/lib/token": path.resolve("../../node_modules/.pnpm/markdown-it@14.1.0/node_modules/markdown-it/lib/token.mjs"),
      "markdown-it/lib/renderer": path.resolve("../../node_modules/.pnpm/markdown-it@14.1.0/node_modules/markdown-it/lib/renderer.mjs"),
      "markdown-it/lib/rules_core/state_core": path.resolve("../../node_modules/.pnpm/markdown-it@14.1.0/node_modules/markdown-it/lib/rules_core/state_core.mjs"),
      "markdown-it/lib/rules_block/state_block": path.resolve("../../node_modules/.pnpm/markdown-it@14.1.0/node_modules/markdown-it/lib/rules_block/state_block.mjs"),
      "markdown-it/lib/rules_inline/state_inline": path.resolve("../../node_modules/.pnpm/markdown-it@14.1.0/node_modules/markdown-it/lib/rules_inline/state_inline.mjs"),
    },
  },
  test: { include: ["src/**/*.test.ts"] },
});
