import {
  findRepositoryRoot,
  isExecutedDirectly,
  printIssues,
  trackedFileSizes,
} from "./qa-lib.mjs";

export const DEFAULT_MAX_TRACKED_BYTES = 5 * 1024 * 1024;

export function validateTrackedFileSizes(
  entries,
  maximumBytes = DEFAULT_MAX_TRACKED_BYTES,
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error("maximumBytes must be a positive safe integer");
  }
  return entries
    .filter((entry) => entry.bytes > maximumBytes)
    .sort(
      (left, right) =>
        right.bytes - left.bytes || left.path.localeCompare(right.path),
    )
    .map(
      (entry) =>
        `${entry.path} is ${entry.bytes} bytes (limit ${maximumBytes} bytes)`,
    );
}

export function checkTrackedLargeFiles(root, maximumBytes) {
  return validateTrackedFileSizes(trackedFileSizes(root), maximumBytes);
}

if (isExecutedDirectly(import.meta.url)) {
  const configuredLimit = process.env.MPFORGE_MAX_TRACKED_FILE_BYTES;
  const maximumBytes = configuredLimit
    ? Number.parseInt(configuredLimit, 10)
    : DEFAULT_MAX_TRACKED_BYTES;
  const root = findRepositoryRoot();
  process.exitCode = printIssues(
    "large-file check",
    checkTrackedLargeFiles(root, maximumBytes),
  );
}
