"use client";

import { useId, useMemo, useRef, useState } from "react";
import {
  IMAGE_TO_PDF_LIMITS,
  ImageToPdfValidationError,
  addEncodedPdfImageBytes,
  calculatePdfPageLayout,
  calculatePdfRasterDimensions,
  normalizePdfFilename,
  revalidateDecodedDimensions,
  validateImageBatch,
  validateImageFile,
  validateImageSelectionMetadata,
  type PdfOrientation,
  type PdfPageFormat,
  type ValidatedImageFile,
} from "@/lib/imageToPdf";
import { useToolEvents } from "@/lib/useToolEvents";

const POINTS_PER_MILLIMETRE = 72 / 25.4;
const DEFAULT_FILENAME = "webtaskkit-images.pdf";

type QueueItem = {
  id: string;
  file: File;
  validated: ValidatedImageFile;
  width: number;
  height: number;
  pixelCount: number;
  pdfImageFormat: "JPEG" | "PNG";
};

type DecodedImage = {
  image: HTMLImageElement;
  release: () => void;
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 KB";
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000)).toLocaleString()} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function fileSummary(item: QueueItem) {
  return `${item.width.toLocaleString()} × ${item.height.toLocaleString()} px · ${formatBytes(item.file.size)}`;
}

function errorMessage(error: unknown) {
  if (error instanceof ImageToPdfValidationError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "That image could not be read. Try a different JPG or PNG file.";
}

function decodeImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";

  return new Promise<DecodedImage>((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      URL.revokeObjectURL(objectUrl);
    };

    image.onload = () => {
      image.onload = null;
      image.onerror = null;
      resolve({ image, release });
    };
    image.onerror = () => {
      release();
      reject(new Error("The browser could not decode this image. Save it again as a still JPG or PNG."));
    };
    image.src = objectUrl;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: "image/jpeg" | "image/png") {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The browser ran out of memory while preparing an image page."));
      },
      type,
      type === "image/jpeg" ? 0.94 : undefined,
    );
  });
}

export function ImageToPdfTool() {
  const inputId = useId();
  const errorId = useId();
  const sequenceRef = useRef(0);
  const {
    start: trackStart,
    complete: trackComplete,
    output: trackOutput,
    validationError: trackValidationError,
  } = useToolEvents("/converters/image-to-pdf");
  const [images, setImages] = useState<QueueItem[]>([]);
  const [pageFormat, setPageFormat] = useState<PdfPageFormat>("a4");
  const [orientation, setOrientation] = useState<PdfOrientation>("auto");
  const [marginMillimetres, setMarginMillimetres] = useState(12);
  const [filename, setFilename] = useState(DEFAULT_FILENAME);
  const [busy, setBusy] = useState<"adding" | "creating" | null>(null);
  const [status, setStatus] = useState("Choose JPG or PNG files to begin.");
  const [errors, setErrors] = useState<string[]>([]);

  const totals = useMemo(
    () => images.reduce(
      (total, item) => ({ bytes: total.bytes + item.file.size, pixels: total.pixels + item.pixelCount }),
      { bytes: 0, pixels: 0 },
    ),
    [images],
  );

  async function addFiles(selectedFiles: File[]) {
    if (!selectedFiles.length || busy) return;
    trackStart();
    setBusy("adding");
    setErrors([]);
    setStatus(`Checking ${selectedFiles.length} ${selectedFiles.length === 1 ? "image" : "images"}…`);

    const accepted: QueueItem[] = [];
    const nextErrors: string[] = [];

    for (const file of selectedFiles) {
      let decoded: DecodedImage | null = null;
      try {
        validateImageSelectionMetadata([
          ...images.map((item) => ({ name: item.file.name, sizeBytes: item.file.size })),
          ...accepted.map((item) => ({ name: item.file.name, sizeBytes: item.file.size })),
          { name: file.name, sizeBytes: file.size },
        ]);

        const bytes = new Uint8Array(await file.arrayBuffer());
        const validated = validateImageFile({ name: file.name, sizeBytes: file.size, bytes });
        validateImageBatch([
          ...images.map((item) => item.validated),
          ...accepted.map((item) => item.validated),
          validated,
        ]);

        decoded = await decodeImage(file);
        const dimensions = revalidateDecodedDimensions(
          validated,
          decoded.image.naturalWidth,
          decoded.image.naturalHeight,
        );

        accepted.push({
          id: `image-${++sequenceRef.current}`,
          file,
          validated,
          width: dimensions.width,
          height: dimensions.height,
          pixelCount: dimensions.pixelCount,
          pdfImageFormat: validated.format === "jpeg" ? "JPEG" : "PNG",
        });
      } catch (error) {
        nextErrors.push(`${file.name}: ${errorMessage(error)}`);
      } finally {
        decoded?.release();
      }
    }

    if (accepted.length) setImages((current) => [...current, ...accepted]);
    if (nextErrors.length) {
      setErrors(nextErrors);
      trackValidationError();
    }

    if (accepted.length && nextErrors.length) {
      setStatus(`Added ${accepted.length}; skipped ${nextErrors.length}. Review the messages below.`);
    } else if (accepted.length) {
      setStatus(`Added ${accepted.length} ${accepted.length === 1 ? "image" : "images"}. The visible list is the PDF page order.`);
    } else {
      setStatus("No images were added. Review the messages below and choose another file.");
    }
    setBusy(null);
  }

  function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    trackStart();
    setImages((current) => {
      const reordered = [...current];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      return reordered;
    });
    setErrors([]);
    setStatus(`Moved ${images[index].file.name} to page ${target + 1}.`);
  }

  function removeImage(index: number) {
    trackStart();
    const name = images[index]?.file.name;
    setImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setErrors([]);
    setStatus(name ? `Removed ${name}.` : "Image removed.");
  }

  function clearImages() {
    if (!images.length) return;
    trackStart();
    setImages([]);
    setErrors([]);
    setStatus("Image list cleared.");
  }

  async function createPdf() {
    trackStart();
    setErrors([]);

    if (!images.length) {
      setStatus("Add at least one JPG or PNG before creating a PDF.");
      setErrors(["The PDF needs at least one accepted image."]);
      trackValidationError();
      return;
    }

    setBusy("creating");
    const outputName = normalizePdfFilename(filename, "webtaskkit-images");

    try {
      validateImageBatch(images.map((item) => item.validated));
      const { jsPDF } = await import("jspdf");
      let pdf: InstanceType<typeof jsPDF> | null = null;
      let encodedTotalBytes = 0;

      for (let index = 0; index < images.length; index += 1) {
        const item = images[index];
        setStatus(`Creating page ${index + 1} of ${images.length}…`);
        const decoded = await decodeImage(item.file);
        let canvas: HTMLCanvasElement | null = null;

        try {
          const dimensions = revalidateDecodedDimensions(
            item.validated,
            decoded.image.naturalWidth,
            decoded.image.naturalHeight,
          );
          const layout = calculatePdfPageLayout({
            format: pageFormat,
            orientation,
            imageWidth: dimensions.width,
            imageHeight: dimensions.height,
            marginPoints: marginMillimetres * POINTS_PER_MILLIMETRE,
            allowUpscale: true,
          });
          const raster = calculatePdfRasterDimensions({
            imageWidth: dimensions.width,
            imageHeight: dimensions.height,
            imageWidthPoints: layout.imageWidthPoints,
            imageHeightPoints: layout.imageHeightPoints,
          });

          if (!pdf) {
            pdf = new jsPDF({
              unit: "pt",
              format: pageFormat,
              orientation: layout.orientation,
              compress: true,
            });
          } else {
            pdf.addPage(pageFormat, layout.orientation);
          }

          canvas = document.createElement("canvas");
          canvas.width = raster.width;
          canvas.height = raster.height;
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw new Error("This browser could not prepare the image canvas.");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);

          const encoded = await canvasBlob(
            canvas,
            item.pdfImageFormat === "PNG" ? "image/png" : "image/jpeg",
          );
          encodedTotalBytes = addEncodedPdfImageBytes(encodedTotalBytes, encoded.size);
          const encodedBytes = new Uint8Array(await encoded.arrayBuffer());

          pdf.setFillColor(255, 255, 255);
          pdf.rect(0, 0, layout.pageWidthPoints, layout.pageHeightPoints, "F");
          pdf.addImage(
            encodedBytes,
            item.pdfImageFormat,
            layout.xPoints,
            layout.yPoints,
            layout.imageWidthPoints,
            layout.imageHeightPoints,
            undefined,
            "FAST",
          );
        } finally {
          if (canvas) {
            canvas.width = 1;
            canvas.height = 1;
            canvas.remove();
          }
          decoded.release();
        }
      }

      if (!pdf) throw new Error("The PDF could not be initialized.");
      pdf.setProperties({
        title: outputName.replace(/\.pdf$/i, ""),
        creator: "WebTaskKit Image to PDF Converter",
      });

      const downloadUrl = URL.createObjectURL(pdf.output("blob"));
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = outputName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);

      setFilename(outputName);
      setStatus(`Created ${outputName} with ${images.length} ${images.length === 1 ? "page" : "pages"}.`);
      trackComplete();
      trackOutput();
    } catch (error) {
      setErrors([errorMessage(error)]);
      setStatus("The PDF was not created. Review the message below and try a smaller batch.");
      trackValidationError();
    } finally {
      setBusy(null);
    }
  }

  const controlsDisabled = busy !== null;
  const fileInputDescription = `${inputId}-hint${errors.length ? ` ${errorId}` : ""}`;

  return (
    <div className="tool-workspace image-pdf-workspace" aria-busy={controlsDisabled}>
      <section className="tool-controls image-pdf-files" aria-labelledby={`${inputId}-heading`}>
        <div className="panel-heading panel-heading--wrap">
          <div>
            <p className="eyebrow">Source images</p>
            <h2 id={`${inputId}-heading`}>Choose and order pages</h2>
          </div>
          <button className="button button--ghost" type="button" onClick={clearImages} disabled={!images.length || controlsDisabled}>
            Clear all
          </button>
        </div>

        <label className="field-group" htmlFor={inputId}>
          <span className="field-label">JPG or PNG files</span>
          <input
            id={inputId}
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            multiple
            disabled={controlsDisabled}
            aria-describedby={fileInputDescription}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              event.target.value = "";
              void addFiles(selected);
            }}
          />
          <span className="field-hint" id={`${inputId}-hint`}>
            Up to {IMAGE_TO_PDF_LIMITS.maxFiles} files, {formatBytes(IMAGE_TO_PDF_LIMITS.maxFileBytes)} each and {formatBytes(IMAGE_TO_PDF_LIMITS.maxTotalBytes)} total; decoded images are limited to {(IMAGE_TO_PDF_LIMITS.maxPixelsPerImage / 1_000_000).toFixed(0)} MP each and {(IMAGE_TO_PDF_LIMITS.maxTotalPixels / 1_000_000).toFixed(0)} MP per batch. Confirm the browser-provided order in the list.
          </span>
        </label>

        {errors.length ? (
          <div className="inline-notice inline-notice--error image-pdf-errors" id={errorId} role="alert" aria-live="assertive">
            <strong>{errors.length === 1 ? "One item needs attention" : `${errors.length} items need attention`}</strong>
            <ul>{errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}</ul>
          </div>
        ) : null}

        {images.length ? (
          <ol className="image-pdf-list" aria-label="PDF page order">
            {images.map((item, index) => (
              <li className="image-pdf-item" key={item.id}>
                <span className="image-pdf-page" aria-hidden="true">{index + 1}</span>
                <span className="image-pdf-file-copy">
                  <strong title={item.file.name}>{item.file.name}</strong>
                  <span>{item.pdfImageFormat} · {fileSummary(item)}</span>
                </span>
                <span className="image-pdf-item-actions">
                  <button className="text-action" type="button" onClick={() => moveImage(index, -1)} disabled={index === 0 || controlsDisabled} aria-label={`Move ${item.file.name} one page earlier`}>
                    Move up
                  </button>
                  <button className="text-action" type="button" onClick={() => moveImage(index, 1)} disabled={index === images.length - 1 || controlsDisabled} aria-label={`Move ${item.file.name} one page later`}>
                    Move down
                  </button>
                  <button className="text-action image-pdf-remove" type="button" onClick={() => removeImage(index)} disabled={controlsDisabled} aria-label={`Remove ${item.file.name} from the PDF`}>
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-state image-pdf-empty">
            <strong>No pages yet</strong>
            <p>Choose still JPG or PNG files. Other formats, animated images and oversized batches are rejected before export.</p>
          </div>
        )}
      </section>

      <section className="tool-preview image-pdf-settings" aria-labelledby={`${inputId}-settings-heading`}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PDF setup</p>
            <h2 id={`${inputId}-settings-heading`}>Format the document</h2>
          </div>
        </div>

        <div className="image-pdf-summary" aria-label="Current document summary">
          <div><strong>{images.length}</strong><span>{images.length === 1 ? "page" : "pages"}</span></div>
          <div><strong>{formatBytes(totals.bytes)}</strong><span>source size</span></div>
          <div><strong>{(totals.pixels / 1_000_000).toFixed(1)} MP</strong><span>decoded pixels</span></div>
        </div>

        <div className="control-grid control-grid--two">
          <label className="field-group" htmlFor={`${inputId}-format`}>
            <span className="field-label">Page size</span>
            <select
              id={`${inputId}-format`}
              value={pageFormat}
              disabled={controlsDisabled}
              onChange={(event) => { trackStart(); setPageFormat(event.target.value as PdfPageFormat); }}
            >
              <option value="a4">A4</option>
              <option value="letter">US Letter</option>
            </select>
          </label>
          <label className="field-group" htmlFor={`${inputId}-orientation`}>
            <span className="field-label">Orientation</span>
            <select
              id={`${inputId}-orientation`}
              value={orientation}
              disabled={controlsDisabled}
              onChange={(event) => { trackStart(); setOrientation(event.target.value as PdfOrientation); }}
            >
              <option value="auto">Automatic per image</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
        </div>

        <div className="control-grid control-grid--two">
          <label className="field-group" htmlFor={`${inputId}-fit`}>
            <span className="field-label">Image fit</span>
            <select id={`${inputId}-fit`} value="contain" disabled aria-describedby={`${inputId}-fit-hint`}>
              <option value="contain">Contain · no crop</option>
            </select>
            <span className="field-hint" id={`${inputId}-fit-hint`}>Keeps the original proportions and adds empty space when needed. Large images are resampled to at most {IMAGE_TO_PDF_LIMITS.maxRasterDpi} DPI at their final page size.</span>
          </label>
          <label className="field-group" htmlFor={`${inputId}-margin`}>
            <span className="field-label">Margin <output>{marginMillimetres} mm</output></span>
            <input
              id={`${inputId}-margin`}
              type="range"
              min="0"
              max="30"
              step="1"
              value={marginMillimetres}
              disabled={controlsDisabled}
              onChange={(event) => { trackStart(); setMarginMillimetres(Number(event.target.value)); }}
            />
          </label>
        </div>

        <label className="field-group" htmlFor={`${inputId}-filename`}>
          <span className="field-label">PDF filename</span>
          <input
            id={`${inputId}-filename`}
            type="text"
            value={filename}
            maxLength={96}
            disabled={controlsDisabled}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => { trackStart(); setFilename(event.target.value); }}
            onBlur={() => setFilename(normalizePdfFilename(filename, "webtaskkit-images"))}
          />
        </label>

        <aside className="tool-callout" role="note">
          <strong>One image per page, in list order.</strong>
          <span>Transparent PNG areas are flattened onto white. Source metadata is not intentionally copied into the PDF.</span>
        </aside>

        <button className="button button--primary button--wide" type="button" onClick={() => void createPdf()} disabled={!images.length || controlsDisabled}>
          {busy === "creating"
            ? "Creating PDF…"
            : images.length
              ? `Download ${images.length} page${images.length === 1 ? "" : "s"} PDF`
              : "Download PDF"}
        </button>
        <p className="status-message" role="status" aria-live="polite" aria-atomic="true">{status}</p>
      </section>
    </div>
  );
}
