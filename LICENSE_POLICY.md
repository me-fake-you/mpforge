# MPForge license policy

MPForge is a transparent fork of WeMD. The original `LICENSE` and upstream copyright are retained.

## Default decisions

- MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, and ISC code may be used after source, version, license, and SHA-256 registration.
- MPL, LGPL, GPL, AGPL, and custom licenses require an explicit compatibility review before code is copied or linked.
- Code without a license, source-available/BUSL code, no-white-label code, and assets or prompts with uncertain provenance are not copied in v0.1.
- Apache-2.0 source files retain their copyright, license headers, and required NOTICE material.

## Research-only repositories

`geekjourneyx/md2wechat-skill`, `NimaChu/mp-article`, and `isjiamu/gzh-design-skill` are research-only unless a later file-level license review authorizes a specific use. MPForge does not copy their code, themes, prompts, or skills.

`caol64/wenyan-cli`, `caol64/wenyan-mcp`, `JimLiu/baoyu-skills`, and `doocs/md` may be studied. Any later reuse must first be pinned and registered. Wenyan should be integrated as an adapter or dependency rather than copied wholesale.

## Round 2 review

Round 2 adds no new downloaded third-party source, theme, font, icon pack, or image. New packages reuse already-pinned workspace dependencies and project-local Chromium. All example/evidence media is locally generated from MPForge-owned fixtures; asset rights remain `pending` or `unknown` until a human explicitly confirms them. See `reports/round2-license-audit.md`.
