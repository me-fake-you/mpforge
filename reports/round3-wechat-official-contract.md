# MPForge Round 3 — 微信公众号草稿接口官方契约核验

- 核验日期：2026-09-01（Asia/Shanghai）
- 核验范围：接口调用凭据、正文图片、永久封面素材、新增草稿、草稿详情、草稿列表
- 来源约束：仅使用微信开发者平台官方文档；未调用任何真实接口，未使用或索取任何凭据
- 结论边界：本文是适配器契约依据，不代表任何真实账号已经开通权限，也不代表线上调用已经验证

## 1. 官方来源

1. [获取接口调用凭据（getAccessToken）](https://developers.weixin.qq.com/doc/service/api/base/api_getaccesstoken)
2. [获取稳定版接口调用凭据（getStableAccessToken）](https://developers.weixin.qq.com/doc/service/api/base/api_getstableaccesstoken)
3. [Access Token 使用说明](https://developers.weixin.qq.com/doc/oplatform/developers/dev/AccessToken)
4. [上传发表内容中的图片（uploadImage）](https://developers.weixin.qq.com/doc/service/api/material/permanent/api_uploadimage)
5. [上传永久素材（addMaterial）](https://developers.weixin.qq.com/doc/service/api/material/permanent/api_addmaterial)
6. [新增草稿（draft_add）](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add)
7. [获取草稿详情（getDraft）](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_getdraft)
8. [获取草稿列表（draft_batchget）](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_batchget)
9. [微信开发者平台全局错误码](https://developers.weixin.qq.com/doc/oplatform/developers/errCode/)
10. [微信官方 API 诊断工具](https://developers.weixin.qq.com/console/devtools/debug?utm_source=api_errcode)

官方旧版目录页面目前把草稿与素材能力导向上述新服务端 API 页面：[草稿箱目录](https://developers.weixin.qq.com/doc/offiaccount/Draft_Box/Add_draft.html)、[素材管理目录](https://developers.weixin.qq.com/doc/offiaccount/Asset_Management/Adding_Permanent_Assets.html)。实现应以新 API 页面中的当前字段为准。

## 2. 服务端与权限边界

所有本次核验的接口页面都明确提示接口应在服务器端调用，不可由网页、APP 等前端直接调用。`AppSecret` 和 `access_token` 因此不得进入浏览器、前端包、source map 或客户端日志。

| 能力                         | 账号适用范围（官方表）                           | 第三方平台代调用 | 权限集                                   |
| ---------------------------- | ------------------------------------------------ | ---------------- | ---------------------------------------- |
| 获取普通/稳定 `access_token` | 公众号、服务号均可（官方表还列出其他应用类型）   | 不支持           | 不适用                                   |
| 上传正文图片                 | 公众号、服务号均可（官方表还列出小程序、小游戏） | 支持             | `1`、`8-9`、`11`、`18`、`37`、`100` 之一 |
| 上传永久素材                 | 公众号、服务号均可                               | 支持             | `11`、`100` 之一                         |
| 新增草稿                     | 公众号、服务号均可                               | 支持             | `11`、`100` 之一                         |
| 获取草稿详情                 | 公众号、服务号均可                               | 支持             | `11`、`100` 之一                         |
| 获取草稿列表                 | 公众号、服务号均可                               | 支持             | `11`、`100` 之一                         |

第三方平台模式使用 `authorizer_access_token`；本项目的直接账号模式使用账号自己的 `access_token`。官方“适用范围”只说明账号类型理论上可调用，不保证某个具体账号当前已认证、已授权或未被限制；真实执行前仍需账号侧权限检查。

## 3. Access Token 契约

### 3.1 推荐：稳定版接口

- 方法与地址：`POST https://api.weixin.qq.com/cgi-bin/stable_token`
- 请求 JSON：
  - `grant_type: string`，必填，固定为 `client_credential`
  - `appid: string`，必填
  - `secret: string`，必填
  - `force_refresh: boolean`，可选，默认 `false`
- 成功返回：`access_token: string`、`expires_in: number`
- 官方说明有效期为 7200 秒以内；普通模式在有效期内重复获取不更新 token，并会提前 5 分钟更新。
- 频率：每分钟 10,000 次、每天 500,000 次；强制刷新每天 20 次，且两次至少间隔 30 秒。
- 存储：官方要求至少预留 512 字符。
- 稳定版 token 与普通 `getAccessToken` token 完全隔离、互不影响。

MPForge 的 `obtainAccessToken` 应默认使用普通模式的稳定版接口，不应自动使用 `force_refresh: true`。凭据只能从服务端环境或凭据管理器读取；请求和响应日志必须脱敏。

### 3.2 兼容：普通接口

- 方法与地址：`GET https://api.weixin.qq.com/cgi-bin/token`
- Query：`appid`、`secret`、`grant_type=client_credential`，均必填。
- 成功返回：`access_token`、`expires_in`。
- 官方明确推荐改用稳定版接口。
- `AppSecret` 可在管理端冻结；冻结后该接口返回 `40243`。

由于普通接口把 `secret` 放入查询字符串，适配器即使保留兼容能力，也不得把完整 URL 写入日志、错误、收据或跟踪事件。

## 4. 正文图片上传契约

- 方法与地址：`POST https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=ACCESS_TOKEN`
- 请求：`multipart/form-data`，字段 `media`，必填图片文件。
- 成功返回：`url: string`；官方示例同时返回 `errcode: 0`、`errmsg: "ok"`。
- 格式与大小：仅 `jpg` / `png`，小于 1 MB。
- 配额：不占公众号素材库图片数量 100,000 的限制。
- 用途：草稿正文中的图片 URL 必须来自该接口；草稿接口会过滤外部图片 URL。
- 接口专属错误：`40005`（文件格式不合法）、`40009`（图片尺寸/大小过大）。

`uploadBodyImage` 的结果契约应以微信返回的 `url` 为正文替换值；不可把本地文件路径或任意远程图片 URL直接写入最终草稿正文。

## 5. 永久素材／封面上传契约

- 方法与地址：`POST https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=ACCESS_TOKEN&type=TYPE`
- Query：`access_token` 必填；`type` 必填，可取 `image`、`voice`、`video`、`thumb`。
- 请求：`multipart/form-data`，字段 `media` 必填；视频可附带 `description` 对象（`title`、`introduction`）。
- 成功返回：`media_id: string`；图片额外返回 `url: string`。
- 图片：最大 10 MB，支持 `bmp/png/jpeg/jpg/gif`。
- 缩略图：最大 64 KB，仅 `JPG`。
- 官方素材库上限原文为“图文消息素材、图片素材上限为 100000，其他类型为 1000”。
- 永久图片返回 URL 只允许在腾讯系域名内使用，腾讯系域名外会被屏蔽。
- 接口专属错误：`40007`（无效媒体 ID）。

草稿的 `thumb_media_id` 官方只要求“必须是永久 MediaID”。当前页面没有明确说明该字段必须来自 `type=image` 还是 `type=thumb`。因此 `uploadCoverMaterial` 必须把所用类型显式记录在能力与操作计划中，并由真实账号 doctor/preflight 验证，不能把字段名中的 `thumb` 当作官方已确认的素材类型要求。

## 6. 新增草稿契约

- 方法与地址：`POST https://api.weixin.qq.com/cgi-bin/draft/add?access_token=ACCESS_TOKEN`
- 请求体：`articles` 对象数组，必填。
- 成功返回：`media_id: string`，官方说明不超过 128 字符。
- 新增后可在公众平台官网草稿箱查看和管理；草稿被群发或发布后会从草稿箱移除。

### 6.1 `articles[]` 当前字段

| 字段                    | 类型   | 必填           | 官方约束                                                                                                                       |
| ----------------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `article_type`          | string | 否             | `news` 或 `newspic`，默认 `news`                                                                                               |
| `title`                 | string | 是             | 不超过 32 个字；不要传 `\uXXXX` 形式文本                                                                                       |
| `author`                | string | 否             | 不超过 16 个字；不要传 `\uXXXX` 形式文本                                                                                       |
| `digest`                | string | 否             | 不超过 120 个字；仅单图文有摘要；未填时默认取正文前 54 个字                                                                    |
| `content`               | string | 是             | 支持 HTML；去除 JS；少于 20,000 字符且小于 1 MB；外部图片 URL 被过滤。官方同一字段还写有“大小不可超过 2kb”，见第 10 节冲突说明 |
| `content_source_url`    | string | 否             | 原文链接，小于 1 KB                                                                                                            |
| `thumb_media_id`        | string | `news` 时是    | 封面永久 MediaID                                                                                                               |
| `need_open_comment`     | number | 否             | `0` 关闭（默认），`1` 打开                                                                                                     |
| `only_fans_can_comment` | number | 否             | `0` 所有人（默认），`1` 仅粉丝                                                                                                 |
| `image_info`            | object | `newspic` 时是 | 图片消息最多 20 张，首张为封面                                                                                                 |
| `cover_info`            | object | 否             | 封面裁剪信息                                                                                                                   |
| `product_info`          | object | 否             | 商品信息；MPForge Round 3 不需要发送此字段                                                                                     |

`image_info.image_list[]` 的 `image_media_id` 必填，且必须为永久 MediaID。

`cover_info.crop_percent_list[]` 可包含 `ratio`、`x1`、`y1`、`x2`、`y2` 字符串坐标。`news` 支持 `2.35_1`、`1_1`；`newspic` 支持 `1_1`、`16_9`、`2.35_1`。坐标系左上为 `(0,0)`、右下为 `(1,1)`。

当前新增草稿页列出的专属错误为：`53404`（账号已被限制带货能力）、`53405`（商品信息有误）、`53406`（未开通带货能力）。这些只在发送商品信息时相关；MPForge 不应因此误判普通文章草稿创建成功。

## 7. 获取草稿详情契约

- 方法与地址：`POST https://api.weixin.qq.com/cgi-bin/draft/get?access_token=ACCESS_TOKEN`
- 请求 JSON：`media_id: string`，必填。
- 返回：`news_item[]`；字段包含新增草稿中的文章字段以及 `url`（草稿临时链接）。
- 专属错误：`40007`（无效 `media_id`）。

详情查询可用于创建后的确认，但官方只提供已知 `media_id` 的精确查询；它不能单独解决“创建请求已送达但响应丢失”时不知道 `media_id` 的情形。

## 8. 获取草稿列表契约

- 方法与地址：`POST https://api.weixin.qq.com/cgi-bin/draft/batchget?access_token=ACCESS_TOKEN`
- 请求 JSON：
  - `offset: number`，必填，`0` 从第一条开始
  - `count: number`，必填，范围 `1..20`
  - `no_content: number`，可选，`1` 不返回 `content`；`0` 正常返回，默认 `0`
- 返回：
  - `total_count: number`
  - `item_count: number`
  - `item[]`，每项含 `media_id`、`content.news_item[]`、`update_time`
- 页面列出的成功码：`0`。

`listDrafts` / `findPossibleDraft` 做对账时必须显式分页，单页最多 20 条。官方未承诺列表排序，也未提供客户端幂等键或按客户端标识查询；因此标题、正文摘要、封面或时间近似匹配只能形成候选，不能把多候选自动确认为已创建。

## 9. 相关错误码与处理分类

下表只收录本流水线需要分类的官方错误；完整集合以[全局错误码](https://developers.weixin.qq.com/doc/oplatform/developers/errCode/)为准。

| 错误码  | 官方含义                                  | 适配器建议分类                                                            |
| ------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| `-1`    | 系统繁忙                                  | 可重试，但创建草稿响应不确定时先进入 `UNKNOWN_REMOTE_STATE`，不得直接重建 |
| `40001` | AppSecret 错误或 access_token 无效/非最新 | 凭据失败；刷新 token 后只重试可证明未产生副作用的步骤                     |
| `40002` | `grant_type` 不合法                       | 配置/请求错误，不重试                                                     |
| `40005` | 上传文件格式不对                          | 输入错误，不重试                                                          |
| `40007` | 无效媒体 ID                               | 素材/草稿标识错误，不重试                                                 |
| `40009` | 图片过大                                  | 输入错误，不重试                                                          |
| `40013` | AppID 不合法                              | 配置错误，不重试                                                          |
| `40014` | access_token 不合法                       | 凭据失败                                                                  |
| `40125` | AppSecret 不合法                          | 配置错误；绝不回显 secret                                                 |
| `40164` | 调用 IP 不在白名单                        | 账号配置错误，不重试                                                      |
| `40243` | AppSecret 已冻结                          | 账号配置错误，不重试                                                      |
| `41001` | 缺少 access_token                         | 实现错误，不重试                                                          |
| `41004` | 缺少 secret                               | 配置错误，不重试                                                          |
| `41005` | 缺少多媒体文件                            | 请求错误，不重试                                                          |
| `41006` | 缺少 media_id                             | 请求错误，不重试                                                          |
| `42001` | access_token 过期                         | 刷新 token；对副作用步骤仍须遵守不确定状态规则                            |
| `43002` | 要求 POST                                 | 实现错误，不重试                                                          |
| `44002` | POST 数据为空                             | 实现错误，不重试                                                          |
| `44003` | 图文消息为空                              | 输入错误，不重试                                                          |
| `45001` | 多媒体文件超过限制                        | 输入错误，不重试                                                          |
| `45002` | 内容超过限制                              | 输入错误，不重试                                                          |
| `45003` | 标题超过限制                              | 输入错误，不重试                                                          |
| `45005` | URL 超过限制                              | 输入错误，不重试                                                          |
| `45008` | 图文消息超过限制                          | 输入错误，不重试                                                          |
| `45009` | 超过日调用额度                            | 限流；延后重试，不得绕过                                                  |
| `45011` | 超过分钟调用额度                          | 限流；按服务端策略退避                                                    |
| `48001` | API 未授权                                | 权限错误，不重试                                                          |
| `48004` | API 因违规被封禁                          | 账号限制，不重试                                                          |
| `50002` | 用户受限                                  | 账号限制，不重试                                                          |
| `53404` | 账号带货能力受限                          | 仅商品字段相关；不应自动删除或改变用户内容                                |
| `53405` | 商品信息有误                              | 仅商品字段相关                                                            |
| `53406` | 未开通带货能力                            | 仅商品字段相关                                                            |

稳定版 token 页面还列出 `89503`（需管理员确认）、`89506`（管理员拒绝，24 小时后再试）、`89507`（管理员拒绝，1 小时后再试）。这些必须作为人工/账号侧状态呈现，不得通过程序绕过。

## 10. 官方文档仍不明确或互相冲突的点

1. `draft_add.content` 同一字段描述同时出现“大小不可超过 2kb”“少于 2 万字符”“小于 1M”。这三个阈值并不等价。实现应把 20,000 字符与 1 MB 作为显式校验，同时将 2 KB 文案冲突标为 `doctor` 警告；真实账号验证前不能声称最终上限已确定。
2. `articles` 数组的最大文章数在当前新增草稿页面没有给出。
3. `thumb_media_id` 只明确要求永久 MediaID，未明确永久素材上传时应选 `type=image` 还是 `type=thumb`。
4. 草稿列表的排序规则、`update_time` 单位、时钟精度没有在当前页面明确说明。
5. 草稿详情返回的“临时链接”有效期没有说明。
6. 草稿新增、详情、列表、正文图片和永久素材接口没有在各自页面公布专属 QPS/日配额；不能把稳定版 token 的频率上限套用到这些接口。
7. 新增草稿没有客户端请求 ID、幂等键或按客户端标识查询字段。网络超时或连接中断后，官方契约无法证明请求是否落地，必须进入 `UNKNOWN_REMOTE_STATE` 并通过列表候选人工/严格规则对账。
8. 当前新增草稿页面没有定义正文允许的完整 HTML 标签/属性白名单，只说明支持 HTML、移除 JS、过滤外部图片 URL；本地 sanitizer 只能按保守白名单工作，不能声称与微信服务端过滤器完全等价。
9. 永久素材上限原文未清楚说明“图文消息素材”和“图片素材”的 100,000 是分别计数还是合并计数。
10. 账号适用表并不能替代真实账号权限查询；在没有真实账号且没有显式用户授权调用时，只能报告 `LIVE_ACCOUNT_NOT_TESTED`。

## 11. 对 MPForge Round 3 的契约结论

- 可在不触发真实接口的情况下实现并验证：请求构造、字段校验、服务端凭据边界、响应解析、脱敏、mock 行为、错误分类、幂等账本、`UNKNOWN_REMOTE_STATE` 与对账状态机。
- 生产适配器应只暴露本轮允许的能力：`getCapabilities`、`validateConfiguration`、`obtainAccessToken`、`uploadBodyImage`、`uploadCoverMaterial`、`createDraft`、`getDraft`、`listDrafts`、`findPossibleDraft`、`sanitizeRequest`、`sanitizeResponse`。
- 真实创建草稿是外部副作用；官方接口本身不提供幂等键。执行前必须绑定不可变快照、账号别名和一次性人工确认；创建请求返回不确定时不得自动重复调用。
- 正文图片与封面是两类不同上传：正文图片取回 `url` 后替换 HTML；封面取回永久 `media_id` 后填入 `thumb_media_id`。
- 仅依据官方文档和本次离线契约核验，可声明 `REAL_ADAPTER_CONTRACT_VERIFIED`；没有真实账号调用证据时必须同时声明 `LIVE_ACCOUNT_NOT_TESTED`，不得声明真实草稿已验证。
