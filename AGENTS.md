# MPForge repository instructions

All writes, downloads, caches, generated files, worktrees, and third-party source checkouts must remain under this repository root.

## Safety invariants

- Preserve the upstream WeMD Git history, MIT license, copyright, and attribution.
- Never log or persist AppSecret, access tokens, cookies, or complete account credentials.
- Never call the real WeChat draft API unless the article is `approved`, deterministic lint has no `ERROR`, an account alias is explicit, and the user has approved that exact side effect.
- MPForge v0.1 never performs a formal broadcast. Publishing remains a human action in the WeChat admin console.
- AI may recommend review transitions but may not set `approved`.
- Public examples must not contain private user assets or credentials.

## Local-only paths

Use `.cache/npm`, `.cache/pnpm-store`, `.cache/playwright`, `.cache/electron`, `downloads`, `third_party/sources`, `tmp`, `artifacts`, and `reports`. Run `scripts/env.ps1` before dependency installation, preview generation, Electron packaging, or Playwright.

## Verification

Update `PROJECT_STATE.md` when a round changes. Before claiming a feature works, run its tests and record evidence under `reports/`. Keep unsupported or untested features clearly marked.
