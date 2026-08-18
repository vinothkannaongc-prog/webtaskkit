"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  SeoAuditApiErrorCode,
  SeoAuditGroup,
  SeoAuditResult,
} from "@/lib/seoAuditTypes";
import { useToolEvents } from "@/lib/useToolEvents";

const TOOL_PATH = "/seo-tools/on-page-seo-audit" as const;
const GROUPS: SeoAuditGroup[] = [
  "Fetch and indexability",
  "Search appearance",
  "Page structure",
  "Social sharing",
];
const STATUS_LABELS = { issue: "Issue", warning: "Warning", pass: "Passed" } as const;

const ERROR_MESSAGES: Record<SeoAuditApiErrorCode, string> = {
  invalid_request: "The request could not be read. Refresh the page and try again.",
  invalid_url: "Enter one complete public http:// or https:// URL without credentials, a fragment or a non-default port.",
  blocked_destination: "That address is not a public internet destination, so it cannot be audited.",
  dns_failed: "The hostname could not be resolved safely. Check the address and try again later.",
  fetch_timeout: "The fetch and analysis did not finish within the shared 12-second safety limit.",
  too_many_redirects: "The page redirected too many times or entered a redirect loop.",
  unsafe_redirect: "The page redirected to a destination that the safety policy will not follow.",
  remote_status: "The final page did not return a successful HTTP response.",
  unsupported_content: "The response was not uncompressed HTML in a supported character encoding.",
  response_too_large: "The HTML response exceeded the 512 KiB audit limit.",
  analysis_too_complex: "The HTML structure exceeded the fixed parsing or structured-data safety limits.",
  fetch_failed: "The page could not be fetched safely. It may block automated requests or have a temporary network problem.",
};

function isSeoAuditResult(value: unknown): value is SeoAuditResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<SeoAuditResult>;
  return candidate.schemaVersion === 1
    && typeof candidate.finalUrl === "string"
    && Boolean(candidate.summary)
    && Array.isArray(candidate.checks);
}

function filenameFor(result: SeoAuditResult) {
  let hostname = "page";
  try {
    hostname = new URL(result.finalUrl).hostname;
  } catch {
    // The server already validates this field; the fallback remains safe.
  }
  const safe = hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "page"}-seo-audit.json`;
}

export function SeoAuditTool() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<SeoAuditResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const { start: trackStart, complete: trackComplete, output: trackOutput, validationError: trackValidationError } = useToolEvents(TOOL_PATH);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const checksByGroup = useMemo(() => Object.fromEntries(
    GROUPS.map((group) => [group, result?.checks.filter((check) => check.group === group) ?? []]),
  ) as Record<SeoAuditGroup, SeoAuditResult["checks"]>, [result]);

  function changeUrl(value: string) {
    setUrl(value);
    setError("");
    if (value.trim()) trackStart();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);
    const candidate = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(candidate);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("scheme");
      if (parsed.username || parsed.password || parsed.hash || parsed.port) throw new Error("unsafe URL field");
    } catch {
      setError(ERROR_MESSAGES.invalid_url);
      trackValidationError();
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/seo-audit", {
        method: "POST",
        body: JSON.stringify({ url: parsed.href }),
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        mode: "same-origin",
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = payload && typeof payload === "object" && "error" in payload
          ? (payload as { error?: SeoAuditApiErrorCode }).error
          : undefined;
        setError(code && ERROR_MESSAGES[code] ? ERROR_MESSAGES[code] : ERROR_MESSAGES.fetch_failed);
        trackValidationError();
        return;
      }
      if (!isSeoAuditResult(payload)) {
        setError(ERROR_MESSAGES.fetch_failed);
        trackValidationError();
        return;
      }
      setResult(payload);
      trackComplete();
    } catch (requestError) {
      if ((requestError as Error)?.name !== "AbortError") {
        setError(ERROR_MESSAGES.fetch_failed);
        trackValidationError();
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setBusy(false);
      }
    }
  }

  function clear() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setUrl("");
    setResult(null);
    setError("");
    setBusy(false);
  }

  function downloadReport() {
    if (!result) return;
    const blob = new Blob([`${JSON.stringify(result, null, 2)}\n`], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filenameFor(result);
    link.rel = "noopener";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    trackOutput();
  }

  return (
    <div className="tool-workspace seo-audit-workspace">
      <form className="controls-panel seo-audit-input" onSubmit={submit} noValidate>
        <div className="panel-heading">
          <div><p className="panel-kicker">Public page</p><h2>Enter the URL to inspect</h2></div>
          <span className="status-pill">Server fetch</span>
        </div>

        <label className="field-label" htmlFor="seo-audit-url">Page URL</label>
        <input
          className="text-input seo-url-input"
          id="seo-audit-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={2_048}
          placeholder="https://example.com/page"
          value={url}
          onChange={(event) => changeUrl(event.target.value)}
          aria-describedby="seo-audit-url-help seo-audit-security-note"
          aria-invalid={Boolean(error)}
          aria-errormessage={error ? "seo-audit-error" : undefined}
          disabled={busy}
          required
        />
        <p className="field-help" id="seo-audit-url-help">Use a public HTML page on the default HTTP or HTTPS port. Query strings are supported but are never written to WebTaskKit access or event logs.</p>

        {error ? <div className="error-box seo-audit-error" id="seo-audit-error" role="alert"><strong>Audit not completed</strong><span>{error}</span></div> : null}

        <div className="tool-actions">
          <button className="button button--primary" type="submit" disabled={busy || !url.trim()}>
            {busy ? "Checking page…" : "Run SEO audit"}
          </button>
          <button className="button button--secondary" type="button" onClick={clear} disabled={!url && !result && !error}>Clear</button>
        </div>

        <aside className="tool-callout seo-security-note" id="seo-audit-security-note">
          <strong>Use only public URLs</strong>
          <p>Do not submit private dashboards, signed download links or URLs containing access tokens. WebTaskKit fetches the public HTML once, applies strict network limits, and does not store the submitted URL or page body.</p>
        </aside>
      </form>

      <section className="preview-panel seo-audit-results" aria-live="polite" aria-busy={busy}>
        {!result ? (
          <div className="empty-preview seo-audit-empty">
            <span aria-hidden="true">SEO</span>
            <strong>{busy ? "Reading the bounded HTML response…" : "Your audit will appear here"}</strong>
            <p>Review indexability signals, titles, descriptions, headings, image alt attributes, structured data syntax, Open Graph and card metadata in one report.</p>
          </div>
        ) : (
          <div className="seo-audit-report">
            <div className="seo-report-heading">
              <div>
                <p className="panel-kicker">Initial HTML report</p>
                <h2>Audit findings</h2>
                <a href={result.finalUrl} target="_blank" rel="noopener noreferrer">Open checked page <span aria-hidden="true">↗</span></a>
              </div>
              <button className="button button--secondary" type="button" onClick={downloadReport}>Download JSON</button>
            </div>
            <div className="seo-summary" aria-label="Audit summary">
              <div className="is-issue"><strong>{result.summary.issues}</strong><span>Issues</span></div>
              <div className="is-warning"><strong>{result.summary.warnings}</strong><span>Warnings</span></div>
              <div className="is-pass"><strong>{result.summary.passed}</strong><span>Passed</span></div>
            </div>
            <p className="seo-score-note">These are explainable checks, not a ranking score. Search engines may interpret a page differently.</p>

            <dl className="seo-page-facts">
              <div><dt>Title</dt><dd>{result.page.title ?? "Not found"}</dd></div>
              <div><dt>Description</dt><dd>{result.page.description ?? "Not found"}</dd></div>
              <div><dt>Canonical</dt><dd>{result.page.canonical ?? "Not found"}</dd></div>
              <div><dt>Response</dt><dd>HTTP {result.fetched.status} · {Math.ceil(result.fetched.responseBytes / 1_024)} KiB · {result.fetched.redirects} redirect{result.fetched.redirects === 1 ? "" : "s"}</dd></div>
            </dl>

            <div className="seo-check-groups">
              {GROUPS.map((group, groupIndex) => (
                <details key={group} open={groupIndex === 0 || checksByGroup[group].some((check) => check.status === "issue")}>
                  <summary>{group}<span>{checksByGroup[group].length} checks</span></summary>
                  <ul>
                    {checksByGroup[group].map((check) => (
                      <li className={`seo-check is-${check.status}`} key={check.id}>
                        <span className="seo-check-marker" aria-hidden="true">{check.status === "pass" ? "✓" : check.status === "issue" ? "!" : "•"}</span>
                        <div><strong><span className="sr-only">{STATUS_LABELS[check.status]}: </span>{check.label}</strong><p>{check.message}</p>{check.evidence ? <small>{check.evidence}</small> : null}</div>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
