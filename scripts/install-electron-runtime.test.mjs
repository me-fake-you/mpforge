import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { desktopInstallEnvironment } from "./install-electron-runtime.mjs";

test("desktop bootstrap keeps downloads and temporary files inside checkout", () => {
  const root = path.resolve("tmp/bootstrap-fixture");
  const inherited = {
    TEMP: "external-temp",
    electron_config_cache: "external-cache",
    PATH: "unchanged",
  };
  const env = desktopInstallEnvironment(root, inherited);
  for (const name of [
    "TEMP",
    "TMP",
    "TMPDIR",
    "ELECTRON_CACHE",
    "electron_config_cache",
    "npm_config_cache",
  ]) {
    assert.ok(env[name].startsWith(`${root}${path.sep}`));
  }
  assert.equal(env.PATH, "unchanged");
  assert.equal(inherited.TEMP, "external-temp");
});

test("desktop bootstrap preserves explicit mirror choice without adding a default override", () => {
  const root = path.resolve("tmp/bootstrap-fixture");
  assert.equal(
    Object.hasOwn(desktopInstallEnvironment(root, {}), "ELECTRON_MIRROR"),
    false,
  );
  assert.equal(
    desktopInstallEnvironment(root, {
      ELECTRON_MIRROR: "https://example.invalid/explicit/",
    }).ELECTRON_MIRROR,
    "https://example.invalid/explicit/",
  );
});
