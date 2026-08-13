"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

type BarcodeFormat = "CODE128" | "EAN13" | "UPC" | "EAN8" | "ITF14";

type ValidationResult = {
  value: string;
  error: string;
  note?: string;
};

const FORMATS: { value: BarcodeFormat; label: string; placeholder: string }[] = [
  { value: "CODE128", label: "Code 128", placeholder: "ORDER-2026-001" },
  { value: "EAN13", label: "EAN-13", placeholder: "590123412345" },
  { value: "UPC", label: "UPC-A", placeholder: "03600029145" },
  { value: "EAN8", label: "EAN-8", placeholder: "5512345" },
  { value: "ITF14", label: "ITF-14", placeholder: "1001234500001" },
];

function checkDigit(value: string) {
  const sum = [...value]
    .reverse()
    .reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

function validateBarcode(rawValue: string, format: BarcodeFormat): ValidationResult {
  const value = rawValue.trim();

  if (format === "CODE128") {
    if (!value) return { value: "", error: "Enter a value to generate a barcode." };
    if (value.length > 80) return { value: "", error: "Code 128 is limited to 80 characters here for a readable result." };
    if (!/^[\x20-\x7E]+$/.test(value)) return { value: "", error: "Code 128 supports printable ASCII characters in this tool." };
    return { value, error: "" };
  }

  const specifications: Record<Exclude<BarcodeFormat, "CODE128">, { short: number; full: number; name: string }> = {
    EAN13: { short: 12, full: 13, name: "EAN-13" },
    UPC: { short: 11, full: 12, name: "UPC-A" },
    EAN8: { short: 7, full: 8, name: "EAN-8" },
    ITF14: { short: 13, full: 14, name: "ITF-14" },
  };
  const specification = specifications[format];

  if (!/^\d+$/.test(value)) {
    return { value: "", error: `${specification.name} accepts digits only.` };
  }
  if (value.length !== specification.short && value.length !== specification.full) {
    return {
      value: "",
      error: `${specification.name} needs ${specification.short} digits without a check digit, or ${specification.full} with one.`,
    };
  }

  if (value.length === specification.short) {
    const digit = checkDigit(value);
    return { value: value + digit, error: "", note: `Check digit ${digit} was added automatically.` };
  }

  const expected = checkDigit(value.slice(0, -1));
  if (value.at(-1) !== expected) {
    return { value: "", error: `The check digit is not valid. Expected ${expected}.` };
  }
  return { value, error: "", note: "The supplied check digit is valid." };
}

function saveDownload(href: string, filename: string) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function BarcodeTool() {
  const valueId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const renderRequest = useRef(0);
  const [format, setFormat] = useState<BarcodeFormat>("CODE128");
  const [rawValue, setRawValue] = useState("ORDER-2026-001");
  const [foreground, setForeground] = useState("#102026");
  const [background, setBackground] = useState("#ffffff");
  const [barWidth, setBarWidth] = useState(2);
  const [barHeight, setBarHeight] = useState(96);
  const [showText, setShowText] = useState(true);
  const [status, setStatus] = useState("Barcode ready.");
  const validation = useMemo(() => validateBarcode(rawValue, format), [format, rawValue]);

  useEffect(() => {
    const request = ++renderRequest.current;
    const element = svgRef.current;

    if (!element || validation.error) {
      element?.replaceChildren();
      setStatus(validation.error || "Enter a value to generate a barcode.");
      return;
    }

    const render = async () => {
      try {
        setStatus("Updating preview…");
        const { default: JsBarcode } = await import("jsbarcode");
        if (request !== renderRequest.current || !svgRef.current) return;
        JsBarcode(svgRef.current, validation.value, {
          format,
          width: barWidth,
          height: barHeight,
          displayValue: showText,
          lineColor: foreground,
          background,
          margin: 16,
          font: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 18,
        });
        setStatus(validation.note || "Barcode ready.");
      } catch {
        svgRef.current?.replaceChildren();
        setStatus("This value cannot be encoded in the selected format.");
      }
    };

    void render();
  }, [background, barHeight, barWidth, foreground, format, showText, validation.error, validation.note, validation.value]);

  function changeFormat(nextFormat: BarcodeFormat) {
    setFormat(nextFormat);
    const examples: Record<BarcodeFormat, string> = {
      CODE128: "ORDER-2026-001",
      EAN13: "590123412345",
      UPC: "03600029145",
      EAN8: "5512345",
      ITF14: "1001234500001",
    };
    setRawValue(examples[nextFormat]);
  }

  function downloadSvg() {
    if (validation.error || !svgRef.current?.childNodes.length) return;
    const clone = svgRef.current.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const source = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
    saveDownload(url, `quiettools-${format.toLowerCase()}-barcode.svg`);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setStatus("Downloaded a scalable SVG.");
  }

  async function downloadPng() {
    if (validation.error) return;
    try {
      setStatus("Creating PNG…");
      const { default: JsBarcode } = await import("jsbarcode");
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, validation.value, {
        format,
        width: barWidth,
        height: barHeight,
        displayValue: showText,
        lineColor: foreground,
        background,
        margin: 24,
        font: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 18,
      });
      saveDownload(canvas.toDataURL("image/png"), `quiettools-${format.toLowerCase()}-barcode.png`);
      setStatus("Downloaded a PNG.");
    } catch {
      setStatus("PNG export failed. Check the value and try again.");
    }
  }

  const currentFormat = FORMATS.find((item) => item.value === format) ?? FORMATS[0];
  const cannotExport = Boolean(validation.error);

  return (
    <div className="tool-workspace barcode-workspace">
      <div className="tool-controls">
        <label className="field-group">
          <span className="field-label">Barcode format</span>
          <select className="tool-select" value={format} onChange={(event) => changeFormat(event.target.value as BarcodeFormat)}>
            {FORMATS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>

        <div className="field-group">
          <label className="field-label" htmlFor={valueId}>Value</label>
          <input
            id={valueId}
            className="tool-input tool-input--mono"
            type="text"
            inputMode={format === "CODE128" ? "text" : "numeric"}
            value={rawValue}
            onChange={(event) => setRawValue(event.target.value)}
            placeholder={currentFormat.placeholder}
            spellCheck={false}
            aria-invalid={Boolean(validation.error)}
            aria-describedby={`${valueId}-message`}
          />
          <p id={`${valueId}-message`} className={validation.error ? "field-message field-message--error" : "field-hint"}>
            {validation.error || validation.note || (format === "CODE128" ? "Letters, numbers and common punctuation are supported." : "You may omit the final check digit.")}
          </p>
        </div>

        <div className="control-grid control-grid--two">
          <label className="field-group">
            <span className="field-label">Bar width</span>
            <select className="tool-select" value={barWidth} onChange={(event) => setBarWidth(Number(event.target.value))}>
              <option value={1}>Fine</option>
              <option value={2}>Standard</option>
              <option value={3}>Wide</option>
            </select>
          </label>
          <label className="field-group">
            <span className="field-label">Bar height</span>
            <select className="tool-select" value={barHeight} onChange={(event) => setBarHeight(Number(event.target.value))}>
              <option value={64}>Compact</option>
              <option value={96}>Standard</option>
              <option value={128}>Tall</option>
            </select>
          </label>
        </div>

        <fieldset className="control-fieldset">
          <legend>Colors</legend>
          <div className="color-control-grid">
            <label className="color-control">
              <span>Bars</span>
              <span className="color-input-wrap">
                <input type="color" value={foreground} onChange={(event) => setForeground(event.target.value)} aria-label="Barcode bar color" />
                <span>{foreground.toUpperCase()}</span>
              </span>
            </label>
            <label className="color-control">
              <span>Background</span>
              <span className="color-input-wrap">
                <input type="color" value={background} onChange={(event) => setBackground(event.target.value)} aria-label="Barcode background color" />
                <span>{background.toUpperCase()}</span>
              </span>
            </label>
          </div>
        </fieldset>

        <label className="toggle-control">
          <input type="checkbox" checked={showText} onChange={(event) => setShowText(event.target.checked)} />
          <span>Show human-readable value</span>
        </label>

        <div className="button-row">
          <button className="button button--primary" type="button" onClick={downloadPng} disabled={cannotExport}>Download PNG</button>
          <button className="button button--secondary" type="button" onClick={downloadSvg} disabled={cannotExport}>Download SVG</button>
        </div>

        <aside className="tool-callout tool-callout--warning" role="note">
          <strong>Bars are not registration.</strong>
          <span>Retail UPC, EAN and ITF identifiers must be assigned by GS1 or the authorized brand owner before commercial use.</span>
        </aside>
      </div>

      <div className="tool-preview barcode-preview">
        <div className="preview-heading">
          <span>Live preview</span>
          <span className="status-dot" aria-hidden="true" />
        </div>
        <div className="barcode-canvas" style={{ backgroundColor: background }}>
          <svg ref={svgRef} role="img" aria-label={`Generated ${currentFormat.label} barcode preview`} />
        </div>
        {validation.value && !validation.error ? <p className="preview-value">Encoded value: <code>{validation.value}</code></p> : null}
        <p className="tool-status" role="status" aria-live="polite">{status}</p>
      </div>
    </div>
  );
}
