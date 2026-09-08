# [分享创造] MPForge：把 Markdown 到公众号草稿做成可审计的 Git 工作流

> 待发布帖：公开 URL 已预填，提交前必须确认真实可访问。

做 MPForge 的出发点是：公众号文章不应该只剩“最后粘贴进去的那一版”，还应该能追踪原稿、素材、检查、批准和草稿结果。

目前的核心边界：

- Markdown、Frontmatter、本地素材和状态事件进入 Git；
- 确定性 Linter 的 ERROR 会阻止草稿；
- 浅色、深色和移动端预览绑定当前源哈希；
- AI 不能设置 `approved`；
- Mock Draft 只访问本地 Mock WeChat，适合 Demo、CI 和失败恢复；
- Real Draft 需要用户自己的合法账号配置与本次人工确认；
- 真实账号尚未测试，不能用 Mock 结果代替；
- v0.1 不自动正式发布，也不群发。

MPForge is **Based on WeMD by the WeMD Team**。公开版保留 WeMD 的 MIT 许可证、版权和固定上游 Commit，并说明继承与新增模块。它不隶属于腾讯或微信。

为了公开安全，许可证有冲突的上游 Server、个人收款二维码、来源未确认图片、本地缓存、工具链、Git bundle、私人文章和真实回执都不进入公开源码或 Release。公开仓库会使用清洁源码历史，而不是直接推送本地开发历史。

链接（发布前核验）：

- https://github.com/me-fake-you/mpforge — 公开仓库
- https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0 — v0.1.0 Release 与 Windows 产物
- https://me-fake-you.github.io/mpforge/ — 仅 Mock 的 Web Demo
- https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/SHA256SUMS — SHA-256

想重点听听大家对状态机、素材权利记录、未知远端状态、回执字段和 Windows 安装体验的意见。请不要在回复中粘贴真实公众号凭据或私人文章。
