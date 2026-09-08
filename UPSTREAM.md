# Upstream record

- Upstream repository: <https://github.com/tenngoxars/WeMD>
- Default branch: `main`
- Pinned commit: `964525d80ef63477c3a4b0327fe2a43415ee2bad`
- License: MIT, copyright 2025 WeMD Team
- Fork date: 2026-08-31
- Local history bundle: `downloads/wemd-upstream-964525d.bundle`
- Canonical remote: `upstream`
- Read-through transport mirror: `upstream-mirror`

## Inherited modules

The initial fork inherits the WeMD React/Vite web editor, Electron desktop shell, NestJS image service, Markdown renderer, theme engine, local-first storage, copy flow, dark-mode preview logic, build scripts, and Git history. Round 1 retains the CodeMirror editor, split workspace, browser/Electron storage adapters, theme selection surface, and desktop shell while replacing article lifecycle and deterministic-build policy with MPForge packages.

## Replaced modules

No upstream module is represented as replaced at fork time. Replacements will be listed only when implemented and verified.

## New modules

MPForge adds `@mpforge/content-schema`, `@mpforge/content-store`, canonical state-event history, deterministic rendering and original theme metadata, linting, media provenance and deduplication, approval gates, draft adapters, audit receipts, CLI, MCP server, mock WeChat, project-level skills, and release verification.

## Synchronization policy

Fetch upstream through the canonical URL when reachable or the registered transport mirror when necessary. Review upstream changes in a dedicated branch or worktree, preserve attribution, run the full MPForge test suite, and merge explicitly. Never rewrite upstream history to disguise the fork.
