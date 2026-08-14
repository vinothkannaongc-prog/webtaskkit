"use client";

import { useCallback, useRef } from "react";
import {
  serializeToolEvent,
  type ToolEventName,
  type ToolEventPath,
} from "./toolEvents";

function postToolEvent(event: ToolEventName, path: ToolEventPath) {
  if (typeof window === "undefined") return;

  const body = serializeToolEvent(event, path);
  void fetch("/__events", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
    mode: "same-origin",
    keepalive: true,
  }).catch(() => {
    // Analytics is best-effort and must never interrupt a tool interaction.
  });
}

export function useToolEvents(path: ToolEventPath) {
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  const start = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    postToolEvent("tool_started", path);
  }, [path]);

  const complete = useCallback(() => {
    if (!startedRef.current || completedRef.current) return;
    completedRef.current = true;
    postToolEvent("tool_completed", path);
  }, [path]);

  const output = useCallback(() => {
    if (!startedRef.current) return;
    postToolEvent("output_action", path);
  }, [path]);

  const validationError = useCallback(() => {
    if (!startedRef.current) return;
    postToolEvent("validation_error", path);
  }, [path]);

  return { start, complete, output, validationError };
}
