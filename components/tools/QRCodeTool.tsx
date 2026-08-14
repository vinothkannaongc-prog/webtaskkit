"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useToolEvents } from "@/lib/useToolEvents";

type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";

const PREVIEW_SIZE = 480;

function saveDownload(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function QRCodeTool() {
  const contentId = useId();
  const {
    start: trackStart,
    complete: trackComplete,
    output: trackOutput,
    validationError: trackValidationError,
  } = useToolEvents("/generators/qr-code");
  const [content, setContent] = useState("https://webtaskkit.com");
  const [foreground, setForeground] = useState("#102026");
  const [background, setBackground] = useState("#ffffff");
  const [errorCorrection, setErrorCorrection] = useState<ErrorCorrectionLevel>("M");
  const [size, setSize] = useState(1024);
  const [margin, setMargin] = useState(4);
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState("Preparing your QR code…");
  const latestRequest = useRef(0);

  useEffect(() => {
    const request = ++latestRequest.current;
    const cleanContent = content.trim();

    const timer = window.setTimeout(async () => {
      if (!cleanContent) {
        setPreview("");
        setStatus("Enter a link or text to create a QR code.");
        trackValidationError();
        return;
      }

      try {
        setStatus("Updating preview…");
        const QRCode = await import("qrcode");
        const image = await QRCode.toDataURL(cleanContent, {
          width: PREVIEW_SIZE,
          margin,
          errorCorrectionLevel: errorCorrection,
          color: { dark: foreground, light: background },
        });

        if (request === latestRequest.current) {
          setPreview(image);
          setStatus("QR code ready.");
          trackComplete();
        }
      } catch {
        if (request === latestRequest.current) {
          setPreview("");
          setStatus("We could not create this QR code. Try shorter text.");
          trackValidationError();
        }
      }
    }, 120);

    return () => window.clearTimeout(timer);
  }, [background, content, errorCorrection, foreground, margin, trackComplete, trackValidationError]);

  async function downloadPng() {
    trackStart();
    const cleanContent = content.trim();
    if (!cleanContent) {
      trackValidationError();
      return;
    }

    try {
      setStatus("Creating PNG…");
      const QRCode = await import("qrcode");
      const dataUrl = await QRCode.toDataURL(cleanContent, {
        width: size,
        margin,
        errorCorrectionLevel: errorCorrection,
        color: { dark: foreground, light: background },
      });
      saveDownload(dataUrl, "webtaskkit-qr-code.png");
      setStatus(`Downloaded a ${size} × ${size} PNG.`);
      trackComplete();
      trackOutput();
    } catch {
      setStatus("PNG export failed. Please try again.");
      trackValidationError();
    }
  }

  async function downloadSvg() {
    trackStart();
    const cleanContent = content.trim();
    if (!cleanContent) {
      trackValidationError();
      return;
    }

    try {
      setStatus("Creating SVG…");
      const QRCode = await import("qrcode");
      const svg = await QRCode.toString(cleanContent, {
        type: "svg",
        width: size,
        margin,
        errorCorrectionLevel: errorCorrection,
        color: { dark: foreground, light: background },
      });
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      saveDownload(url, "webtaskkit-qr-code.svg");
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus("Downloaded a scalable SVG.");
      trackComplete();
      trackOutput();
    } catch {
      setStatus("SVG export failed. Please try again.");
      trackValidationError();
    }
  }

  const isEmpty = !content.trim();

  return (
    <div className="tool-workspace qr-workspace">
      <div className="tool-controls">
        <div className="field-group">
          <label className="field-label" htmlFor={contentId}>Link or text</label>
          <textarea
            id={contentId}
            className="tool-textarea"
            rows={4}
            value={content}
            onChange={(event) => { trackStart(); setContent(event.target.value); }}
            placeholder="https://example.com or any short message"
            spellCheck={false}
          />
          <p className="field-hint">Everything stays in this browser tab.</p>
        </div>

        <fieldset className="control-fieldset">
          <legend>Colors</legend>
          <div className="color-control-grid">
            <label className="color-control">
              <span>Foreground</span>
              <span className="color-input-wrap">
                <input
                  type="color"
                  value={foreground}
                  onChange={(event) => { trackStart(); setForeground(event.target.value); }}
                  aria-label="QR code foreground color"
                />
                <span>{foreground.toUpperCase()}</span>
              </span>
            </label>
            <label className="color-control">
              <span>Background</span>
              <span className="color-input-wrap">
                <input
                  type="color"
                  value={background}
                  onChange={(event) => { trackStart(); setBackground(event.target.value); }}
                  aria-label="QR code background color"
                />
                <span>{background.toUpperCase()}</span>
              </span>
            </label>
          </div>
        </fieldset>

        <div className="control-grid control-grid--three">
          <label className="field-group">
            <span className="field-label">Error recovery</span>
            <select
              className="tool-select"
              value={errorCorrection}
              onChange={(event) => { trackStart(); setErrorCorrection(event.target.value as ErrorCorrectionLevel); }}
            >
              <option value="L">Low · 7%</option>
              <option value="M">Medium · 15%</option>
              <option value="Q">Quartile · 25%</option>
              <option value="H">High · 30%</option>
            </select>
          </label>
          <label className="field-group">
            <span className="field-label">Export size</span>
            <select className="tool-select" value={size} onChange={(event) => { trackStart(); setSize(Number(event.target.value)); }}>
              <option value={512}>512 px</option>
              <option value={1024}>1024 px</option>
              <option value={2048}>2048 px</option>
            </select>
          </label>
          <label className="field-group">
            <span className="field-label">Quiet zone</span>
            <select className="tool-select" value={margin} onChange={(event) => { trackStart(); setMargin(Number(event.target.value)); }}>
              <option value={2}>Narrow</option>
              <option value={4}>Standard</option>
              <option value={8}>Wide</option>
            </select>
          </label>
        </div>

        <div className="button-row">
          <button className="button button--primary" type="button" onClick={downloadPng} disabled={isEmpty || !preview}>
            Download PNG
          </button>
          <button className="button button--secondary" type="button" onClick={downloadSvg} disabled={isEmpty || !preview}>
            Download SVG
          </button>
        </div>
      </div>

      <div className="tool-preview qr-preview">
        <div className="preview-heading">
          <span>Live preview</span>
          <span className="status-dot" aria-hidden="true" />
        </div>
        <div className="qr-canvas" style={{ backgroundColor: background }}>
          {preview ? (
            // The image is generated locally and changes immediately with the controls.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Generated QR code preview" width={PREVIEW_SIZE} height={PREVIEW_SIZE} />
          ) : (
            <div className="empty-preview" aria-hidden="true">QR</div>
          )}
        </div>
        <p className="tool-status" role="status" aria-live="polite">{status}</p>
      </div>
    </div>
  );
}
