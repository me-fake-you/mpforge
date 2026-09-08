import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MediaError } from "./media.js";

export const DEFAULT_REMOTE_TIMEOUT_MS = 10_000;
export const DEFAULT_REMOTE_MAX_REDIRECTS = 3;
export const DEFAULT_REMOTE_MAX_BYTES = 10 * 1024 * 1024;

export type HostResolver = (hostname: string) => Promise<readonly string[]>;

export interface RemoteUrlPolicy {
  resolver?: HostResolver;
  resolveDns?: boolean;
}

function ipv4Number(address: string): number | undefined {
  const pieces = address.split(".");
  if (pieces.length !== 4) return undefined;
  const values = pieces.map(Number);
  if (
    values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  )
    return undefined;
  return (
    (((values[0] * 256 + values[1]) * 256 + values[2]) * 256 + values[3]) >>> 0
  );
}

function inIpv4Range(value: number, base: string, bits: number): boolean {
  const baseValue = ipv4Number(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

function ipv6Number(address: string): bigint | undefined {
  const withoutZone = address.split("%", 1)[0].toLowerCase();
  let source = withoutZone;
  const ipv4Tail = source.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const ipv4 = ipv4Number(ipv4Tail);
    if (ipv4 === undefined) return undefined;
    source =
      source.slice(0, source.length - ipv4Tail.length) +
      `${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = source.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const omitted = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (omitted < 0 || (halves.length === 1 && left.length !== 8))
    return undefined;
  const pieces = [
    ...left,
    ...Array.from({ length: omitted }, () => "0"),
    ...right,
  ];
  if (
    pieces.length !== 8 ||
    pieces.some((piece) => !/^[a-f0-9]{1,4}$/.test(piece))
  )
    return undefined;
  return pieces.reduce(
    (value, piece) => (value << 16n) | BigInt(`0x${piece}`),
    0n,
  );
}

export function isBlockedNetworkAddress(address: string): boolean {
  let normalized = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (normalized.startsWith("::ffff:")) normalized = normalized.slice(7);
  const version = isIP(normalized);
  if (version === 4) {
    const value = ipv4Number(normalized)!;
    return [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ].some(([base, bits]) => inIpv4Range(value, String(base), Number(bits)));
  }
  if (version === 6) {
    const value = ipv6Number(normalized);
    if (value === undefined) return true;
    if (value === 0n || value === 1n) return true;
    if (value >> 121n === 0x7en) return true; // fc00::/7
    if (value >> 118n === 0x3fan) return true; // fe80::/10
    if (value >> 120n === 0xffn) return true; // multicast
    if (value >> 96n === 0x20010db8n) return true; // documentation
    if (value >> 32n === 0xffffn) {
      return isBlockedNetworkAddress(
        `${Number((value >> 24n) & 0xffn)}.${Number((value >> 16n) & 0xffn)}.${Number((value >> 8n) & 0xffn)}.${Number(value & 0xffn)}`,
      );
    }
    return false;
  }
  return true;
}

function parseRemoteUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch (cause) {
    throw new MediaError(
      "INVALID_NETWORK_URL",
      "Network image URL is invalid.",
      { cause },
    );
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password ||
    parsed.hostname.includes("%")
  ) {
    throw new MediaError(
      "INVALID_NETWORK_URL",
      "Only credential-free HTTP(S) URLs are allowed.",
    );
  }
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data.ec2.internal"
  ) {
    throw new MediaError(
      "SSRF_BLOCKED",
      "Localhost and metadata hosts are blocked.",
    );
  }
  if (isIP(hostname) && isBlockedNetworkAddress(hostname)) {
    throw new MediaError(
      "SSRF_BLOCKED",
      "Private, local, metadata, and reserved addresses are blocked.",
    );
  }
  return parsed;
}

const defaultResolver: HostResolver = async (hostname) => {
  try {
    return (await lookup(hostname, { all: true, verbatim: true })).map(
      (entry) => entry.address,
    );
  } catch (cause) {
    throw new MediaError(
      "REMOTE_DNS_FAILED",
      "Remote image hostname could not be resolved.",
      { cause },
    );
  }
};

/** Validates schemes, credentials, hostnames, all DNS answers, and metadata/private ranges. */
export async function assertSafeRemoteImageUrl(
  input: string,
  policy: RemoteUrlPolicy = {},
): Promise<URL> {
  const parsed = parseRemoteUrl(input);
  if (policy.resolveDns === false) return parsed;
  const addresses = await (policy.resolver ?? defaultResolver)(parsed.hostname);
  if (!addresses.length)
    throw new MediaError(
      "REMOTE_DNS_FAILED",
      "Remote image hostname has no addresses.",
    );
  if (addresses.some(isBlockedNetworkAddress)) {
    throw new MediaError(
      "SSRF_BLOCKED",
      "Remote image hostname resolves to a blocked address.",
    );
  }
  return parsed;
}

export interface SecureRemoteFetchResult {
  data: Uint8Array;
  contentType?: string;
  contentLength?: number;
  finalUrl?: string;
  redirectChain?: readonly string[];
}

export interface SecureRemoteFetcher {
  fetch(input: {
    url: string;
    signal: AbortSignal;
    maxBytes: number;
    maxRedirects: number;
    /** Must be called before connecting to every redirect target. */
    validateUrl: (url: string) => Promise<URL>;
  }): Promise<SecureRemoteFetchResult>;
}

export interface SecureRemoteFetchPolicy extends RemoteUrlPolicy {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export async function securelyFetchRemoteImage(
  input: string,
  fetcher: SecureRemoteFetcher,
  policy: SecureRemoteFetchPolicy = {},
): Promise<SecureRemoteFetchResult & { finalUrl: string }> {
  const initial = await assertSafeRemoteImageUrl(input, policy);
  const timeoutMs = policy.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
  const maxBytes = policy.maxBytes ?? DEFAULT_REMOTE_MAX_BYTES;
  const maxRedirects = policy.maxRedirects ?? DEFAULT_REMOTE_MAX_REDIRECTS;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let result: SecureRemoteFetchResult;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(
          new MediaError("REMOTE_TIMEOUT", "Remote image import timed out."),
        );
      }, timeoutMs);
    });
    result = await Promise.race([
      fetcher.fetch({
        url: initial.toString(),
        signal: controller.signal,
        maxBytes,
        maxRedirects,
        validateUrl: (url) => assertSafeRemoteImageUrl(url, policy),
      }),
      timeoutPromise,
    ]);
  } catch (cause) {
    if (cause instanceof MediaError && cause.code === "REMOTE_TIMEOUT")
      throw cause;
    if (controller.signal.aborted)
      throw new MediaError("REMOTE_TIMEOUT", "Remote image import timed out.", {
        cause,
      });
    throw cause;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  const redirects = result.redirectChain ?? [];
  if (redirects.length > maxRedirects)
    throw new MediaError(
      "TOO_MANY_REDIRECTS",
      "Remote image exceeded redirect limit.",
    );
  for (const redirect of redirects)
    await assertSafeRemoteImageUrl(redirect, policy);
  const final = await assertSafeRemoteImageUrl(
    result.finalUrl ?? redirects.at(-1) ?? initial.toString(),
    policy,
  );
  if (result.contentLength !== undefined && result.contentLength > maxBytes) {
    throw new MediaError(
      "MEDIA_TOO_LARGE",
      "Remote Content-Length exceeds policy.",
    );
  }
  if (result.data.byteLength > maxBytes)
    throw new MediaError("MEDIA_TOO_LARGE", "Remote image exceeds policy.");
  return { ...result, finalUrl: final.toString() };
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > maxBytes)
    throw new MediaError(
      "MEDIA_TOO_LARGE",
      "Remote Content-Length exceeds policy.",
    );
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MediaError(
          "MEDIA_TOO_LARGE",
          "Remote image exceeds policy while streaming.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

/** Explicit fetch adapter. It follows redirects manually; ordinary scan/render never call it. */
export const nodeSecureRemoteFetcher: SecureRemoteFetcher = {
  async fetch({ url, signal, maxBytes, maxRedirects, validateUrl }) {
    let current = url;
    const redirectChain: string[] = [];
    for (;;) {
      current = (await validateUrl(current)).toString();
      const response = await fetch(current, {
        redirect: "manual",
        signal,
        credentials: "omit",
        referrer: "",
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location)
          throw new MediaError(
            "INVALID_REDIRECT",
            "Remote image redirect has no Location.",
          );
        if (redirectChain.length >= maxRedirects)
          throw new MediaError(
            "TOO_MANY_REDIRECTS",
            "Remote image exceeded redirect limit.",
          );
        current = new URL(location, current).toString();
        await validateUrl(current);
        redirectChain.push(current);
        continue;
      }
      if (!response.ok)
        throw new MediaError(
          "REMOTE_FETCH_FAILED",
          `Remote image returned HTTP ${response.status}.`,
        );
      const data = await readResponseBytes(response, maxBytes);
      return {
        data,
        contentType: response.headers.get("content-type") ?? undefined,
        contentLength:
          Number(response.headers.get("content-length")) || undefined,
        finalUrl: current,
        redirectChain,
      };
    }
  },
};
