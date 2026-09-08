import { createHash, randomUUID } from "node:crypto";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

export function prettyStableJson(value: unknown): string {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, sort(item)]),
      );
    return input;
  }
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export function hashUnsigned<T extends Record<string, unknown>>(
  value: T,
  hashField: keyof T,
): string {
  const unsigned = { ...value };
  delete unsigned[hashField];
  return sha256(stableJson(unsigned));
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
