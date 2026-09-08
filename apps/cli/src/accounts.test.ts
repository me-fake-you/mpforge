import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  doctorAccountConfiguration,
  listAccountConfigurations,
  parseAccountConfiguration,
  readServerCredentials,
} from "./accounts.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const mockYaml = `alias: local-mock
provider: wechat
mode: mock
display_name: Local Mock
app_id_env: MPFORGE_MOCK_APP_ID
app_secret_env: MPFORGE_MOCK_APP_SECRET
enabled: true
capability_status: mock_verified
capability_checked_at: null
`;

async function fixture(contents: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mpforge-account-test-"));
  roots.push(root);
  const directory = path.join(root, "config", "accounts");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "account.yaml"), contents, "utf8");
  return root;
}

describe("account configuration", () => {
  it("returns only safe status fields for a mock account", async () => {
    const root = await fixture(mockYaml);
    const accounts = await listAccountConfigurations(root, {});
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      alias: "local-mock",
      mode: "mock",
      credential_status: "configured",
    });
    expect(JSON.stringify(accounts)).not.toMatch(/secret-value|token-value/);
    expect(
      await doctorAccountConfiguration(root, "local-mock", {}),
    ).toMatchObject({
      passed: true,
      live_network_calls: 0,
    });
  });

  it("reports missing/invalid/unverified without exposing values", async () => {
    const real = mockYaml
      .replace("alias: local-mock", "alias: personal")
      .replace("mode: mock", "mode: real")
      .replace("enabled: true", "enabled: true");
    const root = await fixture(real);
    expect(
      (await listAccountConfigurations(root, {}))[0]!.credential_status,
    ).toBe("missing");
    expect(
      (await listAccountConfigurations(root, { MPFORGE_MOCK_APP_ID: "id" }))[0]!
        .credential_status,
    ).toBe("invalid");
    expect(
      (
        await listAccountConfigurations(root, {
          MPFORGE_MOCK_APP_ID: "id",
          MPFORGE_MOCK_APP_SECRET: "server-only-value",
        })
      )[0]!.credential_status,
    ).toBe("unverified");
    expect(
      await readServerCredentials(root, "personal", {
        MPFORGE_MOCK_APP_ID: "id",
        MPFORGE_MOCK_APP_SECRET: "server-only-value",
      }),
    ).toEqual({ appId: "id", appSecret: "server-only-value" });
  });

  it("rejects credential values and unknown fields in YAML", () => {
    expect(() =>
      parseAccountConfiguration(`${mockYaml}app_secret: unsafe\n`),
    ).toThrow(/SECRET_FIELD_FORBIDDEN/);
    expect(() =>
      parseAccountConfiguration(`${mockYaml}extra: value\n`),
    ).toThrow(/UNKNOWN_FIELD/);
  });
});
