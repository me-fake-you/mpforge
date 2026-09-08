# Bilibili demo script: MPForge v0.1.0

> 状态：`DRAFT_NOT_RECORDED`。录制前核验以下公开链接，并只使用通过隐私检查的公开 Demo 数据。

建议时长：5–7 分钟。画面只展示干净公开工作区、原创示例文章和本地 Mock WeChat。不要显示用户目录、通知、私人 Git 远程、真实账号、环境变量或浏览器登录状态。

## 分镜

| 时间        | 画面                              | 旁白要点                                                                |
| ----------- | --------------------------------- | ----------------------------------------------------------------------- |
| 00:00–00:25 | 标题与完整流水线                  | “MPForge 把 Markdown、素材、审校、批准和草稿回执放进一条可审计工作流。” |
| 00:25–01:05 | Dashboard 与示例文章              | 展示文章状态、主题和证据入口；强调使用原创公开 fixture                  |
| 01:05–01:50 | Markdown、Frontmatter 与 Git diff | 说明文章目录是源，修改会让旧证据失效                                    |
| 01:50–02:35 | Linter 与素材 Manifest            | 展示 ERROR 阻断、素材哈希和人工 rights approval；不展示秘密             |
| 02:35–03:15 | 浅色、深色和移动端预览            | 同一源文件生成多种可检查证据，不把设计稿伪装成运行截图                  |
| 03:15–03:55 | 人工批准                          | AI 只能建议，不能设置 `approved`；批准绑定当前哈希                      |
| 03:55–04:45 | Mock Draft 上传、创建和回执       | 明确屏幕标注 `DEMO / MOCK`，说明没有真实微信请求                        |
| 04:45–05:25 | `UNKNOWN_REMOTE_STATE` 与对账     | 演示不重复创建，先只读查询再确定远端状态                                |
| 05:25–06:00 | Mock / Real 对照表                | Real 需要用户自己的合法账号与本次人工确认；真实账号尚未测试             |
| 06:00–06:30 | About、许可证与来源               | “Based on WeMD by the WeMD Team”；保留 MIT、版权和上游 Commit           |
| 06:30–结束  | 链接和限制                        | v0.1 不自动正式发布、不群发；链接只在真实发布后出现                     |

## 必须口播的声明

“公开演示只使用本地 Mock WeChat。Mock 成功不是实际公众号成功。真实适配器契约与真实账号运行是两种证据；当前真实账号尚未测试。MPForge v0.1 不提供自动正式发布或群发。”

“MPForge is Based on WeMD by the WeMD Team，保留上游 MIT 许可证和版权。MPForge 不隶属于腾讯或微信。”

## 屏幕链接卡

- Repository：https://github.com/me-fake-you/mpforge
- Release：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0
- Mock Pages Demo：https://me-fake-you.github.io/mpforge/
- Windows installer / portable：https://github.com/me-fake-you/mpforge/releases/tag/v0.1.0
- SHA-256：https://github.com/me-fake-you/mpforge/releases/download/v0.1.0/SHA256SUMS

如果任一地址尚未创建，视频中写“尚未发布”，不要保留看似可点击的虚假地址。

## 录制验收

- 当前发布 Commit 的 Mock E2E、公共边界、许可证、历史、SBOM 和产物扫描均有真实报告；
- 所有截图和录屏均无绝对路径、个人信息、账号别名、Token、Cookie 或私钥；
- Windows 安装包是否签名按真实结果口播；
- 不展示或上传本地 bundle、工具链、缓存、私人文章、真实回执或来源未确认图片；
- 录制失败时不剪掉错误冒充成功，修复并重新验证后再录。
