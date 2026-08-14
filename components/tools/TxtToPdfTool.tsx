"use client";

import { useMemo, useRef, useState } from "react";
import { useToolEvents } from "@/lib/useToolEvents";

const MAX_FILE_BYTES = 500_000;
const MILLIMETRES_PER_POINT = 0.352778;

type PageSize = "a4" | "letter";

function safePdfName(title: string) {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${cleaned || "webtaskkit-document"}.pdf`;
}

export function TxtToPdfTool() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    start: trackStart,
    complete: trackComplete,
    output: trackOutput,
    validationError: trackValidationError,
  } = useToolEvents("/converters/txt-to-pdf");
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [pageSize, setPageSize] = useState<PageSize>("a4");
  const [fontSize, setFontSize] = useState(11);
  const [margin, setMargin] = useState(18);
  const [status, setStatus] = useState("Ready for a text file or pasted text.");

  const byteCount = useMemo(() => new Blob([text]).size, [text]);
  const hasExtendedCharacters = useMemo(
    () => Array.from(text).some((character) => (character.codePointAt(0) ?? 0) > 255),
    [text],
  );

  function updateText(value: string) {
    trackStart();
    const nextSize = new Blob([value]).size;
    if (nextSize > MAX_FILE_BYTES) {
      setStatus("That text is over the 500 KB limit. Shorten it, then try again.");
      trackValidationError();
      return false;
    }
    setText(value);
    setStatus(value ? "Text is ready to convert." : "Ready for a text file or pasted text.");
    return true;
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    trackStart();
    if (file.size > MAX_FILE_BYTES) {
      setStatus("That file is over the 500 KB limit. Choose a smaller TXT, MD, or LOG file.");
      trackValidationError();
      return;
    }

    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["txt", "md", "log"].includes(extension)) {
      setStatus("Choose a .txt, .md, or .log file.");
      trackValidationError();
      return;
    }

    try {
      const contents = await file.text();
      if (!updateText(contents)) return;
      if (!title) setTitle(file.name.replace(/\.[^.]+$/, ""));
      setStatus(`${file.name} is ready to convert.`);
    } catch {
      setStatus("WebTaskKit could not read that file. Try another plain-text file.");
      trackValidationError();
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function downloadPdf() {
    trackStart();
    if (!text.trim()) {
      setStatus("Add some text before creating a PDF.");
      trackValidationError();
      return;
    }

    if (new Blob([text]).size > MAX_FILE_BYTES) {
      setStatus("That text is over the 500 KB limit. Shorten it, then try again.");
      trackValidationError();
      return;
    }

    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ format: pageSize, unit: "mm", orientation: "portrait" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const usableWidth = pageWidth - margin * 2;
      const lineHeight = fontSize * MILLIMETRES_PER_POINT * 1.45;
      let y = margin;

      const ensureRoom = (height = lineHeight) => {
        if (y + height > pageHeight - margin) {
          pdf.addPage();
          y = margin;
        }
      };

      if (title.trim()) {
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(Math.min(fontSize + 5, 24));
        const titleLines = pdf.splitTextToSize(title.trim(), usableWidth) as string[];
        const titleLineHeight = (fontSize + 5) * MILLIMETRES_PER_POINT * 1.35;
        titleLines.forEach((line) => {
          ensureRoom(titleLineHeight);
          pdf.text(line, margin, y);
          y += titleLineHeight;
        });
        y += lineHeight * 0.45;
      }

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(fontSize);
      const logicalLines = text.replace(/\t/g, "    ").split(/\r\n|\r|\n/);

      logicalLines.forEach((logicalLine) => {
        const wrapped = logicalLine
          ? (pdf.splitTextToSize(logicalLine, usableWidth) as string[])
          : [""];
        wrapped.forEach((line) => {
          ensureRoom();
          if (line) pdf.text(line, margin, y);
          y += lineHeight;
        });
      });

      pdf.setProperties({
        title: title.trim() || "WebTaskKit document",
        creator: "WebTaskKit TXT to PDF Converter",
      });
      pdf.save(safePdfName(title));
      setStatus("PDF created and downloaded.");
      trackComplete();
      trackOutput();
    } catch {
      setStatus("The PDF could not be created. Try less text or a smaller font size.");
      trackValidationError();
    }
  }

  return (
    <div className="tool-workspace tool-layout txt-pdf-workspace">
      <section className="tool-controls input-panel" aria-labelledby="txt-pdf-input-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Your text</p>
            <h2 id="txt-pdf-input-heading">Write or upload</h2>
          </div>
          <button className="button button--ghost" type="button" onClick={() => fileInputRef.current?.click()}>
            Upload file
          </button>
        </div>

        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".txt,.md,.log,text/plain,text/markdown"
          onChange={(event) => void loadFile(event.target.files?.[0])}
          aria-label="Upload a TXT, Markdown, or log file"
        />

        <div className="form-group">
          <label className="field-label" htmlFor="pdf-title">Document title <span>optional</span></label>
          <input
            className="form-control"
            id="pdf-title"
            type="text"
            value={title}
            maxLength={120}
            onChange={(event) => { trackStart(); setTitle(event.target.value); }}
            placeholder="Project notes"
          />
        </div>

        <div className="form-group">
          <label className="field-label" htmlFor="pdf-text">Plain text</label>
          <textarea
            className="form-control code-input text-editor-input"
            id="pdf-text"
            value={text}
            onChange={(event) => updateText(event.target.value)}
            placeholder="Paste text here, or upload a TXT, MD, or LOG file…"
            spellCheck
            rows={17}
          />
        </div>
        <div className="input-meta help-text">
          <span>{byteCount.toLocaleString()} / {MAX_FILE_BYTES.toLocaleString()} bytes</span>
          <span>Processed in this browser</span>
        </div>
      </section>

      <section className="tool-preview preview-panel" aria-labelledby="txt-pdf-settings-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PDF setup</p>
            <h2 id="txt-pdf-settings-heading">Format the page</h2>
          </div>
        </div>

        <div className="control-row form-group">
          <label className="field-group field" htmlFor="pdf-page-size">
            <span className="field-label">Page size</span>
            <select
              className="form-control"
              id="pdf-page-size"
              value={pageSize}
              onChange={(event) => { trackStart(); setPageSize(event.target.value as PageSize); }}
            >
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
            </select>
          </label>
          <label className="field-group field" htmlFor="pdf-font-size">
            <span className="field-label">Font size</span>
            <select
              className="form-control"
              id="pdf-font-size"
              value={fontSize}
              onChange={(event) => { trackStart(); setFontSize(Number(event.target.value)); }}
            >
              {[9, 10, 11, 12, 14, 16].map((size) => <option key={size} value={size}>{size} pt</option>)}
            </select>
          </label>
        </div>

        <label className="field-group field form-group" htmlFor="pdf-margin">
          <span className="field-label">Margins <output>{margin} mm</output></span>
          <input
            id="pdf-margin"
            type="range"
            min="10"
            max="30"
            step="1"
            value={margin}
            onChange={(event) => { trackStart(); setMargin(Number(event.target.value)); }}
          />
        </label>

        <div className="document-preview preview-box" aria-hidden="true">
          <span className="document-preview__title" />
          {Array.from({ length: 9 }, (_, index) => <span key={index} style={{ width: `${92 - (index % 3) * 13}%` }} />)}
        </div>

        {hasExtendedCharacters && (
          <p className="inline-notice inline-notice--warning warning-note">
            The built-in PDF font is best for Latin text. Some emoji and non-Latin characters may be substituted.
          </p>
        )}

        <button className="button button--primary button--wide" type="button" onClick={() => void downloadPdf()} disabled={!text.trim()}>
          Download PDF
        </button>
        <button
          className="button button--ghost button--wide"
          type="button"
          onClick={() => { trackStart(); setText(""); setTitle(""); setStatus("Text cleared."); }}
          disabled={!text && !title}
        >
          Clear
        </button>
        <p className="status-message" role="status" aria-live="polite">{status}</p>
      </section>
    </div>
  );
}
