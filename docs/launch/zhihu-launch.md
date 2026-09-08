# 为什么我把公众号发文流程做成了 Content-as-Code？

> 发布前草稿：公开 URL 已预填，提交前必须确认真实可访问。

公众号编辑器解决的是“怎么把这一篇排好看”，Content-as-Code 还要回答另一组问题：内容源在哪里？素材有没有授权？审校人批准了哪一版？草稿失败时能不能恢复？一次操作和哪份构建证据对应？

MPForge 的答案是把文章视为一个有状态、可构建、可审计的目录：Markdown 与本地素材是输入，确定性 Linter 和预览是证据，人类批准是副作用闸门，草稿回执是结果。

## 为什么不用 AI 自动批准

语言模型适合提出选题、结构或表达建议，却不适合替作者承担发布责任。MPForge 允许 AI 建议进入审校，但不允许 AI 写入 `approved`。源文件、主题、素材或 Linter 证据变化后，旧批准立即失效。

## 为什么一定要有 Mock

真实公众号接口涉及账号权限、凭据、额度和远端状态。公开 Demo 如果必须接真实账号，就无法安全复现，也不适合 CI。

因此 Mock Draft 会覆盖计划冻结、图片上传、草稿创建、脱敏回执、幂等、`UNKNOWN_REMOTE_STATE` 和只读对账，但只访问本地 Mock 服务。Real Draft 是另一条受保护边界，需要用户自己的合法账号配置和对本次操作的人工确认。

真实账号目前尚未测试，所以不能把 Mock 成功写成真实草稿成功。MPForge v0.1 也不提供自动正式发布或群发；正式发布始终由人类在微信公众平台后台完成。

## 这不是从零开始的项目

MPForge is **Based on WeMD by the WeMD Team**。编辑器、Electron 壳和部分 Markdown/主题能力来自 WeMD，项目继续保留 MIT 许可证、版权与固定上游 Commit。MPForge 新增的是 Content-as-Code 数据模型、质量门、媒体来源、批准闸门、草稿操作、回执、CLI、MCP 和安全发布边界。

项目不隶属于腾讯或微信。公开版不会携带有许可证冲突的上游 Server、个人收款二维码、来源未确认照片、本地缓存、工具链、Git bundle、私人文章或真实回执。

## 待替换链接

- 公开仓库：https://github.com/me-fake-you/mpforge
- v0.1.0 Release：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0
- 仅 Mock 的 Pages Demo：https://me-fake-you.github.io/mpforge/
- Windows 下载与 SHA-256：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0

正式发布前会以同一个发布 Commit 的测试、许可证、历史、SBOM 和产物扫描结果替换这段状态说明。
