const automated = (id, requirement, evidence, command, notes = "") => ({
  id,
  requirement,
  status: "AUTOMATED",
  evidence,
  command,
  notes,
});

export const round3ScenarioMatrix = [
  automated(
    "R3-01",
    "Mock normal success",
    [
      {
        file: "apps/cli/src/drafts.test.ts",
        pattern: "completes a verified mock draft",
      },
    ],
    "pnpm --filter @mpforge/cli test:ci",
  ),
  automated(
    "R3-02",
    "Token failure",
    [{ file: "apps/mock-wechat/src/server.test.ts", pattern: "token_failure" }],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-03",
    "IP denied",
    [{ file: "apps/mock-wechat/src/server.test.ts", pattern: "ip_denied" }],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-04",
    "Account permission denied",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "permission_denied",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-05",
    "Second body image upload fails",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "fails exactly the configured nth body image",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-06",
    "Cover upload fails",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "injects a cover failure",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-07",
    "Draft payload rejected",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "payload_rejected",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-08",
    "Expired access token is classified as credential failure",
    [
      {
        file: "tests/round3/round3-targeted-contracts.test.mjs",
        pattern: "expired token code 42001",
      },
    ],
    "node --test tests/round3/round3-targeted-contracts.test.mjs",
  ),
  automated(
    "R3-09",
    "Rate limited",
    [{ file: "apps/mock-wechat/src/server.test.ts", pattern: "rate_limited" }],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-10",
    "Timeout occurs before any draft create call",
    [
      {
        file: "tests/round3/round3-targeted-contracts.test.mjs",
        pattern: "pre-draft token timeout leaves no draft",
      },
    ],
    "node --test tests/round3/round3-targeted-contracts.test.mjs",
    "Uses a timed-out token boundary, so no create-draft request is issued.",
  ),
  automated(
    "R3-11",
    "Draft created but response lost",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "reconciles a lost create response",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-12",
    "UNKNOWN reconciles to confirmed created",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "CONFIRMED_CREATED",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-13",
    "UNKNOWN reconciliation remains ambiguous",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "AMBIGUOUS",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-14",
    "Double click/concurrent execution is serialized",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "double click cannot create twice",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-15",
    "Article edit invalidates plan",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "changed source",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-16",
    "Invalidated approval blocks prepare",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "rejects an invalidated content approval",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-17",
    "Expired plan is rejected",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "PLAN_EXPIRED",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-18",
    "Account change is rejected",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "ACCOUNT_CHANGED",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-19",
    "Snapshot tampering is rejected",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "SNAPSHOT_TAMPERED",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-20",
    "Receipt tampering is rejected",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "creates a sanitized hash-bound receipt, detects tampering",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-21",
    "Secrets are redacted from persisted mock state, calls, and previews",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "persists redacted state, calls, and HTML previews",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-22",
    "Token-bearing URL is sanitized",
    [
      {
        file: "tests/round3/round3-targeted-contracts.test.mjs",
        pattern: "token query values are redacted",
      },
    ],
    "node --test tests/round3/round3-targeted-contracts.test.mjs",
  ),
  automated(
    "R3-23",
    "Frontend bundle secret scan",
    [
      {
        file: "tests/round3/round3-targeted-contracts.test.mjs",
        pattern: "frontend bundle contains no scanner-detectable credential",
      },
    ],
    "pnpm --filter @mpforge/web build; node --test tests/round3/round3-targeted-contracts.test.mjs",
  ),
  automated(
    "R3-24",
    "MCP real execution is rejected",
    [
      {
        file: "packages/side-effect-gate/src/side-effect-gate.test.ts",
        pattern: "MCP_BLOCKED",
      },
      {
        file: "apps/mcp/src/server.test.ts",
        pattern: "without real execution",
      },
    ],
    "pnpm --filter @mpforge/side-effect-gate test:ci; pnpm --filter @mpforge/mcp test:ci",
  ),
  automated(
    "R3-25",
    "CI real execution is rejected",
    [
      {
        file: "packages/side-effect-gate/src/side-effect-gate.test.ts",
        pattern: "CI_BLOCKED",
      },
    ],
    "pnpm --filter @mpforge/side-effect-gate test:ci",
  ),
  automated(
    "R3-26",
    "Forbidden formal publish capability scan",
    [
      {
        file: "scripts/round3-security.test.mjs",
        pattern: "production source has no forbidden",
      },
    ],
    "node --test scripts/round3-security.test.mjs",
  ),
  automated(
    "R3-27",
    "Web Assets performs explicit backend import",
    [
      {
        file: "tests/e2e/round3-web-assets.spec.ts",
        pattern: "dispatches explicit local import",
      },
      {
        file: "packages/media/src/__tests__/secure-pipeline.test.ts",
        pattern: "copies immutable originals, writes all manifest fields",
      },
    ],
    "pnpm --filter @mpforge/media test:ci; pnpm exec playwright test tests/e2e/round3-web-assets.spec.ts --config tests/e2e/playwright.config.ts",
    "Browser test proves the UI-to-backend dispatch; media test proves the backend writes/scans the real manifest pipeline.",
  ),
  automated(
    "R3-28",
    "Web asset rights update requires human confirmations",
    [
      {
        file: "tests/e2e/round3-web-assets.spec.ts",
        pattern: "requires and dispatches human rights update",
      },
    ],
    "pnpm exec playwright test tests/e2e/round3-web-assets.spec.ts --config tests/e2e/playwright.config.ts",
  ),
  automated(
    "R3-29",
    "Web preview screenshot array is non-empty",
    [
      {
        file: "apps/web/src/__tests__/services/previewEvidence.test.ts",
        pattern: "accepts a non-empty screenshot report",
      },
    ],
    "pnpm --filter @mpforge/web test:ci -- previewEvidence.test.ts",
  ),
  automated(
    "R3-30",
    "Preview source/build hash mismatch is STALE",
    [
      {
        file: "apps/web/src/__tests__/services/previewEvidence.test.ts",
        pattern: "marks source/build hash mismatches STALE",
      },
    ],
    "pnpm --filter @mpforge/web test:ci -- previewEvidence.test.ts",
  ),
  automated(
    "R3-31",
    "Linter rule inventory is complete and unique",
    [
      {
        file: "tests/round3/linter-inventory.test.mjs",
        pattern: "expands every catalog rule exactly once",
      },
    ],
    "node --test tests/round3/linter-inventory.test.mjs",
  ),
  automated(
    "R3-32",
    "Every ERROR-capable rule has positive and negative coverage",
    [
      {
        file: "tests/round3/linter-error-rule-coverage.test.mjs",
        pattern: "positive:",
      },
      {
        file: "tests/round3/linter-error-rule-coverage.test.mjs",
        pattern: "negative:",
      },
    ],
    "node --test tests/round3/linter-error-rule-coverage.test.mjs",
  ),
  automated(
    "R3-33",
    "Invalid credentials injection",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "invalid_credentials",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-34",
    "Server error injection",
    [{ file: "apps/mock-wechat/src/server.test.ts", pattern: "server_error" }],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-35",
    "Invalid JSON injection",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "invalid_json injection",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-36",
    "Duplicate request and key conflict",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "IDEMPOTENCY_KEY_CONFLICT",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-37",
    "Remote assets without draft remain explicit partial state",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "FAILED_WITH_REMOTE_ASSETS",
      },
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "preserves remote assets when draft creation fails",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci; pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-38",
    "Agent real execution is rejected",
    [
      {
        file: "packages/side-effect-gate/src/side-effect-gate.test.ts",
        pattern: "AGENT_BLOCKED",
      },
    ],
    "pnpm --filter @mpforge/side-effect-gate test:ci",
  ),
  automated(
    "R3-39",
    "Side-effect challenge is bound and one-time",
    [
      {
        file: "packages/side-effect-gate/src/side-effect-gate.test.ts",
        pattern: "exactly once",
      },
    ],
    "pnpm --filter @mpforge/side-effect-gate test:ci",
  ),
  automated(
    "R3-40",
    "Mock server is loopback-only",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "rejects every non-loopback bind",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-41",
    "UNKNOWN reconciles to confirmed no draft",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern:
          "allows a fresh plan after reconciliation confirms no draft exists",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
  automated(
    "R3-42",
    "Identical idempotent retry returns the same remote draft",
    [
      {
        file: "apps/mock-wechat/src/server.test.ts",
        pattern: "returns the same draft for an identical idempotent retry",
      },
    ],
    "pnpm --filter @mpforge/mock-wechat test:ci",
  ),
  automated(
    "R3-43",
    "Prepared plan tampering is rejected",
    [
      {
        file: "packages/draft-operations/src/operations.test.ts",
        pattern: "blocks snapshot and plan tampering",
      },
    ],
    "pnpm --filter @mpforge/draft-operations test:ci",
  ),
];
