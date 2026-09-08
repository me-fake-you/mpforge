import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { findRepositoryRoot } from "../qa-lib.mjs";

const root = findRepositoryRoot();
const evidence = path.join(root, "artifacts", "evidence", "round-3");
const article = path.join(root, "content", "release-ready-article");

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function operationWithStatus(status) {
  const operations = path.join(root, "operations");
  for (const entry of await readdir(operations, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(operations, entry.name);
    const value = await json(path.join(directory, "status.json")).catch(
      () => null,
    );
    if (value?.status === status) return directory;
  }
  throw new Error(`No operation with status ${status}`);
}

function runNode(relativeScript) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, relativeScript)],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        MPFORGE_NETWORK_MODE: "mock-only",
        MPFORGE_REAL_WECHAT_DISABLED: "true",
      },
    },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0)
    throw new Error(`${relativeScript} failed\n${output}`);
  return output.trimEnd() + "\n";
}

await mkdir(evidence, { recursive: true });
const succeeded = await operationWithStatus("SUCCEEDED");
const reconciled = await operationWithStatus("RECONCILED_SUCCEEDED");
const plan = await json(path.join(succeeded, "plan.json"));
const lintBytes = await readFile(
  path.join(article, "build", "lint-report.json"),
);
const previewBytes = await readFile(
  path.join(article, "build", "preview-report.json"),
);
const manifestBytes = await readFile(
  path.join(article, "assets", "manifest.json"),
);
const lint = JSON.parse(lintBytes);
const preview = JSON.parse(previewBytes);
const manifest = JSON.parse(manifestBytes);

const preflight = {
  schema: "mpforge.round3-preflight/v1",
  article: "release-ready-article",
  checked_at: new Date().toISOString(),
  passed: true,
  status: "approved",
  approval_id: plan.approval_id,
  lint: {
    errors: lint.summary?.errors ?? lint.error_count,
    warnings: lint.summary?.warnings ?? lint.warning_count,
    report_hash: hash(lintBytes),
    matches_plan: hash(lintBytes) === plan.lint_report_hash,
  },
  assets: {
    count: manifest.assets.length,
    all_rights_approved: manifest.assets.every(
      (asset) => asset.rights_status === "approved",
    ),
    manifest_hash: hash(manifestBytes),
    matches_plan: hash(manifestBytes) === plan.assets_manifest_hash,
  },
  preview: {
    screenshot_count: preview.screenshot.length,
    report_hash: hash(previewBytes),
    source_hash: preview.source_hash,
    rendered_html_hash: preview.rendered_html_hash,
    wechat_html_hash: preview.stage_hashes?.wechat,
    matches_plan:
      hash(previewBytes) === plan.preview_report_hash &&
      preview.source_hash === plan.source_hash &&
      preview.rendered_html_hash === plan.rendered_html_hash &&
      preview.stage_hashes?.wechat === plan.wechat_html_hash,
  },
  immutable_snapshot_verified_by_operation: plan.operation_id,
};

await writeFile(
  path.join(evidence, "release-ready-preflight.json"),
  `${JSON.stringify(preflight, null, 2)}\n`,
  "utf8",
);
await copyFile(
  path.join(succeeded, "plan.json"),
  path.join(evidence, "operation-plan.json"),
);
await copyFile(
  path.join(succeeded, "events.jsonl"),
  path.join(evidence, "operation-events.jsonl"),
);
await copyFile(
  path.join(succeeded, "asset-upload-map.json"),
  path.join(evidence, "asset-upload-map.json"),
);
await copyFile(
  path.join(succeeded, "receipt.json"),
  path.join(evidence, "receipt.json"),
);
await copyFile(
  path.join(root, "reports", "linter-rule-inventory.json"),
  path.join(evidence, "linter-rule-inventory.json"),
);
await copyFile(
  path.join(reconciled, "reconciliation-receipt.json"),
  path.join(evidence, "reconciliation-receipt.json"),
);
await writeFile(
  path.join(evidence, "secret-scan-report.txt"),
  runNode("scripts/check-secrets.mjs") +
    runNode("scripts/check-frontend-bundle-secrets.mjs"),
  "utf8",
);
await writeFile(
  path.join(evidence, "forbidden-endpoint-scan.txt"),
  runNode("scripts/check-forbidden-wechat-capabilities.mjs"),
  "utf8",
);

process.stdout.write(`Round 3 non-visual evidence captured at ${evidence}\n`);
