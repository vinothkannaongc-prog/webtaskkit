"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  RobotsSitemapApiErrorCode,
  RobotsSitemapValidatorResult,
  RobotsValidatorResult,
  SitemapValidatorResult,
  ValidatorCheck,
  RobotsSitemapValidatorRequest,
} from "@/lib/robotsSitemapTypes";
import { useToolEvents } from "@/lib/useToolEvents";

const TOOL_PATH = "/seo-tools/robots-sitemap-validator" as const;
const MAX_REQUEST_BYTES = 2_200;
const MAX_EXPORT_BYTES = 512 * 1_024;
const PRODUCT_TOKEN = /^(?:\*|[A-Za-z_-]{1,64})$/;

type ValidatorKind = RobotsSitemapValidatorRequest["kind"];
type CheckCategory = ValidatorCheck["category"];
type ValidatorInputName = "url" | "path" | "userAgent";
type RequestBuildResult =
  | { request: RobotsSitemapValidatorRequest }
  | { message: string; field: ValidatorInputName };

const CATEGORY_ORDER: CheckCategory[] = [
  "error",
  "warning",
  "crawler_specific",
  "tool_limit",
  "unverifiable",
  "information",
  "pass",
];

const CATEGORY_META: Record<CheckCategory, { label: string; plural: string; marker: string }> = {
  error: { label: "Error", plural: "Errors", marker: "!" },
  warning: { label: "Warning", plural: "Warnings", marker: "!" },
  crawler_specific: { label: "Crawler-specific", plural: "Crawler-specific", marker: "C" },
  information: { label: "Information", plural: "Information", marker: "i" },
  tool_limit: { label: "Tool limit", plural: "Tool limits", marker: "L" },
  unverifiable: { label: "Unverifiable", plural: "Unverifiable", marker: "?" },
  pass: { label: "Passed", plural: "Passed", marker: "✓" },
};

const ERROR_MESSAGES: Record<RobotsSitemapApiErrorCode, string> = {
  invalid_request: "The request could not be read. Refresh the page and try again.",
  invalid_url: "Enter a supported public URL without credentials, a custom port, query string or fragment.",
  blocked_destination: "That address is not a public internet destination, so it cannot be checked.",
  dns_failed: "The hostname could not be resolved safely. Check the address and try again later.",
  fetch_timeout: "The fetch and validation did not finish within the shared 12-second safety limit.",
  too_many_redirects: "The file redirected more than three times or entered a redirect loop.",
  unsafe_redirect: "The file redirected to a destination that the safety policy will not follow.",
  remote_status: "The selected sitemap did not return a successful HTTP response.",
  unsupported_content: "The response encoding or document media type is not supported by this bounded validator.",
  response_too_large: "The response exceeded this validator's deliberately smaller transfer or decoded-size limit.",
  invalid_document: "The selected file is not a supported robots.txt or XML sitemap document.",
  validation_too_complex: "The document exceeded a fixed parser depth, element or structural safety limit.",
  fetch_failed: "The file could not be fetched safely. It may block automated requests or have a temporary network problem.",
};

function isValidatorResult(value: unknown): value is RobotsSitemapValidatorResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RobotsSitemapValidatorResult>;
  if (candidate.schemaVersion !== 1 || !["robots", "sitemap"].includes(candidate.kind ?? "")) return false;
  if (typeof candidate.requestedUrl !== "string" || typeof candidate.finalUrl !== "string") return false;
  if (!candidate.fetched || !candidate.summary || !Array.isArray(candidate.checks)) return false;
  return candidate.kind === "robots"
    ? "robots" in candidate && "evaluation" in candidate
    : "sitemap" in candidate;
}

function isRobotsResult(result: RobotsSitemapValidatorResult): result is RobotsValidatorResult {
  return result.kind === "robots";
}

function isSitemapResult(result: RobotsSitemapValidatorResult): result is SitemapValidatorResult {
  return result.kind === "sitemap";
}

function safeFilename(result: RobotsSitemapValidatorResult) {
  let hostname: string = result.kind;
  try {
    hostname = new URL(result.finalUrl).hostname;
  } catch {
    // The server validates finalUrl; a short fallback keeps export safe.
  }
  const safeHost = hostname.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safeHost || result.kind}-${result.kind}-validation.json`;
}

function categoryClass(category: CheckCategory) {
  return category.replace("_", "-");
}

function isSafePath(value: string) {
  return value.startsWith("/")
    && !value.includes("#")
    && !value.includes("\\")
    && !/%(?![0-9a-f]{2})/i.test(value)
    && !Array.from(value).some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 0x20 || point === 0x7f || (point >= 0xd800 && point <= 0xdfff);
    });
}

export function RobotsSitemapValidatorTool() {
  const [kind, setKind] = useState<ValidatorKind>("robots");
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [userAgent, setUserAgent] = useState("");
  const [result, setResult] = useState<RobotsSitemapValidatorResult | null>(null);
  const [error, setError] = useState("");
  const [invalidField, setInvalidField] = useState<ValidatorInputName | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const reportHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const { start: trackStart, complete: trackComplete, output: trackOutput, validationError: trackValidationError } = useToolEvents(TOOL_PATH);

  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (result) reportHeadingRef.current?.focus();
  }, [result]);

  const checksByCategory = useMemo(() => Object.fromEntries(
    CATEGORY_ORDER.map((category) => [
      category,
      result?.checks.filter((check) => check.category === category) ?? [],
    ]),
  ) as Record<CheckCategory, ValidatorCheck[]>, [result]);

  const reportExport = useMemo(() => {
    if (!result) return null;
    const text = `${JSON.stringify(result, null, 2)}\n`;
    const bytes = new Blob([text]).size;
    return bytes <= MAX_EXPORT_BYTES ? { text, bytes } : null;
  }, [result]);

  function resetReport() {
    setResult(null);
    setError("");
    setInvalidField(null);
    setNotice("");
  }

  function changeKind(nextKind: ValidatorKind) {
    if (nextKind === kind) return;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setKind(nextKind);
    setUrl("");
    setPath("");
    setUserAgent("");
    setBusy(false);
    resetReport();
  }

  function changeUrl(value: string) {
    setUrl(value);
    resetReport();
    if (value.trim()) trackStart();
  }

  function buildRequest(): RequestBuildResult {
    const rawUrl = url.trim();
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("scheme");
      if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) throw new Error("unsafe URL field");
    } catch {
      return {
        message: kind === "robots"
          ? "Enter a complete public website origin, such as https://example.com, without credentials, a port, query string or fragment."
          : "Enter one complete public .xml or .xml.gz sitemap URL without credentials, a port, query string or fragment.",
        field: "url",
      };
    }

    if (kind === "robots") {
      if (parsed.pathname !== "/") {
        return { message: "Robots mode accepts only a website origin. WebTaskKit adds the standard /robots.txt path itself.", field: "url" };
      }
      const optionalPath = path;
      if (optionalPath && !isSafePath(optionalPath)) {
        return { message: "The optional test path must start with / and contain valid percent escapes, no fragment, backslash, space, control character or unpaired surrogate.", field: "path" };
      }
      const optionalAgent = userAgent;
      if (optionalAgent && !PRODUCT_TOKEN.test(optionalAgent)) {
        return { message: "Use one crawler product token made from letters, hyphens or underscores, or enter *.", field: "userAgent" };
      }
      if (optionalAgent && !optionalPath) {
        return { message: "Enter a test path when specifying a crawler product token, or leave the crawler token blank.", field: "path" };
      }
      return {
        request: {
          kind: "robots",
          url: rawUrl,
          ...(optionalPath ? { path: optionalPath } : {}),
          ...(optionalAgent ? { userAgent: optionalAgent } : {}),
        },
      };
    }

    const pathname = parsed.pathname.toLowerCase();
    if (!pathname.endsWith(".xml") && !pathname.endsWith(".xml.gz")) {
      return { message: "Sitemap mode accepts the exact selected file URL ending in .xml or .xml.gz.", field: "url" };
    }
    return { request: { kind: "sitemap", url: rawUrl } };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetReport();
    const built = buildRequest();
    if ("message" in built) {
      setError(built.message);
      setInvalidField(built.field);
      trackValidationError();
      return;
    }
    const { request } = built;
    const requestBody = JSON.stringify(request);
    if (new Blob([requestBody]).size > MAX_REQUEST_BYTES) {
      setError("The combined URL, path and crawler token exceed the 2,200-byte request limit. Shorten the optional path or URL.");
      setInvalidField(kind === "robots" && path.trim() ? "path" : "url");
      trackValidationError();
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/robots-sitemap-validator", {
        method: "POST",
        body: requestBody,
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
          ? (payload as { error?: RobotsSitemapApiErrorCode }).error
          : undefined;
        setError(code && ERROR_MESSAGES[code] ? ERROR_MESSAGES[code] : ERROR_MESSAGES.fetch_failed);
        setInvalidField(code === "invalid_url" ? "url" : null);
        trackValidationError();
        return;
      }
      if (!isValidatorResult(payload) || payload.kind !== request.kind) {
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

  function cancel() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(false);
    setNotice("Check cancelled. No report was created.");
  }

  function clear() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setUrl("");
    setPath("");
    setUserAgent("");
    setBusy(false);
    resetReport();
  }

  async function copyReport() {
    if (!reportExport) {
      setNotice("This report is larger than the 512 KiB output-action limit.");
      return;
    }
    try {
      await navigator.clipboard.writeText(reportExport.text);
      setNotice("Report JSON copied to the clipboard.");
      trackOutput();
    } catch {
      setNotice("Clipboard access was unavailable. Use Download JSON instead.");
    }
  }

  function downloadReport() {
    if (!result || !reportExport) {
      setNotice("This report is larger than the 512 KiB output-action limit.");
      return;
    }
    const blob = new Blob([reportExport.text], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = safeFilename(result);
    link.rel = "noopener";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    setNotice("Report JSON downloaded.");
    trackOutput();
  }

  return (
    <div className="tool-workspace robots-sitemap-workspace">
      <form className="controls-panel robots-sitemap-input" onSubmit={submit} noValidate>
        <div className="panel-heading">
          <div><p className="panel-kicker">One public file</p><h2>Choose what to validate</h2></div>
          <span className="status-pill">Server fetch</span>
        </div>

        <fieldset className="validator-mode-picker" disabled={busy}>
          <legend>Validation mode</legend>
          <label className={kind === "robots" ? "is-selected" : undefined} htmlFor="validator-mode-robots" aria-label="Robots.txt validation mode">
            <input id="validator-mode-robots" type="radio" name="validator-mode" value="robots" checked={kind === "robots"} onChange={() => changeKind("robots")} />
            <span><strong>Robots.txt</strong><small>Fetch /robots.txt from one origin</small></span>
          </label>
          <label className={kind === "sitemap" ? "is-selected" : undefined} htmlFor="validator-mode-sitemap" aria-label="XML sitemap validation mode">
            <input id="validator-mode-sitemap" type="radio" name="validator-mode" value="sitemap" checked={kind === "sitemap"} onChange={() => changeKind("sitemap")} />
            <span><strong>XML sitemap</strong><small>Fetch one exact .xml or .xml.gz file</small></span>
          </label>
        </fieldset>

        <label className="field-label" htmlFor="robots-sitemap-url">
          {kind === "robots" ? "Website origin" : "XML sitemap URL"}
        </label>
        <input
          className="text-input validator-url-input"
          id="robots-sitemap-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={kind === "robots" ? 300 : 2_048}
          placeholder={kind === "robots" ? "https://example.com" : "https://example.com/sitemap.xml"}
          value={url}
          onChange={(event) => changeUrl(event.target.value)}
          aria-describedby="robots-sitemap-url-help robots-sitemap-security-note"
          aria-invalid={invalidField === "url"}
          aria-errormessage={invalidField === "url" ? "robots-sitemap-error" : undefined}
          disabled={busy}
          required
        />
        <p className="field-help" id="robots-sitemap-url-help">
          {kind === "robots"
            ? "Enter the final public origin only. WebTaskKit requests its standard /robots.txt file."
            : "Enter the exact public file to inspect. Child sitemaps and listed page URLs are never requested."}
        </p>

        {kind === "robots" ? (
          <div className="validator-optional-fields">
            <div>
              <label className="field-label" htmlFor="robots-test-path">Path to evaluate <span>(optional)</span></label>
              <input
                className="text-input"
                id="robots-test-path"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                maxLength={1_024}
                placeholder="/private/report"
                value={path}
                onChange={(event) => { setPath(event.target.value); resetReport(); }}
                aria-describedby="robots-test-path-help"
                aria-invalid={invalidField === "path"}
                aria-errormessage={invalidField === "path" ? "robots-sitemap-error" : undefined}
                disabled={busy}
              />
              <p className="field-help" id="robots-test-path-help">Path only—no domain or fragment. A query may participate in rule matching; the path is evaluated, never fetched.</p>
            </div>
            <div>
              <label className="field-label" htmlFor="robots-user-agent">Crawler product token <span>(optional)</span></label>
              <input
                className="text-input"
                id="robots-user-agent"
                type="text"
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                placeholder="Googlebot or *"
                value={userAgent}
                onChange={(event) => { setUserAgent(event.target.value); resetReport(); }}
                aria-describedby="robots-user-agent-help"
                aria-invalid={invalidField === "userAgent"}
                aria-errormessage={invalidField === "userAgent" ? "robots-sitemap-error" : undefined}
                disabled={busy}
              />
              <p className="field-help" id="robots-user-agent-help">Use letters, hyphens or underscores. Empty uses the universal * group.</p>
            </div>
          </div>
        ) : null}

        {error ? <div className="error-box robots-sitemap-error" id="robots-sitemap-error" role="alert"><strong>Validation not completed</strong><span>{error}</span></div> : null}

        <div className="tool-actions">
          <button className="button button--primary" type="submit" disabled={busy || !url.trim()}>
            {busy ? "Checking file…" : kind === "robots" ? "Check robots.txt" : "Validate sitemap"}
          </button>
          <button className="button button--secondary" type="button" onClick={busy ? cancel : clear} disabled={!busy && !url && !path && !userAgent && !result && !error}>
            {busy ? "Cancel" : "Clear"}
          </button>
        </div>

        <aside className="tool-callout validator-security-note" id="robots-sitemap-security-note">
          <strong>Use only public, non-sensitive URLs</strong>
          <p>WebTaskKit fetches one selected file with strict network limits. Do not submit private dashboards, signed links, access tokens or confidential endpoints.</p>
        </aside>
      </form>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {busy ? "Fetching and validating one bounded response." : error ? "" : notice || (result ? "Validation complete. The categorized findings report is ready." : "")}
      </p>
      <section className="preview-panel robots-sitemap-results" aria-busy={busy}>
        {!result ? (
          <div className="empty-preview robots-sitemap-empty">
            <span aria-hidden="true">R/S</span>
            <strong>{busy ? "Fetching and parsing one bounded response…" : "Your categorized report will appear here"}</strong>
            <p>Errors, warnings, crawler-specific behavior, information, tool limits and unverifiable facts remain distinct. No ranking or health score is invented.</p>
            {notice ? <p className="validator-notice">{notice}</p> : null}
          </div>
        ) : (
          <div className="robots-sitemap-report">
            <div className="validator-report-heading">
              <div>
                <p className="panel-kicker">Bounded {result.kind === "robots" ? "robots.txt" : "XML sitemap"} report</p>
                <h2 ref={reportHeadingRef} tabIndex={-1}>Validation findings</h2>
                <a href={result.finalUrl} target="_blank" rel="noopener noreferrer">Open checked file <span aria-hidden="true">↗</span></a>
              </div>
              <div className="validator-output-actions" aria-label="Report output actions">
                <button className="button button--secondary" type="button" onClick={copyReport} disabled={!reportExport} aria-describedby={!reportExport ? "validator-export-limit" : undefined}>Copy JSON</button>
                <button className="button button--secondary" type="button" onClick={downloadReport} disabled={!reportExport} aria-describedby={!reportExport ? "validator-export-limit" : undefined}>Download JSON</button>
              </div>
            </div>
            {!reportExport ? <p className="validator-notice" id="validator-export-limit" role="status">Copy and download are unavailable because this report exceeds the 512 KiB output-action limit. The complete categorized report remains available on this page.</p> : null}

            <div className="validator-summary" aria-label="Finding category summary">
              <div className="is-error"><strong>{result.summary.errors}</strong><span>Errors</span></div>
              <div className="is-warning"><strong>{result.summary.warnings}</strong><span>Warnings</span></div>
              <div className="is-crawler-specific"><strong>{result.summary.crawlerSpecific}</strong><span>Crawler-specific</span></div>
              <div className="is-tool-limit"><strong>{result.summary.toolLimits}</strong><span>Tool limits</span></div>
              <div className="is-unverifiable"><strong>{result.summary.unverifiable}</strong><span>Unverifiable</span></div>
              <div className="is-information"><strong>{result.summary.information}</strong><span>Information</span></div>
              <div className="is-pass"><strong>{result.summary.passed}</strong><span>Passed</span></div>
            </div>
            <p className="validator-score-note">Category counts summarize this one bounded response. They are not a search, crawl or site-health score.</p>

            <dl className="validator-file-facts">
              <div><dt>Requested</dt><dd>{result.requestedUrl}</dd></div>
              <div><dt>Final response</dt><dd>HTTP {result.fetched.status} · {result.fetched.redirects} redirect{result.fetched.redirects === 1 ? "" : "s"}</dd></div>
              <div><dt>Media type</dt><dd>{result.fetched.contentType ?? "Not supplied"}</dd></div>
              <div><dt>Size checked</dt><dd>{Math.ceil(result.fetched.responseBytes / 1_024)} KiB downloaded · {Math.ceil(result.fetched.decodedBytes / 1_024)} KiB decoded</dd></div>
            </dl>

            {isRobotsResult(result) ? <RobotsDetails result={result} /> : null}
            {isSitemapResult(result) ? <SitemapDetails result={result} /> : null}

            <div className="validator-check-groups">
              {CATEGORY_ORDER.filter((category) => checksByCategory[category].length > 0).map((category) => {
                const meta = CATEGORY_META[category];
                const checks = checksByCategory[category];
                return (
                  <details className={`validator-category is-${categoryClass(category)}`} key={category} open={category === "error" || category === "warning" || category === "crawler_specific" || category === "tool_limit"}>
                    <summary><span>{meta.plural}</span><small>{checks.length} finding{checks.length === 1 ? "" : "s"}</small></summary>
                    <ul>
                      {checks.map((check) => (
                        <li className={`validator-check is-${categoryClass(category)}`} key={check.id}>
                          <span className="validator-check-marker" aria-hidden="true">{meta.marker}</span>
                          <div>
                            <strong><span className="sr-only">{meta.label}: </span>{check.label}</strong>
                            <p>{check.message}</p>
                            {check.evidence ? <small>{check.evidence}</small> : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>

            {notice ? <p className="validator-notice">{notice}</p> : null}
          </div>
        )}
      </section>
    </div>
  );
}

function RobotsDetails({ result }: { result: RobotsValidatorResult }) {
  const verdict = result.evaluation?.verdict;
  return (
    <div className="validator-document-details">
      <div className="validator-document-summary">
        <div><strong>{result.robots.groupCount}</strong><span>Groups</span></div>
        <div><strong>{result.robots.ruleCount}</strong><span>Rules</span></div>
        <div><strong>{result.robots.sitemapCount}</strong><span>Sitemap fields</span></div>
        <div><strong>{result.robots.lineCount}</strong><span>Lines checked</span></div>
      </div>

      {result.evaluation ? (
        <section className={`validator-evaluation is-${verdict}`} aria-labelledby="robots-evaluation-title">
          <div>
            <p className="panel-kicker">Evaluated only—never fetched</p>
            <h3 id="robots-evaluation-title">{result.evaluation.path}</h3>
          </div>
          <dl>
            <div><dt>Product token</dt><dd>{result.evaluation.userAgent}</dd></div>
            <div><dt>Verdict</dt><dd>{verdict === "no_matching_group" ? "No matching group" : verdict === "unverifiable" ? "Unverifiable from this response" : verdict === "allowed" ? "Allowed" : "Blocked"}</dd></div>
            <div><dt>Winning rule</dt><dd>{result.evaluation.matchedRule ? `${result.evaluation.matchedRule.directive}: ${result.evaluation.matchedRule.pattern} (line ${result.evaluation.matchedRule.line})` : "None"}</dd></div>
          </dl>
        </section>
      ) : null}

      {result.robots.sitemaps.length ? (
        <details className="validator-preview-block">
          <summary>Declared sitemap URLs <span>{result.robots.sitemaps.length} shown</span></summary>
          <ul className="validator-url-list">
            {result.robots.sitemaps.map((sitemap, index) => <li key={`${sitemap}-${index}`}><code>{sitemap}</code></li>)}
          </ul>
        </details>
      ) : null}

      {result.robots.previewGroups.length ? (
        <details className="validator-preview-block">
          <summary>Bounded rule-group preview <span>{result.robots.previewGroups.length} group{result.robots.previewGroups.length === 1 ? "" : "s"}</span></summary>
          <div className="validator-robots-groups">
            {result.robots.previewGroups.map((group, index) => (
              <section key={`${group.userAgents.join("-")}-${index}`}>
                <h4>User-agent: {group.userAgents.join(", ")}</h4>
                {group.rules.length ? (
                  <ul>{group.rules.map((rule, ruleIndex) => <li key={`${rule.line}-${ruleIndex}`}><code>{rule.directive}: {rule.pattern}</code><span>Line {rule.line}</span></li>)}</ul>
                ) : <p>No Allow or Disallow rules in this group.</p>}
              </section>
            ))}
          </div>
        </details>
      ) : null}

      {result.robots.truncated ? <p className="validator-inline-limit"><strong>Preview bounded:</strong> the report summary may cover more data than the rule and directive samples displayed here.</p> : null}
    </div>
  );
}

function SitemapDetails({ result }: { result: SitemapValidatorResult }) {
  return (
    <div className="validator-document-details">
      <div className="validator-document-summary">
        <div><strong>{result.sitemap.entryCount}</strong><span>{result.sitemap.type === "urlset" ? "URL entries" : "Child sitemaps"}</span></div>
        <div><strong>{result.sitemap.validLocationCount}</strong><span>Valid locations</span></div>
        <div><strong>{result.sitemap.invalidLocationCount}</strong><span>Invalid locations</span></div>
        <div><strong>{result.sitemap.duplicateLocationCount}</strong><span>Duplicates</span></div>
        <div><strong>{result.sitemap.lastModifiedCount}</strong><span>With lastmod</span></div>
      </div>
      <p className="validator-document-type"><strong>Document type:</strong> {result.sitemap.type === "urlset" ? "URL set" : "Sitemap index"}. Listed locations are summarized, never requested.</p>

      {result.sitemap.previewEntries.length ? (
        <details className="validator-preview-block">
          <summary>Bounded entry preview <span>{result.sitemap.previewEntries.length} entr{result.sitemap.previewEntries.length === 1 ? "y" : "ies"}</span></summary>
          <ol className="validator-sitemap-entries">
            {result.sitemap.previewEntries.map((entry, index) => (
              <li key={`${entry.location ?? "missing"}-${index}`}>
                <code>{entry.location ?? "Missing <loc>"}</code>
                <dl>
                  <div><dt>lastmod</dt><dd>{entry.lastModified ?? "Not supplied"}</dd></div>
                  {entry.changeFrequency !== undefined ? <div><dt>changefreq</dt><dd>{entry.changeFrequency ?? "Not supplied"}</dd></div> : null}
                  {entry.priority !== undefined ? <div><dt>priority</dt><dd>{entry.priority ?? "Not supplied"}</dd></div> : null}
                </dl>
                {entry.issues.length ? <ul>{entry.issues.map((issue, issueIndex) => <li key={`${issue}-${issueIndex}`}>{issue}</li>)}</ul> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}

      {result.sitemap.truncated ? <p className="validator-inline-limit"><strong>Preview bounded:</strong> all entries in the accepted document were checked and summarized in the counts, but only the first {result.sitemap.previewEntries.length} entries are returned here.</p> : null}
    </div>
  );
}
