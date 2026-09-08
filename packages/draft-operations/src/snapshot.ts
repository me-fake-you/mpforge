import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { prettyStableJson, sha256 } from "./crypto.js";
import { DraftOperationError } from "./errors.js";
import { resolveChild } from "./safety.js";
import type {
  DraftOperationPlan,
  SnapshotFileEntry,
  SnapshotInventory,
} from "./types.js";
import type { ValidatedReleaseSource } from "./source.js";

const INVENTORY_NAME = "snapshot-inventory.json";

async function writeExclusive(
  filePath: string,
  bytes: Uint8Array,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes, { flag: "wx" });
}

function normalizeSnapshotPath(relativePath: string): string {
  return relativePath.replace(/\\/gu, "/").replace(/^\.\//u, "");
}

export async function createSnapshot(input: {
  temporaryOperationDirectory: string;
  operationId: string;
  createdAt: string;
  source: ValidatedReleaseSource;
}): Promise<{ inventory: SnapshotInventory; inventoryHash: string }> {
  const snapshotDirectory = path.join(
    input.temporaryOperationDirectory,
    "snapshot",
  );
  await mkdir(snapshotDirectory, { recursive: true });
  const files = new Map<string, Uint8Array>();
  for (const [name, bytes] of input.source.criticalFiles)
    files.set(normalizeSnapshotPath(name), bytes);
  for (const asset of input.source.assetFiles) {
    const destination = normalizeSnapshotPath(asset.snapshotRelativePath);
    const previous = files.get(destination);
    if (previous && sha256(previous) !== sha256(asset.bytes))
      throw new DraftOperationError(
        "ASSET_FILE_INVALID",
        "Two source assets resolve to the same snapshot path",
        { path: destination },
      );
    files.set(destination, asset.bytes);
  }
  const entries: SnapshotFileEntry[] = [];
  for (const [relativePath, bytes] of [...files].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const destination = resolveChild(snapshotDirectory, relativePath);
    await writeExclusive(destination, bytes);
    entries.push({
      path: relativePath,
      sha256: sha256(bytes),
      size: bytes.byteLength,
    });
  }
  const inventory: SnapshotInventory = {
    schema: "mpforge.operation-snapshot/v1",
    operation_id: input.operationId,
    created_at: input.createdAt,
    binding: input.source.binding,
    files: entries,
  };
  const serialized = Buffer.from(prettyStableJson(inventory), "utf8");
  await writeExclusive(
    path.join(snapshotDirectory, INVENTORY_NAME),
    serialized,
  );
  return { inventory, inventoryHash: sha256(serialized) };
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isSymbolicLink())
      throw new DraftOperationError(
        "SNAPSHOT_TAMPERED",
        "Snapshot symbolic links are forbidden",
        { path: relative },
      );
    if (item.isDirectory())
      result.push(
        ...(await listFiles(path.join(directory, item.name), relative)),
      );
    else if (item.isFile()) result.push(relative);
    else
      throw new DraftOperationError(
        "SNAPSHOT_TAMPERED",
        "Snapshot contains an unsupported filesystem entry",
        { path: relative },
      );
  }
  return result.sort();
}

function parseInventory(raw: Uint8Array): SnapshotInventory {
  try {
    const parsed = JSON.parse(
      Buffer.from(raw).toString("utf8"),
    ) as SnapshotInventory;
    if (
      parsed.schema !== "mpforge.operation-snapshot/v1" ||
      !Array.isArray(parsed.files) ||
      !parsed.binding
    )
      throw new Error("invalid inventory schema");
    return parsed;
  } catch (error) {
    throw new DraftOperationError(
      "SNAPSHOT_TAMPERED",
      "The snapshot inventory cannot be verified",
      { reason: error instanceof Error ? error.message : String(error) },
    );
  }
}

export async function verifySnapshot(
  operationDirectory: string,
  plan: DraftOperationPlan,
): Promise<SnapshotInventory> {
  const snapshotDirectory = path.join(operationDirectory, "snapshot");
  const inventoryPath = path.join(snapshotDirectory, INVENTORY_NAME);
  const raw = await readFile(inventoryPath).catch(
    (error: NodeJS.ErrnoException) => {
      throw new DraftOperationError(
        "SNAPSHOT_MISSING",
        "The immutable snapshot inventory is missing",
        { reason: error.code ?? "unknown" },
      );
    },
  );
  if (sha256(raw) !== plan.snapshot_inventory_hash)
    throw new DraftOperationError(
      "SNAPSHOT_TAMPERED",
      "The immutable snapshot inventory hash is invalid",
    );
  const inventory = parseInventory(raw);
  if (inventory.operation_id !== plan.operation_id)
    throw new DraftOperationError(
      "SNAPSHOT_TAMPERED",
      "The snapshot belongs to a different operation",
    );
  const bindingFields: Array<keyof typeof inventory.binding> = [
    "article_id",
    "account_alias",
    "source_hash",
    "rendered_html_hash",
    "wechat_html_hash",
    "assets_manifest_hash",
    "lint_report_hash",
    "preview_report_hash",
    "approval_id",
    "approval_record_hash",
    "theme_hash",
    "source_commit",
    "adapter_version",
    "platform_contract_version",
  ];
  for (const field of bindingFields)
    if (inventory.binding[field] !== plan[field])
      throw new DraftOperationError(
        "SNAPSHOT_TAMPERED",
        "The snapshot binding differs from the operation plan",
        { field },
      );
  const actualPaths = (await listFiles(snapshotDirectory)).filter(
    (item) => item !== INVENTORY_NAME,
  );
  const expectedPaths = inventory.files.map((entry) => entry.path).sort();
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths))
    throw new DraftOperationError(
      "SNAPSHOT_TAMPERED",
      "Snapshot files were added, removed, or renamed",
      {
        expected_count: expectedPaths.length,
        actual_count: actualPaths.length,
      },
    );
  for (const entry of inventory.files) {
    const filePath = resolveChild(snapshotDirectory, entry.path);
    const information = await lstat(filePath);
    if (!information.isFile() || information.isSymbolicLink())
      throw new DraftOperationError(
        "SNAPSHOT_TAMPERED",
        "Snapshot entry is not a regular file",
        { path: entry.path },
      );
    const bytes = await readFile(filePath);
    if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256)
      throw new DraftOperationError(
        "SNAPSHOT_TAMPERED",
        "Snapshot file content changed after preparation",
        { path: entry.path },
      );
  }
  return inventory;
}

export async function loadVerifiedSnapshot(
  operationDirectory: string,
  plan: DraftOperationPlan,
): Promise<{
  inventory: SnapshotInventory;
  files: ReadonlyMap<string, Uint8Array>;
}> {
  const inventory = await verifySnapshot(operationDirectory, plan);
  const snapshotDirectory = path.join(operationDirectory, "snapshot");
  const files = new Map<string, Uint8Array>();
  for (const entry of inventory.files) {
    const bytes = await readFile(resolveChild(snapshotDirectory, entry.path));
    if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256)
      throw new DraftOperationError(
        "SNAPSHOT_TAMPERED",
        "Snapshot changed while it was being loaded for execution",
        { path: entry.path },
      );
    files.set(entry.path, bytes);
  }
  return { inventory, files };
}

export async function publishTemporaryOperation(
  temporaryDirectory: string,
  operationDirectory: string,
): Promise<void> {
  try {
    await rename(temporaryDirectory, operationDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new DraftOperationError(
        "OPERATION_ALREADY_EXISTS",
        "An operation with this id already exists",
      );
    throw error;
  }
}

export const SNAPSHOT_INVENTORY_FILE = INVENTORY_NAME;
