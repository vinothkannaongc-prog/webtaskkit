import { Buffer } from "node:buffer";
import { Resolver } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";
import type { LookupFunction } from "node:net";
import { analyzeSeoHtml, SeoAuditLimitError } from "./seoAudit.ts";
import type { SeoAuditResult } from "./seoAuditTypes.ts";

export const SECURE_HTML_FETCH_LIMITS = Object.freeze({
  maximumUrlCharacters: 2_048,
  maximumRedirects: 3,
  maximumHeaderBytes: 16 * 1_024,
  maximumHeaderCount: 64,
  maximumRawBodyBytes: 512 * 1_024,
  maximumDecompressedBodyBytes: 512 * 1_024,
  absoluteTimeoutMilliseconds: 12_000,
});

export type SecureHtmlFetchErrorCode =
  | "invalid_url"
  | "blocked_address"
  | "dns_failed"
  | "timeout"
  | "aborted"
  | "too_many_redirects"
  | "unsafe_redirect"
  | "remote_status"
  | "unsupported_content"
  | "response_too_large"
  | "analysis_too_complex"
  | "network_failed";

export class SecureHtmlFetchError extends Error {
  readonly code: SecureHtmlFetchErrorCode;

  constructor(code: SecureHtmlFetchErrorCode) {
    super("The public page could not be audited safely.");
    this.name = "SecureHtmlFetchError";
    this.code = code;
  }
}

type PinnedResponse = {
  status: number;
  location: string | null;
  contentType: string | null;
  contentEncoding: string | null;
  body: Uint8Array;
  connectedAddress: string;
};

type ResolveHost = (hostname: string, signal: AbortSignal) => Promise<string[]>;
type RequestPinned = (
  target: URL,
  pinnedAddress: string,
  signal: AbortSignal,
) => Promise<PinnedResponse>;

type SecureFetchDependencies = {
  resolveHost?: ResolveHost;
  requestPinned?: RequestPinned;
  signal?: AbortSignal;
  absoluteTimeoutMilliseconds?: number;
};

const IPV4_BLOCKS: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8],
  [0x0a000000, 8],
  [0x64400000, 10],
  [0x7f000000, 8],
  [0xa9fe0000, 16],
  [0xac100000, 12],
  [0xc0000000, 24],
  [0xc0000200, 24],
  [0xc0586300, 24],
  [0xc0a80000, 16],
  [0xc6120000, 15],
  [0xc6336400, 24],
  [0xcb007100, 24],
  [0xe0000000, 4],
  [0xf0000000, 4],
];

// IANA IPv6 Global Unicast Address Space, last updated 2025-10-10. Unlisted
// 2000::/3 space is reserved, so this allowlist mirrors the allocated RIR rows
// and intentionally excludes the partially allocated 2001::/23 and 6to4.
const IPV6_ALLOCATED_GLOBAL_UNICAST: ReadonlyArray<readonly [readonly number[], number]> = [
  [[0x20, 0x01, 0x02, 0x00], 23],
  [[0x20, 0x01, 0x04, 0x00], 23],
  [[0x20, 0x01, 0x06, 0x00], 23],
  [[0x20, 0x01, 0x08, 0x00], 22],
  [[0x20, 0x01, 0x0c, 0x00], 23],
  [[0x20, 0x01, 0x0e, 0x00], 23],
  [[0x20, 0x01, 0x12, 0x00], 23],
  [[0x20, 0x01, 0x14, 0x00], 22],
  [[0x20, 0x01, 0x18, 0x00], 23],
  [[0x20, 0x01, 0x1a, 0x00], 23],
  [[0x20, 0x01, 0x1c, 0x00], 22],
  [[0x20, 0x01, 0x20, 0x00], 19],
  [[0x20, 0x01, 0x40, 0x00], 23],
  [[0x20, 0x01, 0x42, 0x00], 23],
  [[0x20, 0x01, 0x44, 0x00], 23],
  [[0x20, 0x01, 0x46, 0x00], 23],
  [[0x20, 0x01, 0x48, 0x00], 23],
  [[0x20, 0x01, 0x4a, 0x00], 23],
  [[0x20, 0x01, 0x4c, 0x00], 23],
  [[0x20, 0x01, 0x50, 0x00], 20],
  [[0x20, 0x01, 0x80, 0x00], 19],
  [[0x20, 0x01, 0xa0, 0x00], 20],
  [[0x20, 0x01, 0xb0, 0x00], 20],
  [[0x20, 0x03, 0x00, 0x00], 18],
  [[0x24, 0x00], 12],
  [[0x24, 0x10], 12],
  [[0x26, 0x00], 12],
  [[0x26, 0x10, 0x00], 23],
  [[0x26, 0x20, 0x00], 23],
  [[0x26, 0x30], 12],
  [[0x28, 0x00], 12],
  [[0x2a, 0x00], 12],
  [[0x2a, 0x10], 12],
  [[0x2c, 0x00], 12],
];

const IPV6_SPECIAL_BLOCKS: ReadonlyArray<readonly [readonly number[], number]> = [
  [[0x20, 0x01, 0x0d, 0xb8], 32],
];

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".test",
  ".invalid",
  ".example",
  ".onion",
];

function ipv4Number(address: string) {
  if (net.isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return (((octets[0] * 256 + octets[1]) * 256 + octets[2]) * 256 + octets[3]) >>> 0;
}

function ipv6Bytes(address: string) {
  if (net.isIP(address) !== 6 || address.includes("%")) return null;
  let value = address.toLowerCase();
  const lastColon = value.lastIndexOf(":");
  if (value.includes(".") && lastColon >= 0) {
    const ipv4 = value.slice(lastColon + 1);
    const parsed = ipv4Number(ipv4);
    if (parsed === null) return null;
    value = `${value.slice(0, lastColon)}:${((parsed >>> 16) & 0xffff).toString(16)}:${(parsed & 0xffff).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const before = halves[0] ? halves[0].split(":") : [];
  const after = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - before.length - after.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...before, ...Array.from({ length: Math.max(0, missing) }, () => "0"), ...after];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return Uint8Array.from(groups.flatMap((group) => {
    const number = Number.parseInt(group, 16);
    return [number >>> 8, number & 0xff];
  }));
}

function ipv4InBlock(value: number, base: number, prefix: number) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function ipv6InBlock(value: Uint8Array, base: number[], prefix: number) {
  const fullBytes = Math.floor(prefix / 8);
  const remaining = prefix % 8;
  for (let index = 0; index < fullBytes; index += 1) {
    if (value[index] !== base[index]) return false;
  }
  if (!remaining) return true;
  const mask = 0xff << (8 - remaining);
  return (value[fullBytes] & mask) === (base[fullBytes] & mask);
}

export function isPublicInternetAddress(address: string) {
  const ipv4 = ipv4Number(address);
  if (ipv4 !== null) {
    return !IPV4_BLOCKS.some(([base, prefix]) => ipv4InBlock(ipv4, base, prefix));
  }
  const ipv6 = ipv6Bytes(address);
  if (!ipv6) return false;
  const allocated = IPV6_ALLOCATED_GLOBAL_UNICAST.some(([base, prefix]) => (
    ipv6InBlock(ipv6, [...base], prefix)
  ));
  if (!allocated) return false;
  return !IPV6_SPECIAL_BLOCKS.some(([base, prefix]) => ipv6InBlock(ipv6, [...base], prefix));
}

function stripIpv6Brackets(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

function hasUnsafeRawUrlCharacter(value: string) {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\" || code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function rawAuthorityHostname(value: string) {
  const authority = /^https?:\/\/([^/?#]*)/i.exec(value)?.[1];
  if (!authority) return null;
  const hostPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostPort.startsWith("[")) {
    const closing = hostPort.indexOf("]");
    return closing > 0 ? hostPort.slice(1, closing) : null;
  }
  const portSeparator = hostPort.lastIndexOf(":");
  return portSeparator >= 0 && /^\d+$/.test(hostPort.slice(portSeparator + 1))
    ? hostPort.slice(0, portSeparator)
    : hostPort;
}

function isCanonicalRawIpv4(rawHostname: string, parsedHostname: string) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(rawHostname)) return false;
  if (rawHostname.split(".").some((part) => Number(part) > 255)) return false;
  return rawHostname === parsedHostname;
}

export function validatePublicAuditUrl(value: unknown) {
  if (typeof value !== "string") throw new SecureHtmlFetchError("invalid_url");
  if (
    value.length < 1
    || value.length > SECURE_HTML_FETCH_LIMITS.maximumUrlCharacters
    || value !== value.trim()
    || hasUnsafeRawUrlCharacter(value)
  ) {
    throw new SecureHtmlFetchError("invalid_url");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SecureHtmlFetchError("invalid_url");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new SecureHtmlFetchError("invalid_url");
  if (parsed.username || parsed.password || parsed.hash || parsed.port) {
    throw new SecureHtmlFetchError("invalid_url");
  }

  const hostname = stripIpv6Brackets(parsed.hostname).toLowerCase();
  if (!hostname || hostname.endsWith(".") || hostname.includes("%")) {
    throw new SecureHtmlFetchError("invalid_url");
  }
  const addressFamily = net.isIP(hostname);
  const rawHostname = rawAuthorityHostname(value)?.toLowerCase() ?? null;
  if (!rawHostname) throw new SecureHtmlFetchError("invalid_url");
  if (
    /^(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+))*$/i.test(rawHostname)
    && !isCanonicalRawIpv4(rawHostname, hostname)
  ) {
    throw new SecureHtmlFetchError("invalid_url");
  }
  if (addressFamily) {
    if (!isPublicInternetAddress(hostname)) throw new SecureHtmlFetchError("blocked_address");
  } else {
    if (
      hostname.length > 253
      || !hostname.includes(".")
      || !hostname.split(".").every((label) => (
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
      ))
      || hostname === "localhost"
      || BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    ) {
      throw new SecureHtmlFetchError("invalid_url");
    }
  }

  parsed.hash = "";
  if (parsed.href.length > SECURE_HTML_FETCH_LIMITS.maximumUrlCharacters) {
    throw new SecureHtmlFetchError("invalid_url");
  }
  return parsed;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(new SecureHtmlFetchError("aborted"));
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new SecureHtmlFetchError("aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error instanceof SecureHtmlFetchError
          ? error
          : new SecureHtmlFetchError("network_failed"));
      },
    );
  });
}

function expectedDnsMiss(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENODATA" || code === "ENOTFOUND";
}

type CancelableResolver = Pick<Resolver, "cancel" | "resolve4" | "resolve6">;

export async function resolvePublicAddresses(
  hostname: string,
  signal: AbortSignal,
  createResolver: () => CancelableResolver = () => new Resolver(),
) {
  if (net.isIP(hostname)) {
    if (!isPublicInternetAddress(hostname)) throw new SecureHtmlFetchError("blocked_address");
    return [hostname];
  }

  const resolver = createResolver();
  const cancel = () => resolver.cancel();
  if (signal.aborted) {
    cancel();
    throw new SecureHtmlFetchError("aborted");
  }
  signal.addEventListener("abort", cancel, { once: true });
  let resolution: Array<PromiseSettledResult<Array<{ address: string; ttl: number }>>>;
  try {
    resolution = await abortable(Promise.allSettled([
      resolver.resolve4(hostname, { ttl: true }),
      resolver.resolve6(hostname, { ttl: true }),
    ]), signal);
    if (signal.aborted) throw new SecureHtmlFetchError("aborted");
  } finally {
    signal.removeEventListener("abort", cancel);
    resolver.cancel();
  }
  const addresses: string[] = [];
  for (const result of resolution) {
    if (result.status === "rejected") {
      if (!expectedDnsMiss(result.reason)) throw new SecureHtmlFetchError("dns_failed");
      continue;
    }
    for (const record of result.value) addresses.push(record.address);
  }
  const unique = [...new Set(addresses)];
  if (!unique.length) throw new SecureHtmlFetchError("dns_failed");
  if (unique.some((address) => !isPublicInternetAddress(address))) {
    throw new SecureHtmlFetchError("blocked_address");
  }
  return unique.sort((left, right) => {
    const familyDifference = net.isIP(left) - net.isIP(right);
    return familyDifference || left.localeCompare(right);
  });
}

function addressesEqual(left: string, right: string) {
  const left4 = ipv4Number(left);
  const right4 = ipv4Number(right);
  if (left4 !== null || right4 !== null) return left4 !== null && right4 !== null && left4 === right4;
  const left6 = ipv6Bytes(left);
  const right6 = ipv6Bytes(right);
  return Boolean(left6 && right6 && left6.every((byte, index) => byte === right6[index]));
}

export function singleResponseHeader(
  response: Pick<http.IncomingMessage, "headersDistinct">,
  name: string,
) {
  const values = response.headersDistinct[name];
  if (!values) return null;
  if (values.length !== 1) throw new SecureHtmlFetchError("network_failed");
  return values[0];
}

function requestPublicHtml(
  target: URL,
  pinnedAddress: string,
  signal: AbortSignal,
): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const targetHostname = stripIpv6Brackets(target.hostname).toLowerCase();
    const family = net.isIP(pinnedAddress);
    let settled = false;

    const finishReject = (error: SecureHtmlFetchError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const lookup: LookupFunction = (hostname, options, callback) => {
      if (hostname.toLowerCase() !== targetHostname) {
        callback(Object.assign(new Error("Pinned lookup hostname mismatch"), { code: "ESECURITY" }), "", 0);
        return;
      }
      queueMicrotask(() => {
        if (options.all) callback(null, [{ address: pinnedAddress, family }]);
        else callback(null, pinnedAddress, family);
      });
    };

    const requestOptions: https.RequestOptions = {
      protocol: target.protocol,
      hostname: targetHostname,
      port: target.protocol === "https:" ? 443 : 80,
      method: "GET",
      path: `${target.pathname}${target.search}`,
      agent: false,
      lookup,
      maxHeaderSize: SECURE_HTML_FETCH_LIMITS.maximumHeaderBytes,
      insecureHTTPParser: false,
      joinDuplicateHeaders: false,
      signal,
      headers: {
        Accept: "text/html",
        "Accept-Encoding": "identity",
        Connection: "close",
      },
      ...(target.protocol === "https:" ? {
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        ...(net.isIP(targetHostname) === 0 ? { servername: targetHostname } : {}),
      } : {}),
    };
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request(requestOptions, (response) => {
      if (settled) {
        response.destroy();
        return;
      }
      const connectedAddress = response.socket.remoteAddress ?? "";
      if (!addressesEqual(connectedAddress, pinnedAddress) || !isPublicInternetAddress(connectedAddress)) {
        response.destroy();
        finishReject(new SecureHtmlFetchError("blocked_address"));
        return;
      }
      const status = response.statusCode ?? 0;
      let location: string | null;
      let contentType: string | null;
      let contentEncoding: string | null;
      let contentLength: string | null;
      try {
        location = singleResponseHeader(response, "location");
        contentType = singleResponseHeader(response, "content-type");
        contentEncoding = singleResponseHeader(response, "content-encoding");
        contentLength = singleResponseHeader(response, "content-length");
      } catch (error) {
        response.destroy();
        finishReject(error as SecureHtmlFetchError);
        return;
      }

      if ([301, 302, 303, 307, 308].includes(status) || status < 200 || status > 299) {
        response.destroy();
        settled = true;
        resolve({
          status,
          location,
          contentType,
          contentEncoding,
          body: new Uint8Array(),
          connectedAddress,
        });
        return;
      }
      if (contentEncoding && contentEncoding.trim().toLowerCase() !== "identity") {
        response.destroy();
        finishReject(new SecureHtmlFetchError("unsupported_content"));
        return;
      }
      if (contentLength) {
        if (!/^\d+$/.test(contentLength)) {
          response.destroy();
          finishReject(new SecureHtmlFetchError("network_failed"));
          return;
        }
        if (Number(contentLength) > SECURE_HTML_FETCH_LIMITS.maximumRawBodyBytes) {
          response.destroy();
          finishReject(new SecureHtmlFetchError("response_too_large"));
          return;
        }
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer | Uint8Array) => {
        if (settled) return;
        const buffer = Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (
          bytes > SECURE_HTML_FETCH_LIMITS.maximumRawBodyBytes
          || bytes > SECURE_HTML_FETCH_LIMITS.maximumDecompressedBodyBytes
        ) {
          response.destroy();
          finishReject(new SecureHtmlFetchError("response_too_large"));
          return;
        }
        chunks.push(buffer);
      });
      response.once("aborted", () => finishReject(new SecureHtmlFetchError("network_failed")));
      response.once("error", () => finishReject(new SecureHtmlFetchError("network_failed")));
      response.once("end", () => {
        if (settled) return;
        if (!response.complete) {
          finishReject(new SecureHtmlFetchError("network_failed"));
          return;
        }
        settled = true;
        resolve({
          status,
          location,
          contentType,
          contentEncoding,
          body: Buffer.concat(chunks, bytes),
          connectedAddress,
        });
      });
    });
    request.maxHeadersCount = SECURE_HTML_FETCH_LIMITS.maximumHeaderCount;
    request.once("error", () => finishReject(new SecureHtmlFetchError(signal.aborted ? "aborted" : "network_failed")));
    request.end();
  });
}

function htmlMediaType(contentType: string | null) {
  if (!contentType) throw new SecureHtmlFetchError("unsupported_content");
  const [mediaType, ...parameters] = contentType.split(";");
  const normalizedType = mediaType.trim().toLowerCase();
  if (normalizedType !== "text/html") {
    throw new SecureHtmlFetchError("unsupported_content");
  }
  let charset = "utf-8";
  for (const parameter of parameters) {
    const match = /^\s*charset\s*=\s*["']?([^\s;"']+)/i.exec(parameter);
    if (match) charset = match[1].toLowerCase();
  }
  const supported = new Set(["utf-8", "utf8", "us-ascii", "iso-8859-1", "latin1", "windows-1252"]);
  if (!supported.has(charset)) throw new SecureHtmlFetchError("unsupported_content");
  return { normalizedType, charset };
}

export async function fetchAndAuditPublicHtml(
  value: unknown,
  dependencies: SecureFetchDependencies = {},
): Promise<SeoAuditResult> {
  const resolveHost = dependencies.resolveHost ?? resolvePublicAddresses;
  const requestPinned = dependencies.requestPinned ?? requestPublicHtml;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMilliseconds = dependencies.absoluteTimeoutMilliseconds
    ?? SECURE_HTML_FETCH_LIMITS.absoluteTimeoutMilliseconds;
  if (
    !Number.isFinite(timeoutMilliseconds)
    || timeoutMilliseconds <= 0
    || timeoutMilliseconds > SECURE_HTML_FETCH_LIMITS.absoluteTimeoutMilliseconds
  ) {
    throw new SecureHtmlFetchError("network_failed");
  }
  const deadlineMilliseconds = performance.now() + timeoutMilliseconds;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMilliseconds);
  const abortFromCaller = () => controller.abort();
  if (dependencies.signal?.aborted) controller.abort();
  else dependencies.signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    let current = validatePublicAuditUrl(value);
    const visited = new Set<string>();
    let redirects = 0;
    while (true) {
      if (controller.signal.aborted) throw new SecureHtmlFetchError("aborted");
      if (visited.has(current.href)) throw new SecureHtmlFetchError("too_many_redirects");
      visited.add(current.href);
      const hostname = stripIpv6Brackets(current.hostname).toLowerCase();
      const addresses = await abortable(resolveHost(hostname, controller.signal), controller.signal);
      const uniqueAddresses = [...new Set(addresses)];
      if (!uniqueAddresses.length) throw new SecureHtmlFetchError("dns_failed");
      if (uniqueAddresses.some((address) => !isPublicInternetAddress(address))) {
        throw new SecureHtmlFetchError("blocked_address");
      }
      const pinnedAddress = uniqueAddresses[0];
      if (controller.signal.aborted) throw new SecureHtmlFetchError("aborted");
      const response = await abortable(
        requestPinned(current, pinnedAddress, controller.signal),
        controller.signal,
      );
      if (
        !addressesEqual(response.connectedAddress, pinnedAddress)
        || !isPublicInternetAddress(response.connectedAddress)
      ) {
        throw new SecureHtmlFetchError("blocked_address");
      }
      if (response.body.byteLength > SECURE_HTML_FETCH_LIMITS.maximumRawBodyBytes) {
        throw new SecureHtmlFetchError("response_too_large");
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location || response.location.length > SECURE_HTML_FETCH_LIMITS.maximumUrlCharacters) {
          throw new SecureHtmlFetchError("unsafe_redirect");
        }
        if (redirects >= SECURE_HTML_FETCH_LIMITS.maximumRedirects) {
          throw new SecureHtmlFetchError("too_many_redirects");
        }
        let redirected: URL;
        try {
          redirected = validatePublicAuditUrl(new URL(response.location, current).href);
        } catch (error) {
          if (error instanceof SecureHtmlFetchError && error.code === "blocked_address") throw error;
          throw new SecureHtmlFetchError("unsafe_redirect");
        }
        if (current.protocol === "https:" && redirected.protocol !== "https:") {
          throw new SecureHtmlFetchError("unsafe_redirect");
        }
        redirects += 1;
        current = redirected;
        continue;
      }
      if (response.status < 200 || response.status > 299) {
        throw new SecureHtmlFetchError("remote_status");
      }
      if (response.contentEncoding && response.contentEncoding.trim().toLowerCase() !== "identity") {
        throw new SecureHtmlFetchError("unsupported_content");
      }
      const media = htmlMediaType(response.contentType);
      const decoder = new TextDecoder(media.charset === "latin1" ? "iso-8859-1" : media.charset);
      const html = decoder.decode(response.body);
      return await analyzeSeoHtml({
        html,
        finalUrl: current.href,
        status: response.status,
        contentType: media.normalizedType,
        responseBytes: response.body.byteLength,
        redirects,
        signal: controller.signal,
        deadlineMilliseconds,
      });
    }
  } catch (error) {
    if (error instanceof SeoAuditLimitError) {
      if (error.code === "timeout") throw new SecureHtmlFetchError("timeout");
      if (error.code === "aborted") throw new SecureHtmlFetchError(timedOut ? "timeout" : "aborted");
      throw new SecureHtmlFetchError("analysis_too_complex");
    }
    if (error instanceof SecureHtmlFetchError) {
      if (error.code === "aborted") {
        throw new SecureHtmlFetchError(timedOut ? "timeout" : "aborted");
      }
      throw error;
    }
    throw new SecureHtmlFetchError(timedOut ? "timeout" : "network_failed");
  } finally {
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener("abort", abortFromCaller);
  }
}
