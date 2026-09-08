declare module "markdown-it/lib/token.mjs" {
  import Token from "markdown-it/lib/token";
  export default Token;
}

declare module "markdown-it/lib/renderer.mjs" {
  import Renderer from "markdown-it/lib/renderer";
  export default Renderer;
}

declare module "markdown-it/lib/rules_core/state_core.mjs" {
  import StateCore from "markdown-it/lib/rules_core/state_core";
  export default StateCore;
}

declare module "markdown-it/lib/rules_block/state_block.mjs" {
  import StateBlock from "markdown-it/lib/rules_block/state_block";
  export default StateBlock;
}

declare module "markdown-it/lib/rules_inline/state_inline.mjs" {
  import StateInline from "markdown-it/lib/rules_inline/state_inline";
  export default StateInline;
}
