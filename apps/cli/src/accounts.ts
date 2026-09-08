import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type AccountMode = "mock" | "real";
export type CredentialStatus =
  | "configured"
  | "missing"
  | "invalid"
  | "unverified";

export interface AccountConfiguration {
  alias: string;
  provider: "wechat";
  mode: AccountMode;
  display_name: string;
  app_id_env: string;
  app_secret_env: string;
  enabled: boolean;
  capability_status: string;
  capability_checked_at: string | null;
}

export interface SafeAccountView extends AccountConfiguration {
  credential_status: CredentialStatus;
}

const requiredKeys = [
  "alias",
  "provider",
  "mode",
  "display_name",
  "app_id_env",
  "app_secret_env",
  "enabled",
  "capability_status",
  "capability_checked_at",
] as const;

const environmentName = /^[A-Z][A-Z0-9_]{2,127}$/;
const aliasPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const forbiddenKeys =
  /^(?:app_?secret|access_?token|cookie|password|private_?key)$/i;

function scalar(raw: string): string | boolean | null {
  const value = raw.trim();
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    return value.slice(1, -1);
  return value;
}

export function parseAccountConfiguration(raw: string): AccountConfiguration {
  const values: Record<string, string | boolean | null> = {};
  for (const [index, sourceLine] of raw.split(/\r?\n/u).entries()) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator <= 0)
      throw new Error(`ACCOUNT_CONFIG_INVALID: line ${index + 1}`);
    const key = line.slice(0, separator).trim();
    if (forbiddenKeys.test(key))
      throw new Error(`ACCOUNT_CONFIG_SECRET_FIELD_FORBIDDEN: ${key}`);
    if (!(requiredKeys as readonly string[]).includes(key))
      throw new Error(`ACCOUNT_CONFIG_UNKNOWN_FIELD: ${key}`);
    if (key in values)
      throw new Error(`ACCOUNT_CONFIG_DUPLICATE_FIELD: ${key}`);
    values[key] = scalar(line.slice(separator + 1));
  }
  const missing = requiredKeys.filter((key) => !(key in values));
  if (missing.length)
    throw new Error(`ACCOUNT_CONFIG_MISSING_FIELDS: ${missing.join(",")}`);
  if (
    typeof values.alias !== "string" ||
    !aliasPattern.test(values.alias) ||
    values.provider !== "wechat" ||
    !["mock", "real"].includes(String(values.mode)) ||
    typeof values.display_name !== "string" ||
    !values.display_name.trim() ||
    typeof values.app_id_env !== "string" ||
    !environmentName.test(values.app_id_env) ||
    typeof values.app_secret_env !== "string" ||
    !environmentName.test(values.app_secret_env) ||
    typeof values.enabled !== "boolean" ||
    typeof values.capability_status !== "string" ||
    !values.capability_status.trim() ||
    !(
      values.capability_checked_at === null ||
      (typeof values.capability_checked_at === "string" &&
        !Number.isNaN(Date.parse(values.capability_checked_at)))
    )
  )
    throw new Error("ACCOUNT_CONFIG_INVALID");
  return values as unknown as AccountConfiguration;
}

function credentialStatus(
  account: AccountConfiguration,
  env: NodeJS.ProcessEnv,
): CredentialStatus {
  if (account.mode === "mock") return "configured";
  const hasId = Boolean(env[account.app_id_env]);
  const hasSecret = Boolean(env[account.app_secret_env]);
  if (!hasId && !hasSecret) return "missing";
  if (!hasId || !hasSecret) return "invalid";
  return "unverified";
}

export async function listAccountConfigurations(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SafeAccountView[]> {
  const directory = path.join(root, "config", "accounts");
  const names = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const accounts: SafeAccountView[] = [];
  for (const name of names.sort()) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const account = parseAccountConfiguration(
      await readFile(path.join(directory, name), "utf8"),
    );
    accounts.push({
      ...account,
      credential_status: credentialStatus(account, env),
    });
  }
  const duplicates = accounts.filter(
    (item, index) =>
      accounts.findIndex((other) => other.alias === item.alias) !== index,
  );
  if (duplicates.length)
    throw new Error(`ACCOUNT_ALIAS_DUPLICATE: ${duplicates[0]!.alias}`);
  return accounts;
}

export async function showAccountConfiguration(
  root: string,
  alias: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SafeAccountView> {
  const account = (await listAccountConfigurations(root, env)).find(
    (item) => item.alias === alias,
  );
  if (!account) throw new Error(`ACCOUNT_NOT_FOUND: ${alias}`);
  return account;
}

export async function doctorAccountConfiguration(
  root: string,
  alias: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const account = await showAccountConfiguration(root, alias, env);
  const checks = [
    { id: "enabled", passed: account.enabled },
    { id: "provider", passed: account.provider === "wechat" },
    {
      id: "credentials",
      passed:
        account.mode === "mock" || account.credential_status === "unverified",
    },
  ];
  return {
    alias: account.alias,
    mode: account.mode,
    credential_status: account.credential_status,
    capability_status: account.capability_status,
    capability_checked_at: account.capability_checked_at,
    live_network_calls: 0,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export async function readServerCredentials(
  root: string,
  alias: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ appId: string; appSecret: string } | null> {
  const account = await showAccountConfiguration(root, alias, env);
  if (account.mode !== "real") return null;
  const appId = env[account.app_id_env];
  const appSecret = env[account.app_secret_env];
  return appId && appSecret ? { appId, appSecret } : null;
}
