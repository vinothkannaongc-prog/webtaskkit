import {
  SecureHtmlFetchError,
  validatePublicAuditUrl,
  withSecurePublicResource,
} from "./secureHtmlFetch.ts";
import type { SecureFetchDependencies } from "./secureHtmlFetch.ts";
import {
  evaluateRobotsPath,
  parseRobotsDocument,
  ROBOTS_VALIDATOR_LIMITS,
  robotsChecks,
  robotsPreview,
  validateCrawlerProductToken,
  validateRobotsEvaluationPath,
} from "./robotsValidator.ts";
import {
  decodeSitemapBody,
  parseSitemapDocument,
  SITEMAP_VALIDATOR_LIMITS,
  sitemapChecks,
  validateSitemapMediaType,
} from "./sitemapValidator.ts";
import type {
  RobotsSitemapValidatorRequest,
  RobotsSitemapValidatorResult,
  RobotsValidatorResult,
} from "./robotsSitemapTypes.ts";
import { summarizeValidatorChecks } from "./validatorChecks.ts";

export const ROBOTS_SITEMAP_REQUEST_LIMITS = Object.freeze({
  maximumBodyBytes: 2_200,
  maximumRobotsOriginCharacters: 300,
  maximumSitemapUrlCharacters: 2_048,
});

function validateNoQueryUrl(value: unknown, maximumCharacters: number) {
  if (typeof value !== "string" || value.length > maximumCharacters) {
    throw new SecureHtmlFetchError("invalid_url");
  }
  const parsed = validatePublicAuditUrl(value);
  if (parsed.search || parsed.hash) throw new SecureHtmlFetchError("invalid_url");
  return parsed;
}

export function robotsDocumentUrl(value: unknown) {
  const parsed = validateNoQueryUrl(value, ROBOTS_SITEMAP_REQUEST_LIMITS.maximumRobotsOriginCharacters);
  if (parsed.pathname !== "/") throw new SecureHtmlFetchError("invalid_url");
  return new URL("/robots.txt", parsed.origin);
}

export function sitemapDocumentUrl(value: unknown) {
  const parsed = validateNoQueryUrl(value, ROBOTS_SITEMAP_REQUEST_LIMITS.maximumSitemapUrlCharacters);
  if (!/\.xml(?:\.gz)?$/i.test(parsed.pathname)) throw new SecureHtmlFetchError("invalid_url");
  return parsed;
}

function validateRobotsRedirect(value: unknown) {
  const parsed = validateNoQueryUrl(value, 2_048);
  return parsed;
}

function validateSitemapRedirect(value: unknown) {
  return sitemapDocumentUrl(value);
}

function validateRobotsMediaType(contentType: string | null) {
  if (!contentType) return null;
  const [rawType, ...parameters] = contentType.split(";");
  const type = rawType.trim().toLowerCase();
  if (!(type === "text/plain" || type === "application/octet-stream" || (type.startsWith("text/") && type !== "text/html"))) {
    throw new SecureHtmlFetchError("unsupported_content");
  }
  for (const parameter of parameters) {
    const match = /^\s*charset\s*=\s*["']?([^\s;"']+)/i.exec(parameter);
    if (match && !["utf-8", "utf8", "us-ascii"].includes(match[1].toLowerCase())) {
      throw new SecureHtmlFetchError("unsupported_content");
    }
  }
  return type;
}

function robotsUnavailableResult(
  requestedUrl: string,
  resource: {
    finalUrl: string;
    status: number;
    contentType: string | null;
    body: Uint8Array;
    redirects: number;
  },
  path: string | null,
  userAgent: string,
): RobotsValidatorResult {
  const serverFailure = resource.status >= 500;
  const checks = [
    {
      id: "robots-rfc-http-status",
      category: "crawler_specific" as const,
      label: serverFailure ? "Robots file temporarily unreachable" : "Robots file unavailable",
      message: serverFailure
        ? "RFC 9309 treats server failures as temporarily unreachable and requires a crawler to assume complete disallow. Retry and cache behavior varies by crawler."
        : "RFC 9309 treats 4xx responses as unavailable and permits a crawler to access resources. Cache behavior can vary.",
      evidence: `HTTP ${resource.status}`,
    },
    {
      id: "robots-google-http-status",
      category: "crawler_specific" as const,
      label: "Google-specific status handling",
      message: resource.status === 429
        ? "Google documents HTTP 429 as a server error and may temporarily stop crawling while retrying robots.txt."
        : serverFailure
          ? "Google documents temporary crawl throttling and retry behavior for server errors; behavior changes if the failure persists."
          : "Google documents 4xx responses other than 429 as if no robots.txt exists.",
    },
    {
      id: "robots-body-unavailable",
      category: "unverifiable" as const,
      label: "No rules parsed",
      message: "The response did not provide a successful robots.txt document, so no directives were evaluated.",
    },
  ];
  return {
    schemaVersion: 1,
    reviewedAgainst: "2026-08-19",
    kind: "robots",
    requestedUrl,
    finalUrl: resource.finalUrl,
    fetched: {
      status: resource.status,
      contentType: resource.contentType,
      responseBytes: resource.body.byteLength,
      decodedBytes: 0,
      redirects: resource.redirects,
    },
    summary: summarizeValidatorChecks(checks),
    checks,
    robots: {
      lineCount: 0,
      groupCount: 0,
      ruleCount: 0,
      sitemapCount: 0,
      userAgents: [],
      sitemaps: [],
      previewGroups: [],
      truncated: false,
    },
    evaluation: path ? { path, userAgent, verdict: "unverifiable", matchedRule: null } : null,
  };
}

async function validateRobots(
  request: Extract<RobotsSitemapValidatorRequest, { kind: "robots" }>,
  dependencies: SecureFetchDependencies,
) {
  const requested = robotsDocumentUrl(request.url);
  const path = validateRobotsEvaluationPath(request.path);
  const userAgent = validateCrawlerProductToken(request.userAgent);
  return withSecurePublicResource(requested.href, {
    accept: "text/plain, text/*;q=0.9, application/octet-stream;q=0.5",
    maximumRawBodyBytes: ROBOTS_VALIDATOR_LIMITS.maximumBytes,
    validateUrl: validateRobotsRedirect,
    acceptStatus: (status) => (status >= 200 && status <= 299) || (status >= 400 && status <= 599),
  }, (resource, context) => {
    if (resource.status < 200 || resource.status > 299) {
      return robotsUnavailableResult(requested.href, resource, path, userAgent);
    }
    const mediaType = validateRobotsMediaType(resource.contentType);
    const parsed = parseRobotsDocument(resource.body, context);
    const evaluation = path ? evaluateRobotsPath(parsed, path, userAgent, context) : null;
    const preview = robotsPreview(parsed);
    const checks = robotsChecks(parsed, evaluation);
    if (mediaType !== "text/plain") checks.push({
      id: "robots-media-type",
      category: "error",
      label: "Robots media type",
      message: mediaType
        ? `The document was safely parsed, but RFC 9309 requires text/plain and the response used ${mediaType}. Crawlers can be more lenient.`
        : "The document was safely parsed, but RFC 9309 requires text/plain and the response did not declare a media type. Crawlers can be more lenient.",
    });
    return {
      schemaVersion: 1,
      reviewedAgainst: "2026-08-19",
      kind: "robots",
      requestedUrl: requested.href,
      finalUrl: resource.finalUrl,
      fetched: {
        status: resource.status,
        contentType: resource.contentType,
        responseBytes: resource.body.byteLength,
        decodedBytes: resource.body.byteLength,
        redirects: resource.redirects,
      },
      summary: summarizeValidatorChecks(checks),
      checks,
      robots: {
        lineCount: parsed.lineCount,
        groupCount: parsed.groups.length,
        ruleCount: parsed.ruleCount,
        sitemapCount: parsed.sitemapCount,
        userAgents: preview.userAgents,
        sitemaps: parsed.sitemaps,
        previewGroups: preview.previewGroups,
        truncated: preview.truncated,
      },
      evaluation,
    } satisfies RobotsValidatorResult;
  }, dependencies);
}

async function validateSitemap(
  request: Extract<RobotsSitemapValidatorRequest, { kind: "sitemap" }>,
  dependencies: SecureFetchDependencies,
) {
  const requested = sitemapDocumentUrl(request.url);
  return withSecurePublicResource(requested.href, {
    accept: "application/xml, text/xml;q=0.9, application/gzip;q=0.8, application/octet-stream;q=0.5",
    maximumRawBodyBytes: SITEMAP_VALIDATOR_LIMITS.maximumRawBytes,
    validateUrl: validateSitemapRedirect,
  }, async (resource, context) => {
    const gzip = resource.finalUrl.toLowerCase().endsWith(".xml.gz");
    validateSitemapMediaType(resource.contentType, gzip);
    const decoded = await decodeSitemapBody(resource.body, gzip, context);
    const parsed = await parseSitemapDocument(decoded, resource.finalUrl, context);
    const checks = sitemapChecks(parsed, decoded.byteLength);
    return {
      schemaVersion: 1,
      reviewedAgainst: "2026-08-19",
      kind: "sitemap",
      requestedUrl: requested.href,
      finalUrl: resource.finalUrl,
      fetched: {
        status: resource.status,
        contentType: resource.contentType,
        responseBytes: resource.body.byteLength,
        decodedBytes: decoded.byteLength,
        redirects: resource.redirects,
      },
      summary: summarizeValidatorChecks(checks),
      checks,
      sitemap: {
        type: parsed.type,
        entryCount: parsed.entryCount,
        validLocationCount: parsed.validLocationCount,
        invalidLocationCount: parsed.invalidLocationCount,
        duplicateLocationCount: parsed.duplicateLocationCount,
        lastModifiedCount: parsed.lastModifiedCount,
        previewEntries: parsed.previewEntries,
        truncated: parsed.entryCount > parsed.previewEntries.length,
      },
    } satisfies RobotsSitemapValidatorResult;
  }, dependencies);
}

export async function validateRobotsOrSitemap(
  request: RobotsSitemapValidatorRequest,
  dependencies: SecureFetchDependencies = {},
): Promise<RobotsSitemapValidatorResult> {
  return request.kind === "robots"
    ? validateRobots(request, dependencies)
    : validateSitemap(request, dependencies);
}
