# MPForge v0.1.0 release FAQ

> 发布前模板：公开 URL 已预填，外部发布前必须再次通过链接检查。

## MPForge 是什么？

MPForge 是 Git 驱动、Agent 友好的微信公众号 Content-as-Code 工作台。它把 Markdown、素材、确定性检查、预览、人工批准、草稿操作和脱敏回执组织成一条可审计流程。

## 它是完全原创项目吗？

不是。MPForge is **Based on WeMD by the WeMD Team**，保留 WeMD 的 MIT 许可证、版权和固定上游 Commit。编辑器、Electron 壳和部分 Markdown/主题能力来自 WeMD；MPForge 在此基础上增加 Content-as-Code、质量门、来源记录、批准闸门、草稿回执、CLI、MCP 和 Mock 流水线。

## 它与腾讯或微信有官方关系吗？

没有。MPForge 不隶属于腾讯或微信，也不提供官方兼容性保证。

## Mock Draft 和 Real Draft 有什么区别？

Mock Draft 只连接本地 Mock WeChat，适合 Demo、测试、CI、错误注入、幂等和对账。它不需要真实账号，也不会调用真实微信接口。

Real Draft 是受闸门保护的真实“草稿箱”适配器，需要用户自己的合法账号配置、有效证据和对本次操作的明确人工确认。两者的成功声明不能互换。

## 真实公众号账号测试过吗？

尚未测试。v0.1 只能准确声明 Mock 流水线和适配器契约的已验证范围，不能声明真实账号草稿创建成功。

## 会自动正式发布或群发吗？

不会。v0.1 不实现自动正式发布，也不实现群发。即使未来真实草稿创建成功，正式发布仍由用户在微信公众平台后台人工完成。

## 为什么公开仓库里没有原来的 Server？

上游 `apps/server` 在固定上游 Commit 的组件清单中标记为 `UNLICENSED`。为了避免模糊授权，公开版采用彻底排除方案：源码、历史、锁文件、SBOM 和 Release 都不包含它。v0.1 核心工作流不依赖该组件。

## 公开历史为什么不是完整开发历史？

本地开发历史包含被排除的 Server、个人支付图片和其他不应公开的对象。公开仓库从经过 allowlist 和扫描的源码创建清洁历史，同时在 `NOTICE.md`、`UPSTREAM.md` 和来源文档中保留 WeMD 归属。清洁历史不是“完全原创”的声明。

## 发布包会包含什么？

计划提供清洁源码、Windows 安装包、Windows 便携包、SHA-256、Release Manifest、来源 SBOM、运行时 SBOM，以及只使用 Mock 的 Pages Demo。只有实际生成并扫描通过的项目才会进入 Release。

## Windows 包有数字签名吗？

以 Release Notes 中的真实状态为准。若没有证书，将明确标注 `unsigned` 并说明可能出现系统提醒，不会伪造签名状态。

## 会收集文章、账号或凭据吗？

默认工作流本地优先。公开 Demo 不读取真实环境变量。回执不得保存 AppSecret、Access Token、Cookie、私钥或完整账号凭据。用户仍应在提交 Issue 或日志前自行检查敏感内容。

## 我可以在哪里获取？

- 仓库：https://github.com/me-fake-you/mpforge
- Release：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0
- Mock Demo：https://me-fake-you.github.io/mpforge/
- Windows 下载：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0
- 校验和：https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/SHA256SUMS
- 安全报告渠道：见 `SECURITY.md`；不要公开粘贴漏洞细节或凭据

当前链接状态：`NOT_CREATED`。在真实链接存在之前，不应把本 FAQ 作为已发布公告。
