# Side-effect approval

Content approval and side-effect approval are separate decisions.

Content approval binds the reviewed article, build, lint, assets, preview, theme, and commit evidence. Side-effect approval authorizes one real draft creation for one immutable operation, account alias, and plan hash.

Real execution requires an interactive TTY or controlled Web human session. The user must see the complete effect summary and retype a short-lived challenge bound to `operation_id`, `account_alias`, and `plan_hash`. The challenge is stored only as a hash, expires quickly, and is consumed once.

CI, GitHub Actions, MCP, agents, skills, automation, background tasks, redirected input, and piped stdin cannot complete the challenge. There is no `--yes`, `--force`, skip-confirmation, environment approval, or reusable approval path.

MCP may prepare a real plan and ask a human to continue in a controlled session. It cannot submit a challenge or invoke real execution.
