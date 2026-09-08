import { techDarkAccentPreviewFixture } from "./previewFixtures";
import { SUPPORTED_THEME_ELEMENTS, type ThemeDefinition } from "./types";

const techLight = `
#wemd { box-sizing:border-box; max-width:677px; margin:0 auto; padding:12px 20px; color:#233047; background:transparent; font-family:Inter,-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif; font-size:15px; line-height:1.72; overflow-wrap:anywhere; }
#wemd p { margin:0 0 17px; color:#233047; line-height:1.72; } #wemd h1,#wemd h2,#wemd h3,#wemd h4,#wemd h5,#wemd h6 { color:#17244d; line-height:1.4; text-wrap:balance; }
#wemd h1 { margin:20px 0 31px; padding:16px 18px; border-left:5px solid #5b5ce2; background:#eef0ff; font-size:28px; } #wemd h2 { margin:36px 0 14px; padding-bottom:7px; border-bottom:2px solid #5b5ce2; font:700 20px/1.4 Consolas,monospace; } #wemd h3 { margin:26px 0 10px; color:#008a9a; font:700 17px/1.4 Consolas,monospace; } #wemd h4,#wemd h5,#wemd h6 { margin:20px 0 8px; font-size:15px; }
#wemd ul,#wemd ol { margin:12px 0 20px; padding-left:24px; color:#5b5ce2; } #wemd li { margin:5px 0; } #wemd li section { color:#233047; }
#wemd blockquote,#wemd .multiquote-1,#wemd .multiquote-2,#wemd .multiquote-3 { margin:22px 0; padding:13px 16px; border:1px solid #bcc4f0; border-left:4px solid #5b5ce2; background:#f4f5ff; color:#44506b; } #wemd .multiquote-1 p,#wemd .multiquote-2 p,#wemd .multiquote-3 p { margin:0; color:#44506b; }
#wemd a { color:#4d51c7; text-decoration:underline; } #wemd strong { color:#17244d; } #wemd em { color:#405275; } #wemd del { color:#74819b; } #wemd mark { padding:1px 3px; color:#233047; background:#d8f4f5; }
#wemd hr { height:2px; margin:30px 0; border:0; background:#5b5ce2; }
#wemd pre { max-width:100%; margin:20px 0; overflow:auto; border:1px solid #3d4678; background:#17213a; } #wemd pre code,#wemd pre code.hljs { display:block; min-width:max-content; padding:15px; color:#e9eeff; background:#17213a; font:13px/1.6 Consolas,monospace; white-space:pre; }
#wemd p code,#wemd li code { padding:2px 5px; color:#4d51c7; background:#eef0ff; border:1px solid #c3c7f0; font:0.9em Consolas,monospace; }
#wemd figure { max-width:100%; margin:24px 0; break-inside:avoid; text-align:center; } #wemd img { display:block; max-width:100%; height:auto; margin:0 auto; } #wemd figcaption { margin-top:8px; color:#74819b; font-size:13px; }
#wemd .table-container { max-width:100%; overflow-x:auto; } #wemd table { width:100%; border-collapse:collapse; margin:22px 0; color:#233047; background:#fff; } #wemd th,#wemd td { padding:8px 9px; border:1px solid #bcc4f0; text-align:left; } #wemd th { color:#fff; background:#39408a; } #wemd tr:nth-child(even) { background:#f4f5ff; }
#wemd .callout { margin:22px 0; padding:14px 16px; border:1px solid #bcc4f0; border-left:4px solid #008a9a; border-radius:0; color:#233047; background:#f4f5ff; } #wemd .callout-title { margin-bottom:7px; color:#008a9a; font:700 13px/1.4 Consolas,monospace; }
#wemd .footnotes-sep { margin-top:36px; border-top:1px solid #bcc4f0; } #wemd .footnotes-sep:before { content:"Telemetry"; display:block; margin-top:11px; color:#4d51c7; font:700 13px Consolas,monospace; } #wemd .footnote-word,#wemd .footnote-ref { color:#4d51c7; } #wemd .footnote-item { display:flex; } #wemd .footnote-num { min-width:30px; color:#74819b; }
#wemd .block-equation { max-width:100%; margin:22px 0; overflow:auto; text-align:center; } #wemd .block-equation > svg { max-width:100% !important; } #wemd .inline-equation > svg { max-width:100%; vertical-align:middle; } #wemd pre.mermaid { max-width:100%; overflow:auto; background:#17213a; }
#wemd .task-list-item { display:flex; gap:7px; align-items:flex-start; list-style:none; margin-left:-1.2em; } #wemd .task-list-item input { margin-top:5px; pointer-events:none; }
`;
const techDark = `
#wemd { box-sizing:border-box; max-width:677px; margin:0 auto; padding:12px 20px; color:#d8e2ff; background:transparent; font-family:Inter,-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif; font-size:15px; line-height:1.72; overflow-wrap:anywhere; }
#wemd p { margin:0 0 17px; color:#d8e2ff; line-height:1.72; } #wemd h1,#wemd h2,#wemd h3,#wemd h4,#wemd h5,#wemd h6 { color:#f1f4ff; line-height:1.4; text-wrap:balance; }
#wemd h1 { margin:20px 0 31px; padding:16px 18px; border-left:5px solid #8d8fff; background:#222a51; font-size:28px; } #wemd h2 { margin:36px 0 14px; padding-bottom:7px; border-bottom:2px solid #8d8fff; font:700 20px/1.4 Consolas,monospace; } #wemd h3 { margin:26px 0 10px; color:#62dbe5; font:700 17px/1.4 Consolas,monospace; } #wemd h4,#wemd h5,#wemd h6 { margin:20px 0 8px; font-size:15px; }
#wemd ul,#wemd ol { margin:12px 0 20px; padding-left:24px; color:#8d8fff; } #wemd li { margin:5px 0; } #wemd li section { color:#d8e2ff; }
#wemd blockquote,#wemd .multiquote-1,#wemd .multiquote-2,#wemd .multiquote-3 { margin:22px 0; padding:13px 16px; border:1px solid #46517e; border-left:4px solid #8d8fff; background:#202944; color:#b9c5e6; } #wemd .multiquote-1 p,#wemd .multiquote-2 p,#wemd .multiquote-3 p { margin:0; color:#b9c5e6; }
#wemd a { color:#9da0ff; text-decoration:underline; } #wemd strong { color:#f1f4ff; } #wemd em { color:#c0cef1; } #wemd del { color:#8e9abc; } #wemd mark { padding:1px 3px; color:#d8e2ff; background:#174752; }
#wemd hr { height:2px; margin:30px 0; border:0; background:#8d8fff; }
#wemd pre { max-width:100%; margin:20px 0; overflow:auto; border:1px solid #46517e; background:#101629; } #wemd pre code,#wemd pre code.hljs { display:block; min-width:max-content; padding:15px; color:#dce5ff; background:#101629; font:13px/1.6 Consolas,monospace; white-space:pre; }
#wemd p code,#wemd li code { padding:2px 5px; color:#9da0ff; background:#222a51; border:1px solid #46517e; font:0.9em Consolas,monospace; }
#wemd figure { max-width:100%; margin:24px 0; break-inside:avoid; text-align:center; } #wemd img { display:block; max-width:100%; height:auto; margin:0 auto; } #wemd figcaption { margin-top:8px; color:#8e9abc; font-size:13px; }
#wemd .table-container { max-width:100%; overflow-x:auto; } #wemd table { width:100%; border-collapse:collapse; margin:22px 0; color:#d8e2ff; background:#182039; } #wemd th,#wemd td { padding:8px 9px; border:1px solid #46517e; text-align:left; } #wemd th { color:#fff; background:#39408a; } #wemd tr:nth-child(even) { background:#202944; }
#wemd .callout { margin:22px 0; padding:14px 16px; border:1px solid #46517e; border-left:4px solid #62dbe5; border-radius:0; color:#d8e2ff; background:#202944; } #wemd .callout-title { margin-bottom:7px; color:#62dbe5; font:700 13px/1.4 Consolas,monospace; }
#wemd .footnotes-sep { margin-top:36px; border-top:1px solid #46517e; } #wemd .footnotes-sep:before { content:"Telemetry"; display:block; margin-top:11px; color:#9da0ff; font:700 13px Consolas,monospace; } #wemd .footnote-word,#wemd .footnote-ref { color:#9da0ff; } #wemd .footnote-item { display:flex; } #wemd .footnote-num { min-width:30px; color:#8e9abc; }
#wemd .block-equation { max-width:100%; margin:22px 0; overflow:auto; text-align:center; } #wemd .block-equation > svg { max-width:100% !important; } #wemd .inline-equation > svg { max-width:100%; vertical-align:middle; } #wemd pre.mermaid { max-width:100%; overflow:auto; background:#101629; }
#wemd .task-list-item { display:flex; gap:7px; align-items:flex-start; list-style:none; margin-left:-1.2em; } #wemd .task-list-item input { margin-top:5px; pointer-events:none; }
`;
export const techDarkAccentTheme: ThemeDefinition = {
  id: "tech-dark-accent",
  name: "Tech Dark Accent",
  description:
    "A light reading canvas with focused dark code surfaces and precise violet-cyan accents.",
  version: "1.0.0",
  author: "MPForge Contributors",
  license: "MIT",
  primaryColor: "#5b5ce2",
  darkPrimaryColor: "#8d8fff",
  supportedElements: SUPPORTED_THEME_ELEMENTS,
  mobileFallbacks: [
    "formal light output keeps a transparent article background",
    "dark emphasis is limited to headings, code, and callouts",
    "tables and code blocks scroll horizontally",
    "monospace headings fall back to platform monospace",
  ],
  previewFixture: techDarkAccentPreviewFixture,
  lightCss: techLight,
  darkCss: techDark,
};
