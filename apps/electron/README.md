# MPForge Desktop

`apps/electron` 是 MPForge 桌面端外壳，继承并升级 WeMD 的 Electron 基础，复用 Web 端构建产物，并提供窗口、菜单、文件系统、剪贴板、工作区监听和可选更新检查等桌面能力。

## 目录结构

```
apps/electron/
├── src/
│   ├── main.ts          # 主进程入口
│   ├── window.ts        # 窗口创建与加载策略
│   ├── menu.ts          # 桌面菜单
│   ├── preload.ts       # 暴露给渲染进程的安全 API
│   ├── updater.ts       # 更新检查
│   ├── ipc/             # IPC 注册与职责拆分
│   ├── watch/           # 工作区递归监听
│   ├── workspace/       # 工作区状态与文件列表逻辑
│   └── utils/           # 桌面端工具函数
├── assets/              # 应用图标等打包资源
├── electron-builder.json
└── package.json
```

## 常用命令

推荐从仓库根目录运行：

```bash
pnpm dev:desktop
pnpm --filter mpforge-desktop test
pnpm --filter mpforge-desktop build
```

首次运行桌面 `dev` 或 `start` 时会自动准备项目固定版本的 Electron。下载缓存和临时文件保存在仓库内 `.cache/electron` 与 `tmp`，已有匹配版本会直接复用。只运行 Web 或 `pnpm install` 不会下载桌面二进制；如需提前准备，可从仓库根目录运行 `node scripts/install-electron-runtime.mjs`。

平台打包命令：

```bash
pnpm --filter mpforge-desktop run build:mac
pnpm --filter mpforge-desktop run build:win
pnpm --filter mpforge-desktop run build:linux
```

## 发布产物

当前打包配置：

- macOS：`zip`，自动发布 Apple Silicon 版本。
- Windows：NSIS 安装包与 zip。
- Linux：AppImage 与 deb。

构建产物输出到 `apps/electron/release/`，不要手工编辑构建产物。
