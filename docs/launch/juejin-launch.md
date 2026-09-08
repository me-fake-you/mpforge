# 把公众号文章做成 Content-as-Code，真正困难的不是 Markdown

> 状态：发布前草稿。公开 URL 已预填，提交前必须确认真实可访问。

公众号排版工具很多，但内容团队更难回答的是：这次草稿来自哪个提交？图片来源是否明确？审校人批准的是哪个预览？网络结果不确定时会不会重复创建？

MPForge 把这些问题组织成一条本地优先的流水线：

```text
Markdown + assets
→ schema / status
→ deterministic lint
→ light / dark / mobile preview
→ human approval
→ Mock Draft or guarded Real Draft
→ redacted receipt
```

## 三个关键取舍

第一，文章目录是源，而不是某个在线编辑器的临时副本。正文、素材清单、状态事件、构建证据和脱敏回执都可以接受 Git 审查。

第二，发布闸门不依赖 LLM。AI 可以建议，但不能批准；只要 Linter 有 ERROR、素材权利未确认或批准证据过期，草稿操作就会失败。

第三，Mock 与 Real 必须诚实区分。公开 Demo 只使用本地 Mock WeChat，用于验证上传、草稿、幂等、未知远端状态和对账。Real Draft 需要用户自己的合法账号、服务端凭据和本次人工确认。真实账号目前尚未测试，Mock 成功不能被写成真实公众号成功。

MPForge v0.1 不支持自动正式发布或群发。真实适配器的边界只到公众号草稿箱，正式发布仍由用户在平台后台人工完成。

## 来源与公开边界

MPForge is **Based on WeMD by the WeMD Team**，保留 WeMD MIT 许可证、版权和固定上游 Commit。项目不是完全原创，也不隶属于腾讯或微信。

公开版会排除许可证元数据存在冲突的上游 `apps/server`、个人收款二维码、来源未确认照片、本地缓存、工具链、Git bundle、私人文章和真实回执。公开仓库使用清洁源码历史，不会把包含这些对象的本地开发历史直接推送出去。

## 待替换链接

- 仓库：https://github.com/me-fake-you/mpforge
- Release：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0
- Mock Demo：https://me-fake-you.github.io/mpforge/
- Windows 下载与校验和：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0

只有测试、许可证、公共边界、历史、SBOM 和 Release 产物 Gate 全部通过后，才会发布本文。
