"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";

const MAX_FILE_BYTES = 750_000;
const STARTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" role="img" aria-labelledby="title desc">
  <title id="title">WebTaskKit sample</title>
  <desc id="desc">A teal circle and a calm typographic label.</desc>
  <rect width="640" height="360" rx="32" fill="#f6f8fa"/>
  <circle cx="168" cy="180" r="76" fill="#0f766e"/>
  <path d="M140 180h56M168 152v56" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
  <text x="264" y="194" fill="#102026" font-family="system-ui, sans-serif" font-size="42" font-weight="700">WebTaskKit</text>
</svg>`;

type SanitizedSvg = {
  markup: string;
  removed: number;
};

const subscribeToBrowserState = () => () => undefined;
const getBrowserSnapshot = () => true;
const getServerSnapshot = () => false;

function sanitizeSvg(source: string): SanitizedSvg {
  if (!source.trim()) throw new Error("Add SVG source to see a preview.");
  if (/<!\s*(?:doctype|entity)\b/i.test(source)) {
    throw new Error("DOCTYPE and ENTITY declarations are not supported.");
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(source, "image/svg+xml");
  const parseError = documentNode.querySelector("parsererror");
  if (parseError) throw new Error("The SVG contains invalid XML. Check its tags and attributes.");

  const root = documentNode.documentElement;
  if (root.localName.toLowerCase() !== "svg") throw new Error("The document must begin with an <svg> element.");

  let removed = 0;
  if (root.namespaceURI && root.namespaceURI !== "http://www.w3.org/2000/svg") {
    throw new Error("The root element must use the standard SVG namespace.");
  }

  const forbiddenElements = new Set([
    "script", "foreignobject", "iframe", "object", "embed", "link", "meta", "base", "style",
  ]);
  Array.from(root.querySelectorAll("*")).forEach((element) => {
    if (forbiddenElements.has(element.localName.toLowerCase())) {
      element.remove();
      removed += 1;
    }
  });

  const allElements = [root, ...Array.from(root.querySelectorAll("*"))];
  allElements.forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      const isEventHandler = name.startsWith("on");
      const isNetworkAttribute = ["src", "srcset", "poster", "action", "formaction", "xml:base"].includes(name);
      const isHref = name === "href" || name === "xlink:href";
      const hasControlCharacter = Array.from(value).some((character) => (character.codePointAt(0) ?? 0) < 32);
      const hrefIsUnsafe = isHref && (!value.startsWith("#") || hasControlCharacter);
      const styleIsUnsafe = name === "style" && /url\s*\(|@import|expression\s*\(|javascript\s*:|behavior\s*:|-moz-binding/i.test(value);
      const hasExternalUrlFunction = /url\s*\(\s*['"]?(?!#)/i.test(value);
      const valueIsScript = /(?:javascript|vbscript)\s*:/i.test(value);

      if (isEventHandler || isNetworkAttribute || hrefIsUnsafe || styleIsUnsafe || hasExternalUrlFunction || valueIsScript) {
        element.removeAttribute(attribute.name);
        removed += 1;
      }
    });
  });

  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const markup = new XMLSerializer().serializeToString(root);
  return { markup, removed };
}

function safeSvgFilename(filename: string) {
  const stem = filename
    .replace(/\.svg$/i, "")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${stem || "webtaskkit-clean"}.svg`;
}

export function SvgEditorTool() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState(STARTER_SVG);
  const [filename, setFilename] = useState("webtaskkit-sample.svg");
  const [status, setStatus] = useState("Safe preview ready.");
  const canUseDomParser = useSyncExternalStore(
    subscribeToBrowserState,
    getBrowserSnapshot,
    getServerSnapshot,
  );

  const sanitized = useMemo(() => {
    if (!canUseDomParser) return { result: null, error: "Checking SVG…" };
    try {
      return { result: sanitizeSvg(source), error: "" };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : "This SVG is not valid.",
      };
    }
  }, [canUseDomParser, source]);

  function updateSource(value: string) {
    if (new Blob([value]).size > MAX_FILE_BYTES) {
      setStatus("That SVG is over the 750 KB editor limit.");
      return;
    }
    setSource(value);
    setStatus("SVG checked locally.");
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setStatus("That SVG is over the 750 KB editor limit. Choose a smaller file.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".svg")) {
      setStatus("Choose a file ending in .svg.");
      return;
    }

    try {
      const contents = await file.text();
      updateSource(contents);
      setFilename(file.name);
      setStatus(`${file.name} loaded and checked locally.`);
    } catch {
      setStatus("WebTaskKit could not read that SVG file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function downloadCleanSvg() {
    if (!sanitized.result) {
      setStatus("Fix the SVG error before downloading.");
      return;
    }
    const blob = new Blob([sanitized.result.markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeSvgFilename(filename);
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Clean SVG downloaded.");
  }

  const byteCount = new Blob([source]).size;

  return (
    <div className="tool-workspace tool-layout svg-editor-workspace">
      <section className="tool-controls input-panel" aria-labelledby="svg-source-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Source</p>
            <h2 id="svg-source-heading">Edit SVG markup</h2>
          </div>
          <button className="button button--ghost" type="button" onClick={() => fileInputRef.current?.click()}>
            Upload SVG
          </button>
        </div>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".svg,image/svg+xml"
          onChange={(event) => void loadFile(event.target.files?.[0])}
          aria-label="Upload an SVG file"
        />
        <label className="sr-only" htmlFor="svg-source">SVG source code</label>
        <textarea
          className="form-control code-input svg-source-input"
          id="svg-source"
          value={source}
          onChange={(event) => updateSource(event.target.value)}
          spellCheck={false}
          rows={22}
          aria-describedby="svg-validation-status"
        />
        <div className="input-meta help-text">
          <span>{byteCount.toLocaleString()} / {MAX_FILE_BYTES.toLocaleString()} bytes</span>
          <button className="text-action" type="button" onClick={() => { setSource(STARTER_SVG); setFilename("webtaskkit-sample.svg"); setStatus("Sample restored."); }}>
            Restore sample
          </button>
        </div>
      </section>

      <section className="tool-preview preview-panel" aria-labelledby="svg-preview-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Sanitized output</p>
            <h2 id="svg-preview-heading">Safe preview</h2>
          </div>
          {sanitized.result && <span className="status-chip status-chip--success">Valid SVG</span>}
        </div>

        <div className="svg-preview-stage svg-preview preview-box">
          {sanitized.result ? (
            <iframe
              className="svg-preview-frame"
              title="Sanitized SVG preview"
              sandbox=""
              style={{ width: "100%", height: 320, border: 0, background: "#fff" }}
              srcDoc={`<!doctype html><meta name="viewport" content="width=device-width"><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:#fff}svg{display:block;max-width:92%;max-height:92%;width:auto;height:auto}</style>${sanitized.result.markup}`}
            />
          ) : (
            <div className="preview-empty" role="img" aria-label="No preview available">
              <span aria-hidden="true">&lt;/&gt;</span>
              <p>Fix the markup to restore the preview.</p>
            </div>
          )}
        </div>

        <div
          id="svg-validation-status"
          className={`inline-notice safety-note ${sanitized.error ? "inline-notice--error status-error" : "inline-notice--success status-success"}`}
          role="status"
          aria-live="polite"
        >
          {sanitized.error || (sanitized.result?.removed
            ? `${sanitized.result.removed} potentially unsafe item${sanitized.result.removed === 1 ? " was" : "s were"} removed from the preview and download.`
            : "No unsafe scripts, external links, or risky styles found.")}
        </div>

        <button className="button button--primary button--wide" type="button" onClick={downloadCleanSvg} disabled={!sanitized.result}>
          Download clean SVG
        </button>
        <p className="status-message" role="status" aria-live="polite">{status}</p>
      </section>
    </div>
  );
}
