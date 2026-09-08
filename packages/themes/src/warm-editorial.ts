import { warmEditorialPreviewFixture } from "./previewFixtures";
import { SUPPORTED_THEME_ELEMENTS, type ThemeDefinition } from "./types";

const warmLight = `
#wemd { box-sizing:border-box; max-width:677px; margin:0 auto; padding:14px 22px; color:#40362f; background:transparent; font-family:"Georgia","Songti SC","STSong","Microsoft YaHei",serif; font-size:16px; line-height:1.88; overflow-wrap:anywhere; }
#wemd p { margin:0 0 21px; color:#40362f; line-height:1.88; }
#wemd h1,#wemd h2,#wemd h3,#wemd h4,#wemd h5,#wemd h6 { color:#332822; line-height:1.45; text-wrap:balance; }
#wemd h1 { margin:20px 0 38px; padding:18px 0 12px; border-top:4px solid #ad5d43; border-bottom:1px solid #d8b8a5; font-size:29px; }
#wemd h2 { margin:40px 0 17px; padding-bottom:8px; border-bottom:2px solid #d8b8a5; font-size:22px; } #wemd h3 { margin:29px 0 12px; color:#9b503b; font-size:18px; } #wemd h4,#wemd h5,#wemd h6 { margin:23px 0 9px; font-size:16px; }
#wemd ul,#wemd ol { margin:14px 0 22px; padding-left:25px; color:#9b503b; } #wemd li { margin:6px 0; } #wemd li section { color:#40362f; }
#wemd blockquote,#wemd .multiquote-1,#wemd .multiquote-2,#wemd .multiquote-3 { margin:25px 0; padding:15px 18px; border-top:2px solid #b98a61; border-bottom:1px solid #ddc7b4; background:#f7efe7; color:#665145; } #wemd .multiquote-1 p,#wemd .multiquote-2 p,#wemd .multiquote-3 p { margin:0; color:#665145; }
#wemd a { color:#9b503b; text-decoration:underline; text-decoration-color:#c58a73; } #wemd strong { color:#332822; } #wemd em { color:#665145; } #wemd del { color:#88766b; } #wemd mark { padding:1px 3px; color:#40362f; background:#f2dfac; }
#wemd hr { height:1px; margin:34px auto; width:28%; border:0; background:#b98a61; }
#wemd pre { max-width:100%; margin:22px 0; overflow:auto; border:1px solid #d8b8a5; background:#f3ebe3; } #wemd pre code,#wemd pre code.hljs { display:block; min-width:max-content; padding:15px; color:#40362f; background:#f3ebe3; font:13px/1.65 Consolas,monospace; white-space:pre; }
#wemd p code,#wemd li code { padding:2px 5px; color:#874630; background:#f4e4d8; border:1px solid #dec1af; font:0.9em Consolas,monospace; }
#wemd figure { max-width:100%; margin:27px 0; break-inside:avoid; text-align:center; } #wemd img { display:block; max-width:100%; height:auto; margin:0 auto; } #wemd figcaption { margin-top:9px; color:#88766b; font-size:13px; }
#wemd .table-container { max-width:100%; overflow-x:auto; } #wemd table { width:100%; border-collapse:collapse; margin:24px 0; color:#40362f; background:#fffaf5; } #wemd th,#wemd td { padding:9px 10px; border-bottom:1px solid #ddc7b4; text-align:left; } #wemd th { color:#fffaf5; background:#9b503b; } #wemd tr:nth-child(even) { background:#f7efe7; }
#wemd .callout { margin:24px 0; padding:15px 18px; border:1px solid #ddc7b4; border-left:4px solid #ad5d43; border-radius:0; color:#40362f; background:#fffaf5; } #wemd .callout-title { margin-bottom:8px; color:#874630; font-weight:700; }
#wemd .footnotes-sep { margin-top:40px; border-top:1px solid #d8b8a5; } #wemd .footnotes-sep:before { content:"Notes"; display:block; margin-top:11px; color:#874630; font-weight:700; } #wemd .footnote-word,#wemd .footnote-ref { color:#9b503b; } #wemd .footnote-item { display:flex; } #wemd .footnote-num { min-width:30px; color:#88766b; }
#wemd .block-equation { max-width:100%; margin:24px 0; overflow:auto; text-align:center; } #wemd .block-equation > svg { max-width:100% !important; } #wemd .inline-equation > svg { max-width:100%; vertical-align:middle; } #wemd pre.mermaid { max-width:100%; overflow:auto; background:#fffaf5; }
#wemd .task-list-item { display:flex; gap:7px; align-items:flex-start; list-style:none; margin-left:-1.2em; } #wemd .task-list-item input { margin-top:5px; pointer-events:none; }
`;
const warmDark = warmLight
  .replace(/#(?:fffaf5|f3ebe3|f7efe7|f4e4d8|ffffff|fff)/gi, "#302621")
  .replace(/#40362f/g, "#eadbd0")
  .replace(/#332822/g, "#f7e9df")
  .replace(/#665145/g, "#d2bbb0")
  .replace(/#88766b/g, "#ad9387")
  .replace(/#9b503b/g, "#e18d6d")
  .replace(/#ad5d43/g, "#c9795d")
  .replace(/#b98a61/g, "#ba8a6d")
  .replace(/#d8b8a5/g, "#60483e")
  .replace(/#ddc7b4/g, "#59443a")
  .replace(/#dec1af/g, "#60483e")
  .replace(/#f7efe7/g, "#302621")
  .replace(/#fff/g, "#eadbd0");
export const warmEditorialTheme: ThemeDefinition = {
  id: "warm-editorial",
  name: "Warm Editorial",
  description:
    "Warm paper and clay accents for essays, culture, photography, and reflective narratives.",
  version: "1.0.0",
  author: "MPForge Contributors",
  license: "MIT",
  primaryColor: "#ad5d43",
  darkPrimaryColor: "#c9795d",
  supportedElements: SUPPORTED_THEME_ELEMENTS,
  mobileFallbacks: [
    "677px bounded canvas with border-box padding",
    "decorative rules remain simple solid borders",
    "images shrink without cropping",
    "tables and preformatted text scroll when needed",
  ],
  previewFixture: warmEditorialPreviewFixture,
  lightCss: warmLight,
  darkCss: warmDark,
};
