import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import fs from "fs";

// Read package.json explicitly to avoid ESM require issues
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf-8"),
);

export default defineConfig(({ mode }) => ({
  base: "./",
  resolve: {
    alias: {
      "@wemd/core": path.resolve(__dirname, "../../packages/core/src/index.ts"),
      "@mpforge/themes": path.resolve(
        __dirname,
        "../../packages/themes/src/index.ts",
      ),
      "@mpforge/renderer": path.resolve(
        __dirname,
        "../../packages/renderer/src/index.ts",
      ),
      "@mpforge/linter": path.resolve(
        __dirname,
        "../../packages/linter/src/index.ts",
      ),
      "@mpforge/content-schema": path.resolve(
        __dirname,
        "../../packages/content-schema/src/index.ts",
      ),
      "@mpforge/review-gate": path.resolve(
        __dirname,
        "../../packages/review-gate/src/index.ts",
      ),
    },
  },
  plugins: [
    react(),
    VitePWA({
      // 新版本 SW 安装后自动接管，用户文档在本地存储，刷新无数据损失
      registerType: "autoUpdate",
      // 生成独立 registerSW.js，由 index.html 延迟加载，无额外运行时依赖
      injectRegister: "script-defer",
      includeAssets: [
        "favicon-dark.png",
        "favicon-dark.svg",
        "favicon-light.svg",
        "pwa/icon-192.png",
        "pwa/icon-512.png",
        "pwa/icon-maskable-512.png",
      ],
      manifest: {
        name: "MPForge - Content-as-Code for WeChat",
        short_name: "MPForge",
        description:
          "Git 驱动、Agent 友好的微信公众号内容审校、排版、预览和可审计草稿工作台。基于 WeMD 构建。",
        lang: "zh-CN",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f9f9f9",
        theme_color: "#f9f9f9",
        icons: [
          { src: "pwa/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // 本地打包的字体（woff2）与 MathJax 一起预缓存，保证离线写作与公式链路
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff2,webmanifest}"],
        // tex-svg.js 为 2.11 MB，超过默认 2 MiB 上限；公式图片化是复制链路核心，必须离线可用
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: "index.html",
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __MPFORGE_DEMO_MODE__: JSON.stringify(
      mode === "demo" || process.env.MPFORGE_DEMO_MODE === "true",
    ),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom"],
          codemirror: [
            "codemirror",
            "@codemirror/lang-markdown",
            "@codemirror/language",
            "@codemirror/state",
            "@codemirror/view",
            "@uiw/codemirror-theme-github",
          ],
        },
      },
    },
  },
}));
