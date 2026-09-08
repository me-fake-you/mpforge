import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export function desktopInstallEnvironment(root, inherited = process.env) {
  return {
    ...inherited,
    ELECTRON_CACHE: path.join(root, ".cache/electron"),
    electron_config_cache: path.join(root, ".cache/electron"),
    npm_config_cache: path.join(root, ".cache/npm"),
    TEMP: path.join(root, "tmp"),
    TMP: path.join(root, "tmp"),
    TMPDIR: path.join(root, "tmp"),
  };
}

export async function installElectronRuntime() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifestPath = path.join(root, "apps/electron/package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const require = createRequire(manifestPath);
  const runtimeManifestPath = require.resolve("electron/package.json");
  const runtimeRoot = path.dirname(runtimeManifestPath);
  const installed = JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
  if (
    !/^\d+\.\d+\.\d+$/.test(manifest.devDependencies?.electron || "") ||
    installed.version !== manifest.devDependencies.electron
  ) {
    throw new Error(
      "Electron runtime must match the project's exact version pin. Run the locked dependency installation first.",
    );
  }
  const env = desktopInstallEnvironment(root);
  for (const directory of [
    env.ELECTRON_CACHE,
    env.npm_config_cache,
    env.TEMP,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  console.log(
    `Preparing Electron ${installed.version}; downloads and temporary files stay inside this checkout.`,
  );
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(runtimeRoot, "install.js")],
      {
        cwd: root,
        env,
        stdio: "inherit",
        windowsHide: true,
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(new Error(`Electron installation failed (${signal || code}).`));
    });
  });
  const runtimeVersion = fs
    .readFileSync(path.join(runtimeRoot, "dist/version"), "utf8")
    .trim()
    .replace(/^v/, "");
  if (runtimeVersion !== installed.version)
    throw new Error("Installed Electron binary version mismatch.");
  const executable = require("electron");
  if (typeof executable !== "string" || !fs.existsSync(executable)) {
    throw new Error("Electron executable is missing after installation.");
  }
  console.log(`Electron ${runtimeVersion} is ready.`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  installElectronRuntime().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
