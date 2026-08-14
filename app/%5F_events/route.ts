import { parseToolEventPayload } from "@/lib/toolEvents";

const MAX_EVENT_BODY_BYTES = 128;
const RESPONSE_HEADERS = { "Cache-Control": "no-store" };

type BodyReadResult =
  | { status: "ok"; text: string }
  | { status: "invalid" }
  | { status: "too-large" };

function response(status: number, headers?: HeadersInit) {
  return new Response(null, {
    status,
    headers: { ...RESPONSE_HEADERS, ...headers },
  });
}

async function readSmallUtf8Body(request: Request): Promise<BodyReadResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { status: "invalid" };
    if (Number(contentLength) > MAX_EVENT_BODY_BYTES) return { status: "too-large" };
  }

  if (!request.body) return { status: "ok", text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteCount = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_EVENT_BODY_BYTES) {
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

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") return response(415);

  const origin = request.headers.get("origin");
  const requestOrigin = new URL(request.url).origin;
  if (!origin || (origin !== requestOrigin && origin !== "https://webtaskkit.com")) {
    return response(403);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return response(403);

  const body = await readSmallUtf8Body(request);
  if (body.status === "too-large") return response(413);
  if (body.status === "invalid") return response(400);

  let decoded: unknown;
  try {
    decoded = JSON.parse(body.text);
  } catch {
    return response(400);
  }

  const payload = parseToolEventPayload(decoded);
  if (!payload) return response(400);

  return response(204, {
    "X-Event-Name": payload.event,
    "X-Event-Path": payload.path,
  });
}

export function GET() {
  return response(405, { Allow: "POST, OPTIONS" });
}

export function OPTIONS() {
  return response(204, { Allow: "POST, OPTIONS" });
}
