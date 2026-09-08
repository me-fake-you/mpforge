# MPForge

**Git 驱动、Agent 友好的微信公众号内容工程工作台**

`Markdown → 审校 → 图片处理 → 微信预览 → 人工批准 → Mock 或公众号草稿箱`

[English](README.en.md) · [安全设计](SECURITY.md) · [上游关系](UPSTREAM.md) · [来源清单](docs/PROVENANCE.md)

> Based on WeMD by the WeMD Team. MPForge 固定基于 WeMD 提交 `964525d80ef63477c3a4b0327fe2a43415ee2bad`，保留上游 MIT 版权声明。项目不隶属于腾讯或微信，也未获得其背书。v0.1.0 不支持自动正式发布或群发；真实草稿能力需要用户自己的合法账号配置，且尚未经过真实账号验证。默认 Demo 只使用 Mock。

MPForge 不是只保存一段文本的普通 Markdown 编辑器。它把文章、图片来源与授权、确定性审校结果、预览证据、人工批准、不可变操作计划和脱敏回执放在同一个可版本化工程中，便于人和 Agent 一起工作，也便于事后审计。

![MPForge Dashboard](artifacts/evidence/round-4/dashboard.png)

![MPForge Mock Demo](artifacts/evidence/round-4/demo.gif)

[在线 Mock Demo](https://me-fake-you.github.io/mpforge/) · [v0.1.0 Release](https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0) · [Windows 安装包](https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/MPForge.Setup.0.1.0.exe) · [Windows 便携包](https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/MPForge-Portable-0.1.0-win-x64.zip)

## 30 秒体验

前置要求：Node.js 22.12+、pnpm 9。项目产生的依赖、下载和缓存均按项目策略保存在检出目录内。

```bash
pnpm install --frozen-lockfile
pnpm demo
```

Demo 会向浏览器存储放入一篇原创示例，始终显示 `DEMO / MOCK` 标识，并使用浏览器内存中的 Mock WeChat。它不读取真实账号环境变量，也不显示真实草稿执行入口。

在线 Demo 固定使用浏览器内 Mock；Windows v0.1.0 为未签名构建，Windows 可能显示安全提醒。请从 [Release 页面](https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0) 下载并使用同页 `SHA256SUMS` 校验。

## v0.1.0 能做什么

- 继承自 WeMD 的 Markdown 编辑、微信样式转换、浅色/深色手机预览和本地优先存储。
- 四套 MPForge 主题：`minimal`、`academic-blue`、`warm-editorial`、`tech-dark-accent`。
- 确定性的 Content-as-Code Schema、Linter、渲染器和图片 Manifest。
- 图片来源、哈希、优化、去重与 `rights_status` 授权检查。
- 只能由人完成的批准闸门；Agent 与 AI 不能批准文章。
- Mock/Real 不可变操作计划、幂等保护、脱敏回执、未知远端状态与只读对账。
- 本地 Mock WeChat、项目内 CLI、stdio MCP Server 和项目 Skills。
- Electron 桌面构建与纯浏览器 Demo Mode。

许可证不明确的上游 `apps/server` 已明确从公开源码、工作区、锁文件、Docker、制品和清洁公开历史中排除。外部图片上传端点是可选配置；未配置时安全失败，不会回退到未知“官方服务”。

## Content-as-Code

```text
content/<slug>/
├── article.md
├── assets/manifest.json
├── build/
├── history/
└── receipts/
```

通常状态流为 `idea → draft → reviewing → reviewed → approved → sent_to_draft`。只有显式人工动作可以产生批准。Mock 流程能够演示图片上传、草稿创建、`UNKNOWN_REMOTE_STATE`、只读对账和防止重复创建，全程不访问微信。

## 开发、Doctor、CLI 与 MCP

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm mpforge doctor
pnpm dev
```

Doctor 检查 Node、pnpm、项目目录、写权限、可选浏览器能力、Mock 能力、配置状态、安全环境状态和真实微信默认关闭状态，但绝不打印秘密值。

只开发浏览器界面可运行 `pnpm dev:web`；桌面开发运行 `pnpm dev:desktop`。首次启动桌面时会按锁定版本准备 Electron，下载缓存和临时文件保存在当前检出目录的 `.cache/electron` 和 `tmp`；仅安装依赖或启动 Web 不会下载桌面运行时。

项目内 CLI 示例：

```bash
pnpm mpforge init
pnpm mpforge new my-article
pnpm mpforge lint my-article
pnpm mpforge render my-article
pnpm mpforge preview my-article
pnpm mpforge draft prepare my-article --mock
```

启动本地 stdio MCP Server：

```bash
pnpm --filter @mpforge/mcp build
node apps/mcp/dist/index.js
```

MCP 故意不提供人工批准工具，也不提供真实账号草稿的直接执行工具。安全配置参考 [Round 3 草稿适配器文档](docs/WECHAT_DRAFT_ADAPTER.md)。不要把秘密写进源码、提示词、日志或 Issue。

## Linter、图片流水线与批准闸门

Linter 在不依赖大模型的情况下检查结构、微信兼容性和发布前条件。图片流水线记录来源、哈希、尺寸、格式和授权状态；授权不明确的图片不能进入可发布状态。批准记录绑定当前源码、渲染结果、图片清单和预览证据，内容变化后旧批准会失效。

## Mock 与 Real

- **Copy**：只生成可复制 HTML，没有账号副作用。
- **Mock Draft**：在本地模拟上传、草稿、失败、超时、响应丢失和对账。
- **Real Draft**：受严格闸门保护的适配器边界；本版本只验证契约，没有真实账号测试证据。

三种模式都不执行正式发布或群发。正式发布仍由用户在公众号后台完成。

## 安全设计与验证

CI 和 Demo 固定使用：

```text
MPFORGE_NETWORK_MODE=mock-only
MPFORGE_REAL_WECHAT_DISABLED=true
MPFORGE_DEMO_MODE=true
```

本地验证命令：

```bash
pnpm test
pnpm typecheck
pnpm qa
pnpm build
pnpm test:e2e
node scripts/audit-public-boundary.mjs
```

工作流文件存在不等于远程运行已经通过，发布状态只依据实际证据。若 Windows 构建未签名，系统可能显示提醒；MPForge 不会伪造签名状态。

## Skills、上游关系与许可证

`.agents/skills/` 中的项目级 Skills 帮助 Agent 执行写作、审校、图片、审核和草稿流程，同时不绕过人工闸门。架构与信任边界见 [ARCHITECTURE.md](ARCHITECTURE.md)、[SECURITY.md](SECURITY.md) 和 [公开发布边界](docs/PUBLIC_RELEASE_BOUNDARY.md)。

完整 Fork 记录见 [UPSTREAM.md](UPSTREAM.md)。版权、依赖和分发决策见 [NOTICE.md](NOTICE.md)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、[LICENSE_POLICY.md](LICENSE_POLICY.md) 与 [来源登记](third_party/SOURCE_REGISTRY.md)。根许可证继续使用 MIT，并保留 WeMD 版权说明；第三方组件继续适用各自许可证。

## 路线图与贡献

v0.1.0 之后的最高优先级是：实现 Agent 原生公众号内容流水线、选题库、内容日历和多账号工作区，并用 MPForge 制作首批公开内容。

贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。不得提交私人文章、凭据、Cookie、真实回执或无公开授权的素材。
