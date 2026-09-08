---
schema_version: 1
id: "example-education-article"
slug: "education-article"
title: "初中信息技术：用 Python 条件判断设计课堂任务"
summary: "一节围绕 if/elif/else、输入验证和测试用例展开的课堂示例。"
author: "MPForge Examples"
account: "local-example"
theme: "academic-blue"
status: "draft"
cover: "./assets/classroom.svg"
source_url: null
original: true
ai_assisted: true
ai_tasks:
  - outline
  - drafting
  - illustration
human_reviewed: false
need_open_comment: true
only_fans_can_comment: false
created_at: "2026-08-31T00:00:00.000Z"
updated_at: "2026-08-31T00:00:00.000Z"
version: 1
---

# 初中信息技术：用 Python 条件判断设计课堂任务

本课让学生把“根据温度选择衣物”转换成清楚、可测试的条件判断。

![课堂任务卡](./assets/classroom.svg "从生活问题到条件判断")

## 教学目标

- 理解布尔条件的真假；
- 能使用 `if`、`elif`、`else` 表达互斥分支；
- 能用边界值检查程序结果。

## 课堂任务

输入当天温度，输出合适的衣物建议：

```python
temperature = int(input("请输入温度："))

if temperature < 10:
    print("穿厚外套")
elif temperature < 20:
    print("穿薄外套")
else:
    print("穿短袖")
```

> 先写出 9、10、19、20 四个测试值，再运行程序。边界值最容易暴露条件错误。

| 输入 | 预期输出 |
| ---: | -------- |
|    9 | 穿厚外套 |
|   10 | 穿薄外套 |
|   20 | 穿短袖   |
