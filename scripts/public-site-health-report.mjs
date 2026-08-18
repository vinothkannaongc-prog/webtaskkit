import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import tls from "node:tls";
import { pathToFileURL } from "node:url";

const SITE = "webtaskkit.com";
const CANONICAL_ORIGIN = `https://${SITE}`;
const CANONICAL_HOME = `${CANONICAL_ORIGIN}/`;
const REQUEST_TIMEOUT_MS = 8_000;
const TLS_TIMEOUT_MS = 8_000;
const MINIMUM_TLS_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1_000;

export const EXPECTED_SITEMAP_ENTRIES = Object.freeze([
  ["/", "weekly", "1"],
  ["/generators", "monthly", "0.8"],
  ["/converters", "monthly", "0.8"],
  ["/editors", "monthly", "0.8"],
  ["/about", "monthly", "0.3"],
  ["/privacy", "monthly", "0.3"],
  ["/generators/qr-code", "monthly", "0.8"],
  ["/generators/barcode", "monthly", "0.8"],
  ["/converters/txt-to-pdf", "monthly", "0.8"],
  ["/converters/image-to-pdf", "monthly", "0.8"],
  ["/converters/pdf-to-jpg", "monthly", "0.8"],
  ["/editors/svg", "monthly", "0.8"],
  ["/editors/text", "monthly", "0.8"],
  ["/generators/tone", "monthly", "0.8"],
].map(([path, changeFrequency, priority]) => Object.freeze({
  url: `${CANONICAL_ORIGIN}${path}`,
  changeFrequency,
  priority,
})));

export const EXPECTED_SITEMAP_URLS = Object.freeze(
  EXPECTED_SITEMAP_ENTRIES.map(({ url }) => url),
);

export const HTTP_PROBE_SPECS = Object.freeze([
  Object.freeze({
    id: "http_apex_redirect",
    url: `http://${SITE}/`,
    expectedStatus: 301,
    expectedLocation: CANONICAL_HOME,
    accept: "text/html",
    readBody: false,
    maxBodyBytes: 0,
  }),
  Object.freeze({
    id: "http_www_redirect",
    url: `http://www.${SITE}/`,
    expectedStatus: 301,
    expectedLocation: CANONICAL_HOME,
    accept: "text/html",
    readBody: false,
    maxBodyBytes: 0,
  }),
  Object.freeze({
    id: "https_www_redirect",
    url: `https://www.${SITE}/`,
    expectedStatus: 301,
    expectedLocation: CANONICAL_HOME,
    accept: "text/html",
    readBody: false,
    maxBodyBytes: 0,
  }),
  Object.freeze({
    id: "https_apex_root",
    url: CANONICAL_HOME,
    expectedStatus: 200,
    expectedContentType: "text/html",
    accept: "text/html",
    readBody: true,
    maxBodyBytes: 512 * 1_024,
  }),
  Object.freeze({
    id: "robots_policy",
    url: `${CANONICAL_ORIGIN}/robots.txt`,
    expectedStatus: 200,
    expectedContentType: "text/plain",
    accept: "text/plain",
    readBody: true,
    maxBodyBytes: 64 * 1_024,
  }),
  Object.freeze({
    id: "sitemap_contract",
    url: `${CANONICAL_ORIGIN}/sitemap.xml`,
    expectedStatus: 200,
    expectedContentType: "xml",
    accept: "application/xml,text/xml;q=0.9",
    readBody: true,
    maxBodyBytes: 512 * 1_024,
  }),
]);

export const TLS_PROBE_SPECS = Object.freeze([
  Object.freeze({ id: "tls_apex", hostname: SITE }),
  Object.freeze({ id: "tls_www", hostname: `www.${SITE}` }),
]);

const FAILURE_CODES = new Set([
  ...HTTP_PROBE_SPECS.map(({ id }) => id),
  ...TLS_PROBE_SPECS.map(({ id }) => id),
]);

export class HealthEvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "HealthEvidenceError";
  }
}

function round(value, places = 3) {
  return Number(value.toFixed(places));
}

function normalizeObservedAt(now) {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new HealthEvidenceError("The injected clock did not return a valid Date.");
  }
  return value;
}

function contentTypeMatches(actual, expected) {
  if (typeof actual !== "string") return false;
  const mediaType = actual.split(";", 1)[0].trim().toLowerCase();
  if (expected === "xml") return mediaType === "application/xml" || mediaType === "text/xml";
  return mediaType === expected;
}

function hasInvalidXmlCharacter(value) {
  for (let index = 0; index < value.length;) {
    const codePoint = value.codePointAt(index);
    const valid = codePoint === 0x09
      || codePoint === 0x0a
      || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!valid) return true;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return false;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateRobots(body) {
  if (typeof body !== "string" || hasInvalidXmlCharacter(body)) {
    throw new HealthEvidenceError("The robots policy is not valid text.");
  }

  const directives = body
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\n|\r/)
    .map((line) => line.slice(0, line.indexOf("#") === -1 ? line.length : line.indexOf("#")).trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator <= 0) throw new HealthEvidenceError("The robots policy contains a malformed directive.");
      return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
    });

  const expected = [
    ["user-agent", "*"],
    ["allow", "/"],
    ["sitemap", `${CANONICAL_ORIGIN}/sitemap.xml`],
  ];
  if (
    directives.length !== expected.length
    || directives.some(([name, value], index) => name !== expected[index][0] || value !== expected[index][1])
  ) {
    throw new HealthEvidenceError("The robots policy differs from the fixed public-crawling contract.");
  }
  return true;
}

export function validateSitemap(body) {
  if (typeof body !== "string" || hasInvalidXmlCharacter(body)) {
    throw new HealthEvidenceError("The sitemap is not valid text.");
  }
  if (/<!--|<!\[CDATA\[|<!DOCTYPE\b|<!ENTITY\b|&/i.test(body)) {
    throw new HealthEvidenceError("Comments, CDATA, DTDs, and entities are not accepted.");
  }

  const whitespace = "[\\u0009\\u000A\\u000D\\u0020]*";
  const entries = EXPECTED_SITEMAP_ENTRIES.map(({ url, changeFrequency, priority }) => [
    `<url>${whitespace}`,
    `<loc>${escapeRegExp(url)}</loc>${whitespace}`,
    `<changefreq>${changeFrequency}</changefreq>${whitespace}`,
    `<priority>${escapeRegExp(priority)}</priority>${whitespace}`,
    `</url>${whitespace}`,
  ].join("")).join("");
  const exactSitemap = new RegExp([
    `^<\\?xml version="1\\.0" encoding="UTF-8"\\?>${whitespace}`,
    `<urlset xmlns="http://www\\.sitemaps\\.org/schemas/sitemap/0\\.9">${whitespace}`,
    entries,
    `</urlset>${whitespace}$`,
  ].join(""));
  if (!exactSitemap.test(body)) {
    throw new HealthEvidenceError("The sitemap differs from the exact serializer contract.");
  }
  return EXPECTED_SITEMAP_ENTRIES.length;
}

function htmlAttributes(tag, name) {
  const escapedName = escapeRegExp(name);
  return [...tag.matchAll(
    new RegExp(`\\s${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "gi"),
  )].map((match) => match[1] ?? match[2] ?? match[3]);
}

function htmlAttribute(tag, name) {
  const values = htmlAttributes(tag, name);
  return values.length === 1 ? values[0] : null;
}

export function validateHomepage(body) {
  if (typeof body !== "string" || hasInvalidXmlCharacter(body)) {
    throw new HealthEvidenceError("The homepage is not valid text.");
  }
  const heads = [...body.matchAll(/<head(?:\s[^>]*)?>([\s\S]*?)<\/head\s*>/gi)];
  if (heads.length !== 1) throw new HealthEvidenceError("The homepage does not contain one document head.");
  const head = heads[0][1].replace(/<!--[\s\S]*?-->/g, "");

  const titles = [...head.matchAll(/<title\s*>([^<]*)<\/title\s*>/gi)].map((match) => match[1]);
  if (titles.length !== 1 || titles[0] !== "WebTaskKit — Fast, Private Online Tools") {
    throw new HealthEvidenceError("The homepage title does not match the WebTaskKit identity.");
  }

  const canonicalLinks = [...head.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => (htmlAttribute(tag, "rel") ?? "").toLowerCase() === "canonical");
  if (canonicalLinks.length !== 1 || htmlAttribute(canonicalLinks[0], "href") !== CANONICAL_ORIGIN) {
    throw new HealthEvidenceError("The homepage canonical link does not match the fixed origin.");
  }

  const applicationNames = [...head.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => (htmlAttribute(tag, "name") ?? "").toLowerCase() === "application-name")
    .map((tag) => htmlAttribute(tag, "content"));
  if (applicationNames.length !== 1 || applicationNames[0] !== "WebTaskKit") {
    throw new HealthEvidenceError("The homepage application identity is missing.");
  }
  return true;
}

async function readBoundedUtf8(response, maxBodyBytes) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxBodyBytes) {
    await response.body?.cancel().catch(() => {});
    throw new HealthEvidenceError("A response exceeded its body-size limit.");
  }
  if (response.body === null) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        throw new HealthEvidenceError("A response exceeded its body-size limit.");
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
  } catch (error) {
    if (error instanceof HealthEvidenceError) throw error;
    throw new HealthEvidenceError("A response body could not be read as UTF-8.");
  } finally {
    reader.releaseLock();
  }
}

export function createNodeHttpProbe({
  fetchImpl = globalThis.fetch,
  scheduleTimeout = globalThis.setTimeout,
  cancelTimeout = globalThis.clearTimeout,
  monotonicNow = () => performance.now(),
} = {}) {
  if (typeof fetchImpl !== "function") throw new HealthEvidenceError("Fetch is unavailable.");

  return async function nodeHttpProbe(spec) {
    const controller = new AbortController();
    let timedOut = false;
    const started = monotonicNow();
    const timeout = scheduleTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS);

    try {
      const response = await fetchImpl(spec.url, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { Accept: spec.accept },
        signal: controller.signal,
      });
      let body = "";
      if (spec.readBody) body = await readBoundedUtf8(response, spec.maxBodyBytes);
      else await response.body?.cancel().catch(() => {});

      return {
        status: response.status,
        location: response.headers.get("location"),
        contentType: response.headers.get("content-type"),
        body,
        durationMs: monotonicNow() - started,
      };
    } catch {
      throw new HealthEvidenceError(timedOut ? "The HTTP probe timed out." : "The HTTP probe failed.");
    } finally {
      cancelTimeout(timeout);
    }
  };
}

export function createNodeTlsProbe({
  connectImpl = tls.connect,
  scheduleTimeout = globalThis.setTimeout,
  cancelTimeout = globalThis.clearTimeout,
  monotonicNow = () => performance.now(),
} = {}) {
  return function nodeTlsProbe(spec) {
    return new Promise((resolvePromise, rejectPromise) => {
      const started = monotonicNow();
      let socket;
      let settled = false;
      let deadline;

      const clearDeadline = () => {
        if (deadline !== undefined) cancelTimeout(deadline);
      };
      const destroySocket = () => {
        try {
          socket?.destroy();
        } catch {
          // The result remains bounded and contains no socket details.
        }
      };

      const fail = () => {
        if (settled) return;
        settled = true;
        clearDeadline();
        destroySocket();
        rejectPromise(new HealthEvidenceError("The TLS probe failed."));
      };

      const succeed = () => {
        if (settled) return;
        let result;
        try {
          const certificate = socket.getPeerCertificate();
          result = {
            validTo: certificate.valid_to,
            protocol: socket.getProtocol(),
            durationMs: monotonicNow() - started,
          };
        } catch {
          fail();
          return;
        }
        settled = true;
        clearDeadline();
        destroySocket();
        resolvePromise(result);
      };

      deadline = scheduleTimeout(fail, TLS_TIMEOUT_MS);
      try {
        socket = connectImpl({
          host: spec.hostname,
          port: 443,
          servername: spec.hostname,
          rejectUnauthorized: true,
          checkServerIdentity: tls.checkServerIdentity,
          minVersion: "TLSv1.2",
        }, () => queueMicrotask(succeed));
        socket.once("error", fail);
      } catch {
        fail();
      }
    });
  };
}

function emptyStatusClasses() {
  return { "1xx": 0, "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0 };
}

function normalizeHttpResponse(response, spec) {
  if (
    response === null
    || typeof response !== "object"
    || !Number.isInteger(response.status)
    || response.status < 100
    || response.status > 599
    || !Number.isFinite(response.durationMs)
    || response.durationMs < 0
    || response.durationMs > REQUEST_TIMEOUT_MS
    || typeof response.body !== "string"
    || Buffer.byteLength(response.body, "utf8") > spec.maxBodyBytes
    || (response.location !== null && typeof response.location !== "string")
    || (response.contentType !== null && typeof response.contentType !== "string")
  ) {
    throw new HealthEvidenceError("The HTTP transport returned an invalid result.");
  }
  return response;
}

function validateHttpContract(response, spec) {
  if (response.status !== spec.expectedStatus) {
    throw new HealthEvidenceError("An HTTP status did not match the fixed contract.");
  }
  if (spec.expectedLocation && response.location !== spec.expectedLocation) {
    throw new HealthEvidenceError("A redirect did not match the canonical destination.");
  }
  if (spec.expectedContentType && !contentTypeMatches(response.contentType, spec.expectedContentType)) {
    throw new HealthEvidenceError("A response media type did not match the fixed contract.");
  }
  if (spec.id === "https_apex_root") validateHomepage(response.body);
  if (spec.id === "robots_policy") validateRobots(response.body);
  if (spec.id === "sitemap_contract") return validateSitemap(response.body);
  return null;
}

function normalizeTlsResult(result, observedAt) {
  if (
    result === null
    || typeof result !== "object"
    || !Number.isFinite(result.durationMs)
    || result.durationMs < 0
    || result.durationMs > TLS_TIMEOUT_MS
    || !["TLSv1.2", "TLSv1.3"].includes(result.protocol)
    || typeof result.validTo !== "string"
  ) {
    throw new HealthEvidenceError("The TLS transport returned an invalid result.");
  }
  const expiresAt = new Date(result.validTo);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new HealthEvidenceError("The TLS certificate did not provide a valid expiry.");
  }
  return {
    durationMs: result.durationMs,
    protocol: result.protocol,
    expiresAt,
    remainingMs: expiresAt.getTime() - observedAt.getTime(),
  };
}

export async function buildPublicSiteHealthReport({
  httpProbe,
  tlsProbe,
  now = () => new Date(),
}) {
  if (typeof httpProbe !== "function" || typeof tlsProbe !== "function" || typeof now !== "function") {
    throw new HealthEvidenceError("HTTP, TLS, and clock dependencies are required.");
  }
  const observedAt = normalizeObservedAt(now);
  const failureCodes = new Set();
  const statusClasses = emptyStatusClasses();
  let httpPassed = 0;
  let httpTransportFailures = 0;
  let http5xx = 0;
  let maximumHttpSeconds = null;
  let robotsValid = false;
  let sitemapValid = false;
  let sitemapUrls = null;

  for (const spec of HTTP_PROBE_SPECS) {
    try {
      const response = normalizeHttpResponse(await httpProbe(spec), spec);
      statusClasses[`${Math.floor(response.status / 100)}xx`] += 1;
      if (response.status >= 500) http5xx += 1;
      const seconds = response.durationMs / 1_000;
      maximumHttpSeconds = maximumHttpSeconds === null ? seconds : Math.max(maximumHttpSeconds, seconds);
      const validatedSitemapUrls = validateHttpContract(response, spec);
      if (spec.id === "robots_policy") robotsValid = true;
      if (spec.id === "sitemap_contract") {
        sitemapValid = true;
        sitemapUrls = validatedSitemapUrls;
      }
      httpPassed += 1;
    } catch {
      failureCodes.add(spec.id);
      httpTransportFailures += 1;
    }
  }

  let tlsPassed = 0;
  let minimumRemainingMs = null;
  let earliestExpiry = null;
  let maximumTlsSeconds = null;
  const protocols = {};

  for (const spec of TLS_PROBE_SPECS) {
    try {
      const result = normalizeTlsResult(await tlsProbe(spec), observedAt);
      minimumRemainingMs = minimumRemainingMs === null
        ? result.remainingMs
        : Math.min(minimumRemainingMs, result.remainingMs);
      earliestExpiry = earliestExpiry === null || result.expiresAt < earliestExpiry
        ? result.expiresAt
        : earliestExpiry;
      const seconds = result.durationMs / 1_000;
      maximumTlsSeconds = maximumTlsSeconds === null ? seconds : Math.max(maximumTlsSeconds, seconds);
      protocols[result.protocol] = (protocols[result.protocol] ?? 0) + 1;
      if (result.remainingMs < MINIMUM_TLS_DAYS * DAY_MS) {
        throw new HealthEvidenceError("The TLS certificate is inside the minimum expiry threshold.");
      }
      tlsPassed += 1;
    } catch {
      failureCodes.add(spec.id);
    }
  }

  const failures = [...failureCodes].filter((code) => FAILURE_CODES.has(code)).sort();
  return {
    schema_version: 1,
    evidence_type: "once-daily external point-in-time health evidence; not an uptime SLA",
    site: SITE,
    observed_at: observedAt.toISOString(),
    overall_status: failures.length === 0 ? "pass" : "fail",
    synthetic_probe_floor: {
      http_requests_per_run: HTTP_PROBE_SPECS.length,
      tls_handshakes_per_run: TLS_PROBE_SPECS.length,
      notice: "Synthetic requests are operational evidence, not visits or users.",
    },
    http: {
      checks: HTTP_PROBE_SPECS.length,
      passed: httpPassed,
      failed: HTTP_PROBE_SPECS.length - httpPassed,
      transport_or_contract_failures: httpTransportFailures,
      status_classes: statusClasses,
      server_errors_5xx: http5xx,
      maximum_response_seconds: maximumHttpSeconds === null ? null : round(maximumHttpSeconds),
    },
    tls: {
      checks: TLS_PROBE_SPECS.length,
      passed: tlsPassed,
      failed: TLS_PROBE_SPECS.length - tlsPassed,
      minimum_required_days_remaining: MINIMUM_TLS_DAYS,
      minimum_days_remaining: minimumRemainingMs === null ? null : round(minimumRemainingMs / DAY_MS),
      earliest_expiry: earliestExpiry?.toISOString() ?? null,
      protocols,
      maximum_handshake_seconds: maximumTlsSeconds === null ? null : round(maximumTlsSeconds),
    },
    robots: { valid: robotsValid },
    sitemap: {
      valid: sitemapValid,
      canonical_urls: sitemapUrls,
      expected_canonical_urls: EXPECTED_SITEMAP_URLS.length,
    },
    failure_codes: failures,
  };
}

export function formatPublicSiteHealthReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function publicSiteHealthExitCode(report) {
  return report?.overall_status === "pass" ? 0 : 1;
}

export function assertNoCliArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new HealthEvidenceError("This fixed-target reporter accepts no command-line arguments.");
  }
}

async function main() {
  try {
    assertNoCliArguments(process.argv.slice(2));
    const report = await buildPublicSiteHealthReport({
      httpProbe: createNodeHttpProbe(),
      tlsProbe: createNodeTlsProbe(),
    });
    process.stdout.write(formatPublicSiteHealthReport(report));
    process.exitCode = publicSiteHealthExitCode(report);
  } catch {
    process.stderr.write("The fixed-target public site health report could not be created.\n");
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();
