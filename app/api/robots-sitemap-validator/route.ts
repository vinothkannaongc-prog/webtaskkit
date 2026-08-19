import {
  ROBOTS_SITEMAP_REQUEST_LIMITS,
  validateRobotsOrSitemap,
} from "@/lib/robotsSitemapValidator";
import { SecureHtmlFetchError } from "@/lib/secureHtmlFetch";
import type {
  RobotsSitemapApiErrorCode,
  RobotsSitemapValidatorRequest,
} from "@/lib/robotsSitemapTypes";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

type BodyReadResult =
  | { status: "ok"; text: string }
  | { status: "invalid" }
  | { status: "too-large" };

function emptyResponse(status: number, headers?: HeadersInit) {
  return new Response(null, { status, headers: { ...RESPONSE_HEADERS, ...headers } });
}

function errorResponse(error: RobotsSitemapApiErrorCode, status: number) {
  return Response.json({ error }, { status, headers: RESPONSE_HEADERS });
}

async function readBoundedUtf8Body(request: Request): Promise<BodyReadResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { status: "invalid" };
    if (Number(contentLength) > ROBOTS_SITEMAP_REQUEST_LIMITS.maximumBodyBytes) return { status: "too-large" };
  }
  if (!request.body) return { status: "ok", text: "" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > ROBOTS_SITEMAP_REQUEST_LIMITS.maximumBodyBytes) {
        await reader.cancel();
        return { status: "too-large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { status: "ok", text };
  } catch {
    return { status: "invalid" };
  } finally {
    reader.releaseLock();
  }
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  const keys = Object.keys(value);
  return keys.length >= 2 && keys.every((key) => allowed.includes(key));
}

function decodeRequest(value: unknown): RobotsSitemapValidatorRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.kind === "sitemap") {
    if (!exactKeys(body, ["kind", "url"]) || Object.keys(body).length !== 2 || typeof body.url !== "string") return null;
    return { kind: "sitemap", url: body.url };
  }
  if (body.kind === "robots") {
    if (!exactKeys(body, ["kind", "url", "path", "userAgent"]) || typeof body.url !== "string") return null;
    if (body.path !== undefined && typeof body.path !== "string") return null;
    if (body.userAgent !== undefined && typeof body.userAgent !== "string") return null;
    if (body.userAgent !== undefined && body.path === undefined) return null;
    return {
      kind: "robots",
      url: body.url,
      ...(body.path !== undefined ? { path: body.path } : {}),
      ...(body.userAgent !== undefined ? { userAgent: body.userAgent } : {}),
    };
  }
  return null;
}

function publicError(error: SecureHtmlFetchError) {
  switch (error.code) {
    case "invalid_url": return errorResponse("invalid_url", 400);
    case "blocked_address": return errorResponse("blocked_destination", 400);
    case "dns_failed": return errorResponse("dns_failed", 422);
    case "timeout": return errorResponse("fetch_timeout", 504);
    case "too_many_redirects": return errorResponse("too_many_redirects", 422);
    case "unsafe_redirect": return errorResponse("unsafe_redirect", 422);
    case "remote_status": return errorResponse("remote_status", 422);
    case "unsupported_content": return errorResponse("unsupported_content", 422);
    case "response_too_large": return errorResponse("response_too_large", 422);
    case "invalid_document": return errorResponse("invalid_document", 422);
    case "analysis_too_complex": return errorResponse("validation_too_complex", 422);
    case "aborted":
    case "network_failed": return errorResponse("fetch_failed", 502);
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return emptyResponse(415);
  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  if (!origin || (origin !== requestOrigin && origin !== "https://webtaskkit.com")) return emptyResponse(403);
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return emptyResponse(403);

  const body = await readBoundedUtf8Body(request);
  if (body.status === "too-large") return emptyResponse(413);
  if (body.status === "invalid") return errorResponse("invalid_request", 400);
  let decoded: unknown;
  try { decoded = JSON.parse(body.text); } catch { return errorResponse("invalid_request", 400); }
  const input = decodeRequest(decoded);
  if (!input) return errorResponse("invalid_request", 400);

  try {
    const result = await validateRobotsOrSitemap(input, { signal: request.signal });
    return Response.json(result, { status: 200, headers: RESPONSE_HEADERS });
  } catch (error) {
    if (error instanceof SecureHtmlFetchError) return publicError(error);
    return errorResponse("fetch_failed", 502);
  }
}

export function GET() {
  return emptyResponse(405, { Allow: "POST, OPTIONS" });
}

export function OPTIONS() {
  return emptyResponse(204, { Allow: "POST, OPTIONS" });
}
