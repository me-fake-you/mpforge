# WeChat compatibility sources

MPForge keeps platform facts in versioned configuration instead of scattering
them through individual lint rules. This record covers the official pages
checked for the Round 2 ruleset.

## Verification record

- Verified: 2026-09-01 (Asia/Shanghai)
- Ruleset configuration target: `wechat-official-account-2026-09-01`
- Primary source: [新增草稿 — 微信服务号官方文档](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add)
- Product overview: [草稿管理和商品卡片 — 微信服务号官方文档](https://developers.weixin.qq.com/doc/service/guide/product/draft.html)
- Dark-mode guidance: [DarkMode 适配指南 — 微信服务号官方文档](https://developers.weixin.qq.com/doc/service/guide/h5/darkmode.html)

The primary source was fetched successfully from the official
`developers.weixin.qq.com` host on the verification date. No community post or
third-party SDK is treated as a normative platform source.

## Confirmed draft constraints

The official `draft/add` page currently documents these limits for a normal
`news` article:

| Field or behavior          | Official constraint used by MPForge                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `title`                    | Required; total length no more than 32 characters.                                                                                   |
| `author`                   | Optional at API level; total length no more than 16 characters. MPForge may require it as a project quality rule.                    |
| `digest` / article summary | No more than 120 characters.                                                                                                         |
| `content`                  | Fewer than 20,000 characters and smaller than 1 MiB; JavaScript is removed by the platform.                                          |
| `content_source_url`       | No more than 1 KiB.                                                                                                                  |
| article images             | External image URLs are filtered; formal draft delivery must use images uploaded through the corresponding official image interface. |
| `thumb_media_id`           | Required for a normal `news` article.                                                                                                |
| image-message count        | The documented `newspic` variant allows at most 20 images; this is not applied blindly to normal `news` content.                     |

The rendered official page also contains a phrase that appears as “大小不可超过
2kb” beside the separate 1 MiB limit. Because those two statements conflict and
the page gives no clarification, MPForge does not invent an interpretation. The
Round 2 deterministic gate applies the unambiguous 20,000-character and 1 MiB
limits and records the ambiguity here for future re-verification.

## MPForge policy versus platform fact

Requirements such as non-empty `summary`, non-empty local `author`, explicit
rights metadata, zero unresolved placeholders, no secrets, and a completed
human checklist are MPForge release-quality policies. They are not represented
as official WeChat API requirements.

HTML/CSS downgrade and dark-mode checks are conservative local simulations.
The UI and reports must display this notice:

> 微信兼容模拟预览，最终效果仍应在公众号草稿箱中人工确认。

MPForge does not claim that its sanitizer, downgrade model, screenshots, or
layout checks reproduce every current WeChat client behavior.

## Update policy

When an official constraint changes, add a new dated configuration version,
retain the earlier version for reproducibility, update the relevant rule
documentation and fixtures, and rerun deterministic hash tests. Never silently
change an existing ruleset version.
