import { academicBluePreviewFixture } from "./previewFixtures";
import { SUPPORTED_THEME_ELEMENTS, type ThemeDefinition } from "./types";

const academicLight = `
#wemd { box-sizing:border-box; max-width:677px; margin:0 auto; padding:10px 22px; color:#24364d; background:transparent; font-family:"Times New Roman","Songti SC","SimSun",serif; font-size:16px; line-height:1.75; overflow-wrap:anywhere; }
#wemd p { margin:0 0 17px; color:#24364d; line-height:1.75; text-align:justify; }
#wemd h1,#wemd h2,#wemd h3,#wemd h4,#wemd h5,#wemd h6 { color:#123a67; line-height:1.45; text-wrap:balance; }
#wemd h1 { margin:28px 0 34px; padding-bottom:13px; border-bottom:3px solid #123a67; text-align:center; font-size:27px; }
#wemd h2 { margin:36px 0 15px; padding-bottom:6px; border-bottom:1px solid #7896b3; font-size:21px; }
#wemd h3 { margin:26px 0 10px; font-size:18px; } #wemd h4,#wemd h5,#wemd h6 { margin:20px 0 8px; font-size:16px; }
#wemd ul,#wemd ol { margin:12px 0 18px; padding-left:25px; color:#20588f; } #wemd li { margin:5px 0; } #wemd li section { color:#24364d; }
#wemd blockquote,#wemd .multiquote-1,#wemd .multiquote-2,#wemd .multiquote-3 { margin:22px 0; padding:13px 17px; border-left:4px solid #7896b3; background:#eef4fa; color:#3a516a; } #wemd .multiquote-1 p,#wemd .multiquote-2 p,#wemd .multiquote-3 p { margin:0; color:#3a516a; }
#wemd a { color:#174f86; text-decoration:underline; } #wemd strong { color:#123a67; } #wemd em { color:#304c69; } #wemd del { color:#657b91; } #wemd mark { padding:1px 3px; color:#24364d; background:#fff0b8; }
#wemd hr { height:1px; margin:31px 0; border:0; background:#7896b3; }
#wemd pre { max-width:100%; margin:20px 0; overflow:auto; border:1px solid #9eb5cb; background:#f2f6fa; } #wemd pre code,#wemd pre code.hljs { display:block; min-width:max-content; padding:14px; color:#24364d; background:#f2f6fa; font:13px/1.6 Consolas,monospace; white-space:pre; }
#wemd p code,#wemd li code { padding:2px 5px; color:#174f86; background:#e9f0f7; border:1px solid #c5d4e1; font:0.9em Consolas,monospace; }
#wemd figure { max-width:100%; margin:24px 0; break-inside:avoid; text-align:center; } #wemd img { display:block; max-width:100%; height:auto; margin:0 auto; border:1px solid #c5d4e1; } #wemd figcaption { margin-top:8px; color:#657b91; font-size:13px; font-style:italic; }
#wemd .table-container { max-width:100%; overflow-x:auto; } #wemd table { width:100%; border-collapse:collapse; margin:22px 0; border-top:2px solid #123a67; border-bottom:2px solid #123a67; color:#24364d; } #wemd th,#wemd td { padding:8px 9px; border-bottom:1px solid #c5d4e1; text-align:center; } #wemd th { color:#fff; background:#20588f; } #wemd tr:nth-child(even) { background:#f2f6fa; }
#wemd .callout { margin:22px 0; padding:14px 17px; border:1px solid #9eb5cb; border-left:4px solid #20588f; border-radius:0; color:#24364d; background:#f7f9fb; } #wemd .callout-title { margin-bottom:7px; color:#123a67; font-weight:700; }
#wemd .footnotes-sep { margin-top:38px; border-top:1px solid #7896b3; } #wemd .footnotes-sep:before { content:"References"; display:block; margin-top:11px; color:#123a67; font-weight:700; } #wemd .footnote-word,#wemd .footnote-ref { color:#174f86; } #wemd .footnote-item { display:flex; } #wemd .footnote-num { min-width:30px; color:#657b91; }
#wemd .block-equation { max-width:100%; margin:22px 0; overflow:auto; text-align:center; } #wemd .block-equation > svg { max-width:100% !important; } #wemd .inline-equation > svg { max-width:100%; vertical-align:middle; } #wemd pre.mermaid { max-width:100%; overflow:auto; background:#f7f9fb; }
#wemd .task-list-item { display:flex; gap:7px; align-items:flex-start; list-style:none; margin-left:-1.2em; } #wemd .task-list-item input { margin-top:5px; pointer-events:none; }
`;
const academicDark = academicLight
  .replace(/#(?:f7f9fb|f2f6fa|eef4fa|e9f0f7|ffffff|fff)/gi, "#1d2b3a")
  .replace(/#24364d/g, "#d9e6f2")
  .replace(/#123a67/g, "#9fc7ee")
  .replace(/#3a516a/g, "#bdd0e2")
  .replace(/#657b91/g, "#9eb4c8")
  .replace(/#174f86/g, "#77b5ed")
  .replace(/#20588f/g, "#397fb8")
  .replace(/#7896b3/g, "#58738d")
  .replace(/#9eb5cb/g, "#42576c")
  .replace(/#c5d4e1/g, "#3c5062")
  .replace(/#fff/g, "#d9e6f2");
export const academicBlueTheme: ThemeDefinition = {
  id: "academic-blue",
  name: "Academic Blue",
  description:
    "A research-oriented blue hierarchy with legible quotations, evidence tables, and references.",
  version: "1.0.0",
  author: "MPForge Contributors",
  license: "MIT",
  primaryColor: "#123a67",
  darkPrimaryColor: "#9fc7ee",
  supportedElements: SUPPORTED_THEME_ELEMENTS,
  mobileFallbacks: [
    "677px bounded canvas with border-box padding",
    "tables use a scroll container instead of shrinking cells",
    "equations stay within the article and can scroll",
    "serif fonts fall back to system Chinese fonts",
  ],
  previewFixture: academicBluePreviewFixture,
  lightCss: academicLight,
  darkCss: academicDark,
};
