"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  PDF_RASTER_SCALES,
  PDF_TO_IMAGE_LIMITS,
  PDF_TO_IMAGE_TIMEOUTS,
  PdfToImageValidationError,
  addEncodedOutputBytes,
  addRasterPageBudget,
  buildRasterArchiveFilename,
  buildRasterFilename,
  calculateRasterPageBudget,
  createPdfOperationDeadline,
  normalizePdfOutputBase,
  parsePdfPageRange,
  pdfOperationMillisecondsRemaining,
  prepareZipEntries,
  validateArchiveBytes,
  validatePdfFile,
  validatePdfFileMetadata,
  validatePdfPageCount,
  type EncodedRasterOutput,
  type PdfImageFormat,
  type PdfRasterScale,
  type RasterBatchBudget,
} from "@/lib/pdfToImage";
import { useToolEvents } from "@/lib/useToolEvents";

const PDFJS_VERSION = "6.2.108";
const PDF_ASSET_ROOT = `/pdfjs/${PDFJS_VERSION}/`;
const PDF_WORKER_URL = `${PDF_ASSET_ROOT}pdf.worker.min.mjs`;
const JPEG_QUALITY = 0.9;

type SelectedPdf = {
  file: File;
  pageCount: number;
};

type PdfLoadingTask = ReturnType<(typeof import("pdfjs-dist"))["getDocument"]>;
type PdfDocument = Awaited<PdfLoadingTask["promise"]>;
type PdfRenderTask = { promise: Promise<void>; cancel: () => void };
type ZipTerminator = () => void;
type OperationKind = "inspect" | "convert";
type ActiveOperation = {
  id: number;
  kind: OperationKind;
  expiresAtMilliseconds: number;
  timeoutTimer: number;
};
type OwnedTask<T> = { operation: number; task: T };

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatResolution(scale: PdfRasterScale): string {
  return `${Math.round(scale * 72)} DPI`;
}

function displayError(error: unknown): string {
  if (error instanceof PdfToImageValidationError) return error.message;
  if (error && typeof error === "object") {
    const name = "name" in error && typeof error.name === "string" ? error.name : "";
    if (name === "PasswordException") {
      return "Password-protected PDFs are not supported. Remove the password in a trusted PDF application, then try again.";
    }
    if (name === "InvalidPDFException" || name === "FormatError") {
      return "The PDF is damaged or uses a structure this browser cannot safely decode.";
    }
  }
  return "The PDF could not be decoded. Try a smaller, unprotected PDF from a trusted source.";
}

async function readValidatedPdf(file: File): Promise<Uint8Array> {
  validatePdfFileMetadata({ name: file.name, sizeBytes: file.size });
  const bytes = new Uint8Array(await file.arrayBuffer());
  validatePdfFile({ name: file.name, sizeBytes: file.size, bytes });
  return bytes;
}

async function createPdfLoadingTask(bytes: Uint8Array): Promise<PdfLoadingTask> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  return pdfjs.getDocument({
    data: bytes,
    cMapUrl: `${PDF_ASSET_ROOT}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDF_ASSET_ROOT}standard_fonts/`,
    wasmUrl: `${PDF_ASSET_ROOT}wasm/`,
    useWasm: true,
    useSystemFonts: true,
    stopAtErrors: true,
    isEvalSupported: false,
    enableXfa: false,
    maxImageSize: PDF_TO_IMAGE_LIMITS.maxPixelsPerPage,
    canvasMaxAreaInBytes: PDF_TO_IMAGE_LIMITS.maxPixelsPerPage * 4,
    disableRange: true,
    disableStream: true,
    disableAutoFetch: true,
    verbosity: 0,
  });
}

async function destroyPdf(loadingTask: PdfLoadingTask | null, document: PdfDocument | null) {
  if (document) {
    try {
      await document.cleanup();
    } catch {
      // Continue to worker destruction even when PDF.js cleanup reports a decoder error.
    }
  }
  if (loadingTask) {
    try {
      await loadingTask.destroy();
    } catch {
      // The worker may already be gone after a parser failure.
    }
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, format: PdfImageFormat): Promise<Blob> {
  const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The browser could not encode the rendered page."));
      },
      mimeType,
      format === "jpg" ? JPEG_QUALITY : undefined,
    );
  });
}

function blobBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

function downloadableBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function createZip(
  outputs: readonly EncodedRasterOutput[],
  operationStillActive: () => boolean,
  setTerminator: (terminator: ZipTerminator | null) => boolean,
): Promise<Uint8Array> {
  const entries = prepareZipEntries(outputs);
  const { zip } = await import("fflate");
  if (!operationStillActive()) throw new Error("The ZIP operation was cancelled.");
  return new Promise((resolve, reject) => {
    let settled = false;
    const terminate = zip(entries, { level: 0 }, (error, data) => {
      if (settled) return;
      settled = true;
      setTerminator(null);
      if (error) reject(error);
      else {
        validateArchiveBytes(data.byteLength);
        resolve(data);
      }
    });
    const cancel = () => {
      if (settled) return;
      settled = true;
      terminate();
      reject(new Error("The ZIP operation was cancelled."));
    };
    if (!setTerminator(cancel)) cancel();
  });
}

export function PdfToImageTool() {
  const inputId = useId();
  const errorId = useId();
  const rangeErrorId = useId();
  const rangeInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const activeOperationRef = useRef<ActiveOperation | null>(null);
  const activeLoadingTaskRef = useRef<OwnedTask<PdfLoadingTask> | null>(null);
  const activeRenderTaskRef = useRef<OwnedTask<PdfRenderTask> | null>(null);
  const activeZipTerminatorRef = useRef<OwnedTask<ZipTerminator> | null>(null);
  const downloadUrlsRef = useRef(new Set<string>());
  const releaseTimersRef = useRef(new Set<number>());
  const {
    start: trackStart,
    complete: trackComplete,
    output: trackOutput,
    validationError: trackValidationError,
  } = useToolEvents("/converters/pdf-to-jpg");
  const [selectedPdf, setSelectedPdf] = useState<SelectedPdf | null>(null);
  const [format, setFormat] = useState<PdfImageFormat>("jpg");
  const [scale, setScale] = useState<PdfRasterScale>(2);
  const [pageRange, setPageRange] = useState("all");
  const [outputBase, setOutputBase] = useState("webtaskkit-pdf-pages");
  const [busy, setBusy] = useState<"reading" | "rendering" | "packing" | null>(null);
  const [status, setStatus] = useState("Choose a PDF to see its page count.");
  const [error, setError] = useState("");

  function cancelOwnedWork(operation: number): void {
    const render = activeRenderTaskRef.current;
    if (render?.operation === operation) {
      render.task.cancel();
      activeRenderTaskRef.current = null;
    }
    const archive = activeZipTerminatorRef.current;
    if (archive?.operation === operation) {
      archive.task();
      activeZipTerminatorRef.current = null;
    }
    const loading = activeLoadingTaskRef.current;
    if (loading?.operation === operation) {
      activeLoadingTaskRef.current = null;
      void loading.task.destroy().catch(() => {});
    }
  }

  function stopOperation(operation: number, reason: "cancelled" | "timeout"): void {
    const active = activeOperationRef.current;
    if (!active || active.id !== operation) return;
    window.clearTimeout(active.timeoutTimer);
    activeOperationRef.current = null;
    operationRef.current += 1;
    cancelOwnedWork(operation);
    if (!mountedRef.current) return;
    setBusy(null);
    setError("");
    setStatus(
      reason === "cancelled"
        ? "Operation cancelled. No download was created."
        : active.kind === "inspect"
          ? "Stopped after the 30-second inspection limit. Try a smaller PDF."
          : "Stopped after the 2-minute conversion limit. Choose fewer pages or a lower resolution.",
    );
  }

  function beginOperation(kind: OperationKind): number {
    operationRef.current += 1;
    const id = operationRef.current;
    const timeoutMilliseconds = kind === "inspect"
      ? PDF_TO_IMAGE_TIMEOUTS.inspectMilliseconds
      : PDF_TO_IMAGE_TIMEOUTS.convertMilliseconds;
    const deadline = createPdfOperationDeadline(performance.now(), timeoutMilliseconds);
    const timeoutTimer = window.setTimeout(
      () => stopOperation(id, "timeout"),
      pdfOperationMillisecondsRemaining(deadline, performance.now()),
    );
    activeOperationRef.current = {
      id,
      kind,
      expiresAtMilliseconds: deadline.expiresAtMilliseconds,
      timeoutTimer,
    };
    return id;
  }

  function operationIsActive(operation: number): boolean {
    const active = activeOperationRef.current;
    if (!mountedRef.current || operationRef.current !== operation || active?.id !== operation) return false;
    if (performance.now() >= active.expiresAtMilliseconds) {
      stopOperation(operation, "timeout");
      return false;
    }
    return true;
  }

  function finishOperation(operation: number): boolean {
    const active = activeOperationRef.current;
    if (!active || active.id !== operation || operationRef.current !== operation) return false;
    window.clearTimeout(active.timeoutTimer);
    activeOperationRef.current = null;
    return mountedRef.current;
  }

  function initiateDownload(
    operation: number,
    bytes: Uint8Array,
    mimeType: string,
    filename: string,
  ): boolean {
    const url = URL.createObjectURL(new Blob([downloadableBuffer(bytes)], { type: mimeType }));
    downloadUrlsRef.current.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);

    if (!operationIsActive(operation)) {
      link.remove();
      URL.revokeObjectURL(url);
      downloadUrlsRef.current.delete(url);
      return false;
    }

    try {
      link.click();
    } catch (caught) {
      URL.revokeObjectURL(url);
      downloadUrlsRef.current.delete(url);
      throw caught;
    } finally {
      link.remove();
    }

    if (!finishOperation(operation)) {
      URL.revokeObjectURL(url);
      downloadUrlsRef.current.delete(url);
      return false;
    }
    setBusy(null);

    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadUrlsRef.current.delete(url);
      releaseTimersRef.current.delete(timer);
    }, 60_000);
    releaseTimersRef.current.add(timer);
    return true;
  }

  useEffect(() => {
    mountedRef.current = true;
    const releaseTimers = releaseTimersRef.current;
    const downloadUrls = downloadUrlsRef.current;
    return () => {
      mountedRef.current = false;
      const active = activeOperationRef.current;
      if (active) {
        window.clearTimeout(active.timeoutTimer);
        activeOperationRef.current = null;
        cancelOwnedWork(active.id);
      }
      operationRef.current += 1;
      for (const timer of releaseTimers) window.clearTimeout(timer);
      releaseTimers.clear();
      for (const url of downloadUrls) URL.revokeObjectURL(url);
      downloadUrls.clear();
    };
  }, []);

  const pageSelection = useMemo(() => {
    if (!selectedPdf) return { pages: null, error: "" };
    try {
      return { pages: parsePdfPageRange(pageRange, selectedPdf.pageCount), error: "" };
    } catch (caught) {
      return { pages: null, error: displayError(caught) };
    }
  }, [pageRange, selectedPdf]);
  const selectedPages = pageSelection.pages;
  const pageRangeError = pageSelection.error;

  useEffect(() => {
    rangeInputRef.current?.setCustomValidity(pageRangeError);
  }, [pageRangeError]);

  async function choosePdf(file: File | undefined) {
    if (!file || busy) return;
    const operation = beginOperation("inspect");
    trackStart();
    setBusy("reading");
    setSelectedPdf(null);
    setError("");
    setStatus("Checking the PDF header and page count…");

    let loadingTask: PdfLoadingTask | null = null;
    let pdfDocument: PdfDocument | null = null;
    try {
      const bytes = await readValidatedPdf(file);
      if (!operationIsActive(operation)) return;
      loadingTask = await createPdfLoadingTask(bytes);
      if (!operationIsActive(operation)) {
        await loadingTask.destroy();
        loadingTask = null;
        return;
      }
      activeLoadingTaskRef.current = { operation, task: loadingTask };
      pdfDocument = await loadingTask.promise;
      if (!operationIsActive(operation)) return;
      const pageCount = validatePdfPageCount(pdfDocument.numPages);
      if (!operationIsActive(operation)) return;
      setSelectedPdf({ file, pageCount });
      setPageRange(pageCount <= PDF_TO_IMAGE_LIMITS.maxOutputPages ? "all" : `1-${PDF_TO_IMAGE_LIMITS.maxOutputPages}`);
      setOutputBase(normalizePdfOutputBase(file.name));
      setStatus(
        pageCount <= PDF_TO_IMAGE_LIMITS.maxOutputPages
          ? `Ready to convert all ${pageCount} ${pageCount === 1 ? "page" : "pages"}.`
          : `This PDF has ${pageCount} pages. Choose up to ${PDF_TO_IMAGE_LIMITS.maxOutputPages} pages per conversion.`,
      );
    } catch (caught) {
      if (!operationIsActive(operation)) return;
      setError(displayError(caught));
      setStatus("The PDF was not added. Review the message below.");
      trackValidationError();
    } finally {
      await destroyPdf(loadingTask, pdfDocument);
      const activeLoading = activeLoadingTaskRef.current;
      if (activeLoading?.operation === operation && activeLoading.task === loadingTask) {
        activeLoadingTaskRef.current = null;
      }
      if (operationIsActive(operation) && finishOperation(operation)) setBusy(null);
    }
  }

  function clearPdf() {
    if (!selectedPdf || busy) return;
    trackStart();
    setSelectedPdf(null);
    setPageRange("all");
    setOutputBase("webtaskkit-pdf-pages");
    setError("");
    setStatus("PDF cleared. Choose another file to continue.");
  }

  function cancelCurrentOperation() {
    const active = activeOperationRef.current;
    if (active) stopOperation(active.id, "cancelled");
  }

  async function convertPdf() {
    trackStart();
    setError("");
    if (!selectedPdf) {
      setError("Choose a PDF before converting pages.");
      setStatus("No PDF was converted.");
      trackValidationError();
      return;
    }

    let pages: number[];
    try {
      pages = parsePdfPageRange(pageRange, selectedPdf.pageCount);
    } catch {
      setStatus("Fix the page range before converting.");
      rangeInputRef.current?.reportValidity();
      trackValidationError();
      return;
    }

    const operation = beginOperation("convert");
    setBusy("rendering");
    setStatus(`Preparing ${pages.length} ${pages.length === 1 ? "page" : "pages"}…`);
    let loadingTask: PdfLoadingTask | null = null;
    let pdfDocument: PdfDocument | null = null;

    try {
      const bytes = await readValidatedPdf(selectedPdf.file);
      if (!operationIsActive(operation)) return;
      loadingTask = await createPdfLoadingTask(bytes);
      if (!operationIsActive(operation)) {
        await loadingTask.destroy();
        loadingTask = null;
        return;
      }
      activeLoadingTaskRef.current = { operation, task: loadingTask };
      pdfDocument = await loadingTask.promise;
      if (!operationIsActive(operation)) return;
      validatePdfPageCount(pdfDocument.numPages);
      if (pdfDocument.numPages !== selectedPdf.pageCount) {
        throw new PdfToImageValidationError("invalid_page_count", "The PDF changed after it was selected. Choose it again.");
      }

      const budgets = new Map<number, ReturnType<typeof calculateRasterPageBudget>>();
      let batch: RasterBatchBudget = { pages: 0, totalPixels: 0, totalWorkUnits: 0 };
      for (const pageNumber of pages) {
        if (!operationIsActive(operation)) return;
        setStatus(`Checking page ${pageNumber}…`);
        const page = await pdfDocument.getPage(pageNumber);
        try {
          if (!operationIsActive(operation)) return;
          const viewport = page.getViewport({ scale });
          const budget = calculateRasterPageBudget(viewport.width / scale, viewport.height / scale, scale, format);
          batch = addRasterPageBudget(batch, budget);
          budgets.set(pageNumber, budget);
        } finally {
          page.cleanup();
        }
      }

      const outputs: EncodedRasterOutput[] = [];
      let encodedBytes = 0;
      for (let index = 0; index < pages.length; index += 1) {
        if (!operationIsActive(operation)) return;
        const pageNumber = pages[index];
        const budget = budgets.get(pageNumber);
        if (!budget) throw new Error("The page budget was not prepared.");
        setStatus(`Rendering page ${pageNumber} (${index + 1} of ${pages.length})…`);
        const page = await pdfDocument.getPage(pageNumber);
        if (!operationIsActive(operation)) {
          page.cleanup();
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = budget.widthPixels;
        canvas.height = budget.heightPixels;
        let renderTask: PdfRenderTask | null = null;
        let renderFinished = false;
        try {
          if (!canvas.getContext("2d", { alpha: false })) {
            throw new Error("This browser could not create a page canvas.");
          }
          const viewport = page.getViewport({ scale });
          const pdfjs = await import("pdfjs-dist");
          if (!operationIsActive(operation)) return;
          renderTask = page.render({
            canvas,
            viewport,
            background: "#ffffff",
            annotationMode: pdfjs.AnnotationMode.DISABLE,
            intent: "display",
          });
          activeRenderTaskRef.current = { operation, task: renderTask };
          await renderTask.promise;
          renderFinished = true;
          const activeRender = activeRenderTaskRef.current;
          if (activeRender?.operation === operation && activeRender.task === renderTask) {
            activeRenderTaskRef.current = null;
          }
          if (!operationIsActive(operation)) return;
          const output = await canvasToBlob(canvas, format);
          if (!operationIsActive(operation)) return;
          const outputBytes = await blobBytes(output);
          if (!operationIsActive(operation)) return;
          encodedBytes = addEncodedOutputBytes(encodedBytes, outputBytes.byteLength);
          outputs.push({
            name: buildRasterFilename(outputBase, pageNumber, selectedPdf.pageCount, format),
            bytes: outputBytes,
          });
        } finally {
          if (renderTask && !renderFinished) renderTask.cancel();
          const activeRender = activeRenderTaskRef.current;
          if (activeRender?.operation === operation && activeRender.task === renderTask) {
            activeRenderTaskRef.current = null;
          }
          page.cleanup();
          canvas.width = 1;
          canvas.height = 1;
          canvas.remove();
        }
      }

      const safeBase = normalizePdfOutputBase(outputBase);
      if (!operationIsActive(operation)) return;
      if (outputs.length === 1) {
        const output = outputs[0];
        if (!initiateDownload(
          operation,
          output.bytes,
          format === "jpg" ? "image/jpeg" : "image/png",
          output.name,
        )) return;
        setStatus(`Downloaded ${output.name}.`);
      } else {
        setBusy("packing");
        setStatus(`Packing ${outputs.length} page images into a ZIP…`);
        const archive = await createZip(outputs, () => operationIsActive(operation), (terminator) => {
          if (operationIsActive(operation) && terminator) {
            activeZipTerminatorRef.current = { operation, task: terminator };
            return true;
          } else if (!terminator) {
            const activeArchive = activeZipTerminatorRef.current;
            if (activeArchive?.operation === operation) activeZipTerminatorRef.current = null;
            return true;
          }
          return false;
        });
        const activeArchive = activeZipTerminatorRef.current;
        if (activeArchive?.operation === operation) activeZipTerminatorRef.current = null;
        if (!operationIsActive(operation)) return;
        const archiveName = buildRasterArchiveFilename(safeBase);
        if (!initiateDownload(
          operation,
          archive,
          "application/zip",
          archiveName,
        )) return;
        setStatus(`Downloaded ${archiveName} with ${outputs.length} page images.`);
      }
      setOutputBase(safeBase);
      trackComplete();
      trackOutput();
    } catch (caught) {
      if (!operationIsActive(operation)) return;
      setError(displayError(caught));
      setStatus("No download was created. Review the message below and try a smaller selection.");
      trackValidationError();
    } finally {
      const activeRender = activeRenderTaskRef.current;
      if (activeRender?.operation === operation) {
        activeRender.task.cancel();
        activeRenderTaskRef.current = null;
      }
      const activeArchive = activeZipTerminatorRef.current;
      if (activeArchive?.operation === operation) {
        activeArchive.task();
        activeZipTerminatorRef.current = null;
      }
      await destroyPdf(loadingTask, pdfDocument);
      const activeLoading = activeLoadingTaskRef.current;
      if (activeLoading?.operation === operation && activeLoading.task === loadingTask) {
        activeLoadingTaskRef.current = null;
      }
      if (operationIsActive(operation) && finishOperation(operation)) setBusy(null);
    }
  }

  const controlsDisabled = busy !== null;
  const describedBy = `${inputId}-file-hint${error ? ` ${errorId}` : ""}`;

  return (
    <div className="tool-workspace pdf-image-workspace" aria-busy={controlsDisabled}>
      <section className="tool-controls pdf-image-source" aria-labelledby={`${inputId}-source-heading`}>
        <div className="panel-heading panel-heading--wrap">
          <div>
            <p className="eyebrow">Source PDF</p>
            <h2 id={`${inputId}-source-heading`}>Choose a document</h2>
          </div>
          <button
            className="button button--ghost"
            type="button"
            onClick={controlsDisabled ? cancelCurrentOperation : clearPdf}
            disabled={!controlsDisabled && !selectedPdf}
          >
            {controlsDisabled ? "Cancel" : "Clear PDF"}
          </button>
        </div>

        <label className="field-group" htmlFor={inputId}>
          <span className="field-label">PDF file</span>
          <input
            id={inputId}
            type="file"
            accept=".pdf,application/pdf"
            disabled={controlsDisabled}
            aria-describedby={describedBy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              void choosePdf(file);
            }}
          />
          <span className="field-hint" id={`${inputId}-file-hint`}>
            One unprotected PDF, up to {formatBytes(PDF_TO_IMAGE_LIMITS.maxFileBytes)} and {PDF_TO_IMAGE_LIMITS.maxDocumentPages} pages. Files are read only in this browser.
          </span>
        </label>

        {error ? (
          <div className="inline-notice inline-notice--error pdf-image-error" id={errorId} role="alert" aria-live="assertive">
            <strong>Conversion needs attention</strong>
            <span>{error}</span>
          </div>
        ) : null}

        {selectedPdf ? (
          <div className="pdf-image-file-card">
            <span aria-hidden="true">PDF</span>
            <div>
              <strong title={selectedPdf.file.name}>{selectedPdf.file.name}</strong>
              <small>{selectedPdf.pageCount} {selectedPdf.pageCount === 1 ? "page" : "pages"} · {formatBytes(selectedPdf.file.size)}</small>
            </div>
          </div>
        ) : (
          <div className="empty-state pdf-image-empty">
            <strong>No PDF selected</strong>
            <p>The header, file size and page count are checked before conversion controls become active.</p>
          </div>
        )}

        <aside className="tool-callout" role="note">
          <strong>Nothing is uploaded.</strong>
          <span>PDF.js reads and renders the selected pages on this device. Closing or refreshing the tab clears the selection.</span>
        </aside>
      </section>

      <section className="tool-preview pdf-image-settings" aria-labelledby={`${inputId}-settings-heading`}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Image setup</p>
            <h2 id={`${inputId}-settings-heading`}>Choose pages and output</h2>
          </div>
        </div>

        <div className="pdf-image-summary" aria-label="Current conversion summary">
          <div><strong>{selectedPages?.length ?? "–"}</strong><span>selected pages</span></div>
          <div><strong>{format.toUpperCase()}</strong><span>image format</span></div>
          <div><strong>{formatResolution(scale)}</strong><span>render resolution</span></div>
        </div>

        <label className="field-group" htmlFor={`${inputId}-pages`}>
          <span className="field-label">Pages to convert</span>
          <input
            ref={rangeInputRef}
            id={`${inputId}-pages`}
            type="text"
            value={pageRange}
            disabled={!selectedPdf || controlsDisabled}
            maxLength={PDF_TO_IMAGE_LIMITS.maxRangeCharacters}
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="all or 1-3,5"
            aria-invalid={selectedPdf && !selectedPages ? true : undefined}
            aria-describedby={`${inputId}-pages-hint${pageRangeError ? ` ${rangeErrorId}` : ""}`}
            aria-errormessage={pageRangeError ? rangeErrorId : undefined}
            onChange={(event) => { trackStart(); setPageRange(event.target.value); setError(""); }}
          />
          <span className="field-hint" id={`${inputId}-pages-hint`}>Use “all” or a range such as 1-3,5. Repeated pages are removed and output stays in document order; maximum {PDF_TO_IMAGE_LIMITS.maxOutputPages} images.</span>
          {pageRangeError ? <span className="field-message field-message--error" id={rangeErrorId} aria-live="polite">{pageRangeError}</span> : null}
        </label>

        <div className="control-grid control-grid--two">
          <label className="field-group" htmlFor={`${inputId}-format`}>
            <span className="field-label">Output format</span>
            <select
              id={`${inputId}-format`}
              value={format}
              disabled={!selectedPdf || controlsDisabled}
              onChange={(event) => { trackStart(); setFormat(event.target.value as PdfImageFormat); }}
            >
              <option value="jpg">JPG · smaller files</option>
              <option value="png">PNG · lossless pixels</option>
            </select>
          </label>
          <label className="field-group" htmlFor={`${inputId}-resolution`}>
            <span className="field-label">Resolution</span>
            <select
              id={`${inputId}-resolution`}
              value={scale}
              disabled={!selectedPdf || controlsDisabled}
              onChange={(event) => { trackStart(); setScale(Number(event.target.value) as PdfRasterScale); }}
            >
              {PDF_RASTER_SCALES.map((option) => (
                <option value={option} key={option}>{formatResolution(option)}{option === 2 ? " · recommended" : ""}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="field-group" htmlFor={`${inputId}-filename`}>
          <span className="field-label">Download name</span>
          <input
            id={`${inputId}-filename`}
            type="text"
            value={outputBase}
            maxLength={96}
            disabled={!selectedPdf || controlsDisabled}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => { trackStart(); setOutputBase(event.target.value); }}
            onBlur={() => setOutputBase(normalizePdfOutputBase(outputBase))}
          />
        </label>

        <aside className="tool-callout tool-callout--warning" role="note">
          <strong>One page selected: one image. Multiple pages: one ZIP.</strong>
          <span>JPG is usually smaller for scanned pages. PNG preserves sharp flat graphics but can use substantially more memory and storage.</span>
        </aside>

        <button
          className="button button--primary button--wide"
          type="button"
          disabled={!selectedPdf || controlsDisabled}
          onClick={() => void convertPdf()}
        >
          {busy === "reading" ? "Reading PDF…" : busy === "rendering" ? "Rendering pages…" : busy === "packing" ? "Creating ZIP…" : "Convert and download"}
        </button>
        <p className="status-message" role="status" aria-live="polite" aria-atomic="true">{status}</p>
      </section>
    </div>
  );
}
