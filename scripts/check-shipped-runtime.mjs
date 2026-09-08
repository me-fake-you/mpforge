import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const ADVISORY_ENDPOINT =
  "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";

export async function auditElectronRuntime({
  declaredVersion,
  installedVersion,
  fetchImpl = fetch,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(declaredVersion || "")) {
    throw new Error("Shipped Electron must use an exact stable version pin.");
  }
  if (declaredVersion !== installedVersion) {
    throw new Error(
      "Installed Electron does not match the declared runtime pin.",
    );
  }
  const response = await fetchImpl(ADVISORY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ electron: [installedVersion] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Runtime advisory query failed: ${response.status}`);
  const payload = await response.json();
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid runtime advisory response.");
  }
  if (Object.keys(payload).some((key) => key !== "electron")) {
    throw new Error("Unexpected package in runtime advisory response.");
  }
  const advisories = Object.hasOwn(payload, "electron") ? payload.electron : [];
  if (!Array.isArray(advisories))
    throw new Error("Invalid Electron advisory list.");
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  const findings = advisories.map((item) => {
    if (
      !item ||
      !Object.hasOwn(counts, item.severity) ||
      !item.url ||
      !item.title
    ) {
      throw new Error("Malformed Electron advisory; audit cannot pass.");
    }
    counts[item.severity] += 1;
    return {
      id: item.id,
      severity: item.severity,
      title: item.title,
      url: item.url,
      vulnerable_versions: item.vulnerable_versions,
    };
  });
  return {
    status: counts.high || counts.critical ? "FAIL" : "PASS",
    scope:
      "Shipped Electron runtime, explicitly audited despite devDependency classification",
    registry: "https://registry.npmjs.org",
    runtime: { name: "electron", version: installedVersion },
    threshold: "high",
    ignored_advisories: [],
    vulnerabilities: counts,
    findings,
    checked_at: new Date().toISOString(),
  };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifestPath = path.join(root, "apps/electron/package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const require = createRequire(manifestPath);
  const installedVersion = require("electron/package.json").version;
  const report = await auditElectronRuntime({
    declaredVersion: manifest.devDependencies?.electron,
    installedVersion,
  });
  fs.mkdirSync(path.join(root, "reports"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "reports/shipped-runtime-audit.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "PASS") process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
    );
    fs.mkdirSync(path.join(root, "reports"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "reports/shipped-runtime-audit.json"),
      `${JSON.stringify({ status: "FAIL", error: error.message, checked_at: new Date().toISOString() }, null, 2)}\n`,
    );
    console.error(`Shipped runtime audit FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}
