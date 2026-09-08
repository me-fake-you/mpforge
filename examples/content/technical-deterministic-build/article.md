---
schema_version: 1
id: "11111111-1111-4111-8111-111111111111"
slug: "technical-deterministic-build"
title: "确定性构建：让同一篇文章得到同一个结果"
summary: "用输入、版本和哈希解释可复现内容流水线的基本设计。"
author: "MPForge Examples"
account: ""
theme: "tech-dark-accent"
status: "draft"
cover: "assets/cover.svg"
source_url: null
original: true
ai_assisted: false
ai_tasks: []
human_reviewed: false
need_open_comment: true
only_fans_can_comment: false
created_at: "2026-08-31T00:00:00.000Z"
updated_at: "2026-08-31T00:00:00.000Z"
version: 1
---

# 确定性构建：让同一篇文章得到同一个结果

内容流水线是否可靠，不只取决于页面看起来是否正确，还取决于相同输入能否稳定产生相同输出。

![输入经过检查、渲染并生成哈希](assets/cover.svg)

## 三类需要固定的输入

1. 原稿与本地素材；
2. 渲染器和主题版本；
3. 明确的构建参数，例如浅色或深色模式。

## 用哈希比较两次结果

```ts
const first = renderArticle(request);
const second = renderArticle(request);
const reproducible = first.hashes.html === second.hashes.html;
```

如果两次 HTML 哈希不同，Linter 应阻断草稿创建，并要求先定位时间戳、随机 ID 或不稳定排序等来源。

## 结论

确定性不是一句承诺，而是可以重复执行、比较并保存的证据。
