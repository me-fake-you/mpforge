# 我把公众号发文变成了一条可审计流水线

> 待发布笔记｜公开 URL 已预填，提交前必须确认真实可访问。

写公众号最焦虑的可能不是 Markdown，而是：

1. 审校人看的到底是哪一版？
2. 图片能不能用，有没有来源？
3. 草稿失败后，会不会手滑再建一份？
4. 回执里会不会泄露 Token？

我在做的 MPForge，把流程拆成：

```text
Markdown
→ 确定性检查
→ 素材权利确认
→ 浅色 / 深色 / 手机预览
→ 人工批准
→ Mock 或受保护的 Real Draft
→ 脱敏回执
```

公开 Demo 只跑本地 Mock WeChat，不需要登录，不读取真实账号，也不访问真实微信接口。Real Draft 必须由用户提供自己的合法账号配置，并确认这一次具体操作。

要特别说明：真实账号目前尚未测试，Mock 成功不等于真实草稿成功。v0.1 不会自动正式发布，也不会群发，最后一步仍然由人类在后台完成。

MPForge is **Based on WeMD by the WeMD Team**，保留 WeMD 的 MIT 许可证、版权和上游 Commit，不是完全原创项目，也不隶属于腾讯或微信。

公开版会排除许可证有冲突的上游 Server、个人收款二维码、来源未确认照片、缓存、工具链、Git bundle、私人文章和真实回执。

链接（发布前核验）：

- 仓库 https://github.com/me-fake-you/mpforge
- Release https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0
- Mock Demo https://me-fake-you.github.io/mpforge/
- Windows 下载 https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0

在链接真实可访问、发布 Gate 全部通过之前，这只是一份素材草稿，不代表项目已经公开上线。

#ContentAsCode #Markdown #开源项目 #微信公众号 #本地优先 #开发工具
