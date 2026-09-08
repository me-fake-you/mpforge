---
schema_version: 1
id: "44444444-4444-4444-8444-444444444444"
title: "我把公众号发文做成了 Content-as-Code：从 Markdown 到草稿箱，全程可审计"
summary: "介绍 MPForge 如何把 Markdown、素材、审校、预览、人工批准和草稿回执组织成一条可审计的本地工作流。"
author: "MPForge contributors"
account: ""
theme: "minimal"
status: "draft"
cover: null
source_url: null
original: true
ai_assisted: true
ai_tasks: ["outline", "copy-edit"]
human_reviewed: false
need_open_comment: true
only_fans_can_comment: false
created_at: "2026-09-04T00:00:00.000Z"
updated_at: "2026-09-04T00:00:00.000Z"
---

# 我把公众号发文做成了 Content-as-Code：从 Markdown 到草稿箱，全程可审计

> 发布说明：这是一份待发布稿，不会由本轮自动发布。文末公开地址已预填，但仍须在外部发布前核验可访问性。

一篇公众号文章经常散落在编辑器、聊天记录、图片目录和后台草稿里。每个人都知道文章改过很多次，却很难准确回答：审校人看的是哪一版？图片是否有来源记录？草稿对应哪次构建？失败后还能不能安全重试？

我做 MPForge，想解决的正是这些“最后一公里”问题：让文章像代码一样拥有明确的源文件、状态、质量门、人工批准和结果回执。

## 一篇文章就是一组可追踪文件

```text
Markdown + Frontmatter + local assets
→ deterministic lint
→ light / dark / mobile preview
→ human approval
→ Mock Draft or guarded Real Draft
→ redacted receipt
```

Markdown 是正文源，Frontmatter 描述主题和状态，本地素材清单记录哈希与权利状态。Linter、渲染结果、批准事件和草稿回执共同回答“哪一份输入产生了哪一次结果”。

Git 因而不只记录文字差异，也记录文章从草稿、审校到批准的过程。通用格式化工具不能随意改写已经绑定哈希的发布证据；任何源文件变化都必须重新检查和重新批准。

## 质量门不依赖大模型

MPForge 的 Linter 使用确定性规则检查 Frontmatter、素材、危险 HTML/CSS、标题结构、表格与代码宽度、占位内容、外链、本地绝对路径和潜在秘密。

AI 可以协助写作、提出修改建议或建议进入审校，但不能把文章设置为 `approved`。只要存在 ERROR、图片权利未确认、预览证据过期或批准与当前源文件不一致，草稿操作就会被阻止。

## Mock 和 Real 是两条不同的边界

| 模式       | 用途                               | 会不会接触真实公众号                           |
| ---------- | ---------------------------------- | ---------------------------------------------- |
| Copy       | 复制兼容 HTML，供人工使用          | 不会                                           |
| Mock Draft | 本地演示、测试、CI、失败恢复和对账 | 不会，只访问本地 Mock 服务                     |
| Real Draft | 受人工闸门保护的公众号草稿箱适配器 | 可能，需要用户自己的合法账号配置与本次显式确认 |

公开 Demo 默认并且只能使用 Mock。Mock 成功只证明本地协议、幂等、失败状态和回执链路得到验证，不等于真实公众号成功。

真实适配器只面向“草稿箱”，不包含自动正式发布，也不包含群发。当前 v0.1 的真实账号尚未测试，因此项目不会宣称真实账号草稿验证通过。即使未来真实草稿创建成功，正式发布仍由用户在微信公众平台后台人工完成。

## 回执不应该保存秘密

一次草稿操作可能记录源提交、文章哈希、渲染哈希、素材哈希、主题、Linter 证据、批准事件和远端结果，但不会保存 AppSecret、Access Token、Cookie、私钥或完整账号凭据。

当网络结果无法确认时，状态应当是 `UNKNOWN_REMOTE_STATE`，先只读对账，再决定是否继续。系统不能为了“看起来成功”而重复创建草稿。

## Based on WeMD，也要把边界说清楚

MPForge is **Based on WeMD by the WeMD Team**。项目保留 WeMD 的 MIT 许可证、版权和固定上游 Commit 说明，并明确区分继承模块与 MPForge 新增模块。

编辑器、Electron 壳和部分 Markdown/主题能力来自 WeMD；Content-as-Code 数据模型、确定性质量门、媒体来源记录、人工批准闸门、Mock 草稿流水线、脱敏回执、CLI、MCP 和项目级 Skills 是 MPForge 的新增工作。

上游 `apps/server` 的组件许可证元数据存在冲突，因此它不会进入公开源码、公开历史或 Release。个人收款二维码、来源不明的上传照片、本地工具链、缓存、Git bundle、私人文章和真实运行回执也不会公开。

MPForge 不隶属于腾讯或微信，也不代表任何官方兼容性承诺。

## 发布前还要完成什么

本文只有在以下证据全部来自同一个公开发布提交后才能对外发布：

1. Linter 无 ERROR；
2. 图片权利状态均已人工确认；
3. 浅色、深色和移动端预览已生成并检查；
4. 人工批准绑定当前源文件和素材清单；
5. 本地 Mock Draft、回执、未知状态和对账场景通过；
6. 公开边界、许可证、秘密、历史、SBOM 和产物扫描通过；
7. 仓库、Release、Pages 与下载链接真实可访问。

## 待替换链接

- 公开仓库：https://github.com/me-fake-you/mpforge
- v0.1.0 Release：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0
- Mock Web Demo：https://me-fake-you.github.io/mpforge/
- Windows 下载：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0（未签名）
- SHA-256：https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/SHA256SUMS

在这些地址真实存在之前，这篇文章保持 `draft`，不会创建真实公众号草稿，也不会正式发布或群发。
