"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useToolEvents } from "@/lib/useToolEvents";

const MAX_FILE_BYTES = 500_000;

function titleCase(value: string) {
  return value.toLocaleLowerCase().replace(/(^|[\s\u2014\-(/[])(\p{L})/gu, (_, lead: string, letter: string) => `${lead}${letter.toLocaleUpperCase()}`);
}

function tidyText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeTextFilename(filename: string) {
  const stem = filename
    .replace(/\.(?:txt|md|log)$/i, "")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${stem || "webtaskkit-text"}.txt`;
}

function countWords(value: string) {
  if (!value.trim()) return 0;
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
    return Array.from(segmenter.segment(value)).filter((segment) => segment.isWordLike).length;
  }
  return value.trim().match(/\S+/gu)?.length ?? 0;
}

export function TextEditorTool() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    start: trackStart,
    complete: trackComplete,
    output: trackOutput,
    validationError: trackValidationError,
  } = useToolEvents("/editors/text");
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("webtaskkit-text.txt");
  const [status, setStatus] = useState("Ready. Nothing is saved or uploaded automatically.");

  const counts = useMemo(() => {
    const words = countWords(text);
    const characters = Array.from(text).length;
    const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
    const readingMinutes = words ? Math.max(1, Math.ceil(words / 200)) : 0;
    return { words, characters, lines, readingMinutes };
  }, [text]);

  function updateText(value: string) {
    trackStart();
    if (new Blob([value]).size > MAX_FILE_BYTES) {
      setStatus("That text is over the 500 KB editor limit.");
      trackValidationError();
      return false;
    }
    setText(value);
    setStatus("Editing locally. Changes are not saved automatically.");
    return true;
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    trackStart();
    if (file.size > MAX_FILE_BYTES) {
      setStatus("That file is over the 500 KB editor limit.");
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
      setFilename(file.name);
      setStatus(`${file.name} opened locally.`);
      trackComplete();
    } catch {
      setStatus("WebTaskKit could not read that text file.");
      trackValidationError();
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function downloadText() {
    trackStart();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeTextFilename(filename);
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Text file downloaded.");
    trackComplete();
    trackOutput();
  }

  async function copyText() {
    trackStart();
    if (!text) {
      setStatus("Add some text before copying.");
      trackValidationError();
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Text copied to the clipboard.");
      trackComplete();
      trackOutput();
    } catch {
      setStatus("Clipboard access was blocked. Select the text and copy it manually.");
      trackValidationError();
    }
  }

  function transform(label: string, transformText: (value: string) => string) {
    trackStart();
    if (!text) {
      setStatus("Add some text before using a transform.");
      trackValidationError();
      return;
    }
    setText(transformText(text));
    setStatus(`${label} applied. Changes are not saved automatically.`);
    trackComplete();
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      downloadText();
    }
  }

  return (
    <div className="tool-workspace text-editor-workspace">
      <section className="tool-controls" aria-labelledby="text-editor-heading">
        <div className="panel-heading panel-heading--wrap">
          <div>
            <p className="eyebrow">Local scratchpad</p>
            <h2 id="text-editor-heading">Edit plain text</h2>
          </div>
          <div className="button-row">
            <button className="button button--ghost" type="button" onClick={() => fileInputRef.current?.click()}>
              Open file
            </button>
            <button className="button button--ghost" type="button" onClick={() => void copyText()} disabled={!text}>
              Copy
            </button>
            <button className="button button--primary" type="button" onClick={downloadText} disabled={!text}>
              Download .txt
            </button>
          </div>
        </div>

        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".txt,.md,.log,text/plain,text/markdown"
          onChange={(event) => void loadFile(event.target.files?.[0])}
          aria-label="Open a plain-text file"
        />

        <div className="text-stats" aria-label="Text statistics">
          <div className="stat-item"><strong>{counts.words.toLocaleString()}</strong><span>Words</span></div>
          <div className="stat-item"><strong>{counts.characters.toLocaleString()}</strong><span>Characters</span></div>
          <div className="stat-item"><strong>{counts.lines.toLocaleString()}</strong><span>Lines</span></div>
          <div className="stat-item"><strong>{counts.readingMinutes}</strong><span>Min read</span></div>
        </div>

        <div className="editor-toolbar preset-row" role="toolbar" aria-label="Text transformations">
          <button className="preset-button" type="button" onClick={() => transform("Uppercase", (value) => value.toLocaleUpperCase())}>UPPERCASE</button>
          <button className="preset-button" type="button" onClick={() => transform("Lowercase", (value) => value.toLocaleLowerCase())}>lowercase</button>
          <button className="preset-button" type="button" onClick={() => transform("Title case", titleCase)}>Title Case</button>
          <button className="preset-button" type="button" onClick={() => transform("Whitespace cleanup", tidyText)}>Clean spaces</button>
          <button className="preset-button" type="button" onClick={() => transform("Line sorting", (value) => value.split(/\r\n|\r|\n/).sort((a, b) => a.localeCompare(b)).join("\n"))}>Sort lines</button>
        </div>

        <label className="sr-only" htmlFor="plain-text-editor">Plain-text editor</label>
        <textarea
          className="form-control code-input text-editor text-editor-input text-editor-input--large"
          id="plain-text-editor"
          value={text}
          onChange={(event) => updateText(event.target.value)}
          onKeyDown={handleEditorKeyDown}
          placeholder="Start typing, paste text, or open a local file…"
          spellCheck
          rows={20}
          aria-describedby="text-editor-help text-editor-status"
        />

        <div className="input-meta help-text" id="text-editor-help">
          <span>{new Blob([text]).size.toLocaleString()} / {MAX_FILE_BYTES.toLocaleString()} bytes</span>
          <span><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>S</kbd> downloads</span>
        </div>

        <div className="editor-footer">
          <p className="status-message" id="text-editor-status" role="status" aria-live="polite">{status}</p>
          <button
            className="button button--ghost"
            type="button"
            onClick={() => { trackStart(); setText(""); setFilename("webtaskkit-text.txt"); setStatus("Editor cleared."); }}
            disabled={!text}
          >
            Clear editor
          </button>
        </div>
      </section>
    </div>
  );
}
