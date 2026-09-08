import { minimalPreviewFixture } from "./previewFixtures";
import { SUPPORTED_THEME_ELEMENTS, type ThemeDefinition } from "./types";

const minimalLight = `
#wemd { box-sizing:border-box; max-width:677px; margin:0 auto; padding:8px 20px; color:#27302d; background:transparent; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif; font-size:16px; line-height:1.78; overflow-wrap:anywhere; }
#wemd p { margin:0 0 18px; color:#27302d; line-height:1.78; }
#wemd h1,#wemd h2,#wemd h3,#wemd h4,#wemd h5,#wemd h6 { color:#15201c; line-height:1.45; text-wrap:balance; }
#wemd h1 { margin:20px 0 30px; padding-bottom:12px; border-bottom:2px solid #3f6655; font-size:28px; }
#wemd h2 { margin:34px 0 15px; padding-bottom:7px; border-bottom:1px solid #b8c9c0; font-size:21px; }
#wemd h3 { margin:26px 0 11px; padding-left:10px; border-left:3px solid #3f6655; font-size:18px; }
#wemd h4,#wemd h5,#wemd h6 { margin:22px 0 9px; font-size:16px; }
#wemd ul,#wemd ol { margin:12px 0 20px; padding-left:24px; color:#3f6655; }
#wemd li { margin:5px 0; padding-left:4px; line-height:1.7; }
#wemd li section { color:#27302d; }
#wemd blockquote,#wemd .multiquote-1,#wemd .multiquote-2,#wemd .multiquote-3 { margin:22px 0; padding:12px 16px; border-left:3px solid #94a99d; background:#f2f5f3; color:#43534b; }
#wemd .multiquote-1 p,#wemd .multiquote-2 p,#wemd .multiquote-3 p { margin:0; color:#43534b; }
#wemd a { color:#2f6751; text-decoration:underline; text-underline-offset:2px; }
#wemd strong { color:#15201c; font-weight:700; }
#wemd em { color:#34423b; } #wemd del { color:#68756f; } #wemd mark { padding:1px 3px; background:#e6eee9; color:#27302d; }
#wemd hr { height:1px; margin:30px 0; border:0; background:#b8c9c0; }
#wemd pre { max-width:100%; margin:20px 0; overflow:auto; background:#f3f5f4; border:1px solid #d5dfda; }
#wemd pre code,#wemd pre code.hljs { display:block; min-width:max-content; padding:14px; color:#27302d; background:#f3f5f4; font:13px/1.65 Consolas,Monaco,monospace; white-space:pre; }
#wemd p code,#wemd li code { padding:2px 5px; color:#2f6751; background:#eaf1ed; border:1px solid #d5dfda; font:0.9em Consolas,Monaco,monospace; }
#wemd figure { max-width:100%; margin:24px 0; break-inside:avoid; text-align:center; } #wemd img { display:block; max-width:100%; height:auto; margin:0 auto; } #wemd figcaption { margin-top:8px; color:#68756f; font-size:13px; }
#wemd .table-container { max-width:100%; overflow-x:auto; } #wemd table { width:100%; border-collapse:collapse; margin:22px 0; color:#27302d; background:#fff; } #wemd th,#wemd td { padding:8px 10px; border:1px solid #c9d5cf; text-align:left; } #wemd th { color:#15201c; background:#edf3ef; font-weight:700; } #wemd tr:nth-child(even) { background:#f8faf9; }
#wemd .callout { margin:22px 0; padding:14px 16px; border:1px solid #c9d5cf; border-left:3px solid #3f6655; border-radius:0; color:#27302d; background:#f8faf9; } #wemd .callout-title { margin-bottom:7px; font-weight:700; }
#wemd .footnotes-sep { margin-top:36px; border-top:1px solid #b8c9c0; } #wemd .footnotes-sep:before { content:"参考资料"; display:block; margin-top:12px; font-weight:700; } #wemd .footnote-word,#wemd .footnote-ref { color:#2f6751; } #wemd .footnote-item { display:flex; } #wemd .footnote-num { min-width:28px; color:#68756f; }
#wemd .block-equation { max-width:100%; margin:22px 0; overflow:auto; text-align:center; } #wemd .block-equation > svg { max-width:100% !important; } #wemd .inline-equation > svg { max-width:100%; vertical-align:middle; } #wemd pre.mermaid { max-width:100%; overflow:auto; background:#f8faf9; }
#wemd .task-list-item { display:flex; gap:7px; align-items:flex-start; list-style:none; margin-left:-1.2em; } #wemd .task-list-item input { margin-top:5px; pointer-events:none; }
`;

const minimalDark = minimalLight
  .replace(
    /#(?:f8faf9|f3f5f4|f2f5f3|edf3ef|edf3ef|eaf1ed|f8faf9|ffffff|fff|f3f5f4|f8faf9|f2f5f3|e6eee9)/gi,
    "#202624",
  )
  .replace(/#27302d/g, "#d8e1dc")
  .replace(/#15201c/g, "#f2f7f4")
  .replace(/#43534b/g, "#c2cec7")
  .replace(/#68756f/g, "#9eaca4")
  .replace(/#2f6751/g, "#7ed1a8")
  .replace(/#3f6655/g, "#77b994")
  .replace(/#94a99d/g, "#719681")
  .replace(/#b8c9c0/g, "#43564b")
  .replace(/#c9d5cf/g, "#43564b")
  .replace(/#d5dfda/g, "#3d4a42")
  .replace(/#eaf1ed/g, "#263b31")
  .replace(/#edf3ef/g, "#263b31")
  .replace(/#f8faf9/g, "#202624")
  .replace(/#fff/g, "#202624");

export const minimalTheme: ThemeDefinition = {
  id: "minimal",
  name: "Minimal",
  description:
    "Neutral spacing and restrained evergreen accents for general long-form reading.",
  version: "1.0.0",
  author: "MPForge Contributors",
  license: "MIT",
  primaryColor: "#3f6655",
  darkPrimaryColor: "#77b994",
  supportedElements: SUPPORTED_THEME_ELEMENTS,
  mobileFallbacks: [
    "677px bounded canvas with border-box padding",
    "images shrink to the available width",
    "tables and code blocks scroll horizontally",
    "long words wrap without widening the article",
  ],
  previewFixture: minimalPreviewFixture,
  lightCss: minimalLight,
  darkCss: minimalDark,
};
