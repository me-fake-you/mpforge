# MPForge public demo script

Target length: 90–120 seconds. Use a clean local workspace and only the public example article. Record from the exact commit named in the release notes.

## Safety setup

1. Confirm the screen contains no private paths, notifications, account names, environment values, or unrelated browser tabs.
2. Use `examples/content/complete-content-as-code` copied into a disposable local `content/` directory.
3. Use the `mock-local` account alias. Do not load real credentials.
4. Prepare both light and dark screenshots from the current build. Do not use design mockups as feature evidence.

## Sequence

| Time     | Visual                                   | Narration                                                                               |
| -------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| 0–10s    | Dashboard with three public examples     | “MPForge makes every article a Git-tracked directory.”                                  |
| 10–25s   | Editor and Frontmatter                   | “Markdown, theme, status, and local assets are the source of truth.”                    |
| 25–42s   | Linter panel                             | “Deterministic checks run without an LLM, and any ERROR blocks a draft.”                |
| 42–58s   | Light, dark, then mobile preview         | “One renderer produces reviewable light, dark, and mobile evidence.”                    |
| 58–73s   | Status review and human approval control | “AI may recommend review, but only a human can approve.”                                |
| 73–95s   | Mock Draft action                        | “The public demo uses only a local Mock WeChat service.”                                |
| 95–110s  | Redacted receipt                         | “The receipt binds source, render, assets, lint, approval, and result—without secrets.” |
| 110–120s | Architecture and disclaimer              | “MPForge is based on WeMD, is not affiliated with WeChat, and never auto-broadcasts.”   |

## Capture requirements

- Record at 1920×1080 or higher, then export a readable 1280×720 derivative.
- Keep pointer motion slow and avoid jump cuts that hide loading or errors.
- If any action fails, retain the failure in QA evidence and re-record only after the fix is committed and verified.
- A GIF may be an excerpt, but the lossless or high-quality source stays under project-local `artifacts/` until release review.
- Do not display terminal output containing the user-profile path; crop to the application when necessary.

## Claim checklist

Before adding captions such as “tests pass”, “Windows installer”, “Pages demo”, or “v0.1.0 available”, verify the exact artifact or URL and capture it in the release audit. Omit any unverified claim.
