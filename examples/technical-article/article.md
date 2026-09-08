---
schema_version: 1
id: "example-technical-article"
slug: "technical-article"
title: "确定性渲染：把文章构建变成可验证过程"
summary: "用 AST、规范化和 SHA-256 构建可复现的公众号 HTML。"
author: "MPForge Examples"
account: "local-example"
theme: "tech-dark-accent"
status: "draft"
cover: "./assets/pipeline.svg"
source_url: null
original: true
ai_assisted: true
ai_tasks: ["drafting", "illustration"]
human_reviewed: false
need_open_comment: true
only_fans_can_comment: false
created_at: "2026-08-31T00:00:00.000Z"
updated_at: "2026-08-31T00:00:00.000Z"
version: 1
---

# 确定性渲染：把文章构建变成可验证过程

一条可靠的内容流水线，不只要“看起来正确”，还要能证明相同输入会产生相同输出。

![确定性渲染流程](./assets/pipeline.svg "Markdown 经过规范化、主题和清理后得到 HTML")

## 流程概览

> 构建时间可以进入元数据，但不应进入正式 HTML。

1. 解析 Markdown 与 Frontmatter；
2. 规范化 AST；
3. 应用版本化主题；
4. 清理危险标签；
5. 对正式 HTML 计算 SHA-256。

```ts
const first = renderArticle(input);
const second = renderArticle(input);
assert.equal(first.hash, second.hash);
```

### 验证表

| 检查项   | 预期         |
| -------- | ------------ |
| 相同输入 | 相同 HTML    |
| 脚本标签 | 被删除       |
| 本地图片 | 保留相对路径 |

```mermaid
flowchart LR
  A[Markdown] --> B[AST]
  B --> C[微信兼容 HTML]
  C --> D[SHA-256]
```
