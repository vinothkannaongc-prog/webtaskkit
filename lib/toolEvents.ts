export const TOOL_EVENT_NAMES = [
  "tool_started",
  "tool_completed",
  "output_action",
  "validation_error",
] as const;

export const TOOL_EVENT_PATHS = [
  "/generators/qr-code",
  "/generators/barcode",
  "/generators/tone",
  "/converters/txt-to-pdf",
  "/editors/svg",
  "/editors/text",
] as const;

export type ToolEventName = (typeof TOOL_EVENT_NAMES)[number];
export type ToolEventPath = (typeof TOOL_EVENT_PATHS)[number];

export type ToolEventPayload = {
  event: ToolEventName;
  path: ToolEventPath;
};

export function isToolEventName(value: unknown): value is ToolEventName {
  return typeof value === "string" && TOOL_EVENT_NAMES.some((event) => event === value);
}

export function isToolEventPath(value: unknown): value is ToolEventPath {
  return typeof value === "string" && TOOL_EVENT_PATHS.some((path) => path === value);
}

export function parseToolEventPayload(value: unknown): ToolEventPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("event") || !keys.includes("path")) return null;

  const payload = value as Record<string, unknown>;
  if (!isToolEventName(payload.event) || !isToolEventPath(payload.path)) return null;

  return { event: payload.event, path: payload.path };
}

export function serializeToolEvent(event: ToolEventName, path: ToolEventPath) {
  return JSON.stringify({ event, path } satisfies ToolEventPayload);
}
