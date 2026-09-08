# WeChat compatibility simulation

MPForge's deterministic renderer and linter evaluate an article in three
explicit stages:

1. `article.raw.html` — renderer output before the Round 2 safety stage.
2. `article.safe.html` — active/unsafe constructs removed by MPForge.
3. `article.wechat.html` — conservative local downgrade for constructs likely
   to be removed or changed by WeChat.

The stages are saved separately so a reviewer can see whether cleanup removed
meaningful content. The final stage has its own SHA-256 and is never substituted
silently for the source.

Checks cover active HTML, event attributes, JavaScript/data URLs, unsupported or
unknown elements, unsafe CSS, fixed/oversized/negative-positioned layouts,
remote script/font/style/background dependencies, missing image constraints,
code/table/image overflow, dark-mode contrast, and content whose meaning may be
lost by downgrade.

Preview reports use 375 px and 402 px mobile widths in light and dark modes.
They record horizontal overflow and responsible elements, missing images,
contrast warnings, console/page errors and the exact source/build hashes.
Screenshot differences are supporting evidence, never the sole failure signal.

Every simulated preview displays:

> 微信兼容模拟预览，最终效果仍应在公众号草稿箱中人工确认。

The simulator does not claim byte-for-byte or pixel-for-pixel equivalence with
any current WeChat client. Platform facts and verification dates are maintained
in [wechat-compatibility-sources.md](wechat-compatibility-sources.md).
