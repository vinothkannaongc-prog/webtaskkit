import type { AsyncZippable } from "fflate";

const MEBIBYTE = 1024 * 1024;

export const PDF_TO_IMAGE_LIMITS = Object.freeze({
  maxFileBytes: 30 * MEBIBYTE,
  maxDocumentPages: 100,
  maxOutputPages: 30,
  maxRangeCharacters: 200,
  maxRangeSegments: 50,
  maxPageDimensionPixels: 8_192,
  maxPixelsPerPage: 18_000_000,
  maxTotalPixels: 90_000_000,
  maxRenderWorkUnits: 100_000_000,
  maxEncodedOutputBytes: 80 * MEBIBYTE,
  maxArchiveBytes: 82 * MEBIBYTE,
});

export const PDF_TO_IMAGE_TIMEOUTS = Object.freeze({
  inspectMilliseconds: 30_000,
  convertMilliseconds: 120_000,
});

export const PDF_RASTER_SCALES = Object.freeze([1.5, 2, 2.5] as const);

export type PdfRasterScale = (typeof PDF_RASTER_SCALES)[number];
export type PdfImageFormat = "jpg" | "png";

export type PdfToImageErrorCode =
  | "invalid_file_metadata"
  | "empty_file"
  | "file_too_large"
  | "unsupported_extension"
  | "unsupported_content"
  | "invalid_page_count"
  | "too_many_document_pages"
  | "invalid_page_range"
  | "page_out_of_range"
  | "too_many_output_pages"
  | "invalid_raster_scale"
  | "invalid_page_dimensions"
  | "page_dimension_too_large"
  | "page_pixels_too_large"
  | "total_pixels_too_large"
  | "render_work_too_large"
  | "encoded_output_too_large"
  | "archive_too_large"
  | "invalid_output_name"
  | "duplicate_output_name"
  | "resource_overflow";

export class PdfToImageValidationError extends Error {
  readonly code: PdfToImageErrorCode;

  constructor(code: PdfToImageErrorCode, message: string) {
    super(message);
    this.name = "PdfToImageValidationError";
    this.code = code;
  }
}

export type PdfFileInput = {
  name: string;
  sizeBytes: number;
  bytes: Uint8Array;
};

export type PdfFileMetadata = Omit<PdfFileInput, "bytes">;

export type PdfOperationDeadline = {
  startedAtMilliseconds: number;
  expiresAtMilliseconds: number;
};

export type RasterPageBudget = {
  widthPixels: number;
  heightPixels: number;
  pixelCount: number;
  workUnits: number;
};

export type RasterBatchBudget = {
  pages: number;
  totalPixels: number;
  totalWorkUnits: number;
};

export type EncodedRasterOutput = {
  name: string;
  bytes: Uint8Array;
};

function validationError(code: PdfToImageErrorCode, message: string): never {
  throw new PdfToImageValidationError(code, message);
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkedAdd(left: number, right: number): number {
  if (!isNonNegativeSafeInteger(left) || !isNonNegativeSafeInteger(right)) {
    validationError("resource_overflow", "Resource totals must be non-negative whole numbers.");
  }
  if (left > Number.MAX_SAFE_INTEGER - right) {
    validationError("resource_overflow", "The requested conversion is too large to measure safely.");
  }
  return left + right;
}

function checkedProduct(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left <= 0 || right <= 0) {
    validationError("invalid_page_dimensions", "PDF page dimensions must be positive finite values.");
  }
  if (left > Math.floor(Number.MAX_SAFE_INTEGER / right)) {
    validationError("resource_overflow", "The PDF page dimensions are too large to process safely.");
  }
  return left * right;
}

function validateByteCount(value: number, label: string): void {
  if (!isNonNegativeSafeInteger(value)) {
    validationError("invalid_file_metadata", `${label} must be a non-negative whole number of bytes.`);
  }
}

export function validatePdfFileMetadata(input: PdfFileMetadata): void {
  if (!input || typeof input.name !== "string" || input.name.trim().length === 0) {
    validationError("invalid_file_metadata", "The PDF must have a filename.");
  }
  validateByteCount(input.sizeBytes, "The PDF size");
  if (input.sizeBytes === 0) {
    validationError("empty_file", "Empty files are not supported.");
  }
  if (input.sizeBytes > PDF_TO_IMAGE_LIMITS.maxFileBytes) {
    validationError("file_too_large", "Choose a PDF that is 30 MiB or smaller.");
  }
  if (!/\.pdf$/i.test(input.name.trim())) {
    validationError("unsupported_extension", "Choose a file with a .pdf extension.");
  }
}

export function validatePdfFile(input: PdfFileInput): void {
  validatePdfFileMetadata(input);
  if (!(input.bytes instanceof Uint8Array)) {
    validationError("invalid_file_metadata", "The PDF bytes could not be read.");
  }
  if (input.sizeBytes !== input.bytes.byteLength) {
    validationError("invalid_file_metadata", "The PDF size changed while it was being read.");
  }

  const bytes = input.bytes;
  const validHeader = bytes.byteLength >= 8
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d
    && (bytes[5] === 0x31 || bytes[5] === 0x32)
    && bytes[6] === 0x2e
    && bytes[7] >= 0x30
    && bytes[7] <= 0x39;
  if (!validHeader) {
    validationError("unsupported_content", "The file does not begin with a valid %PDF-1.x or %PDF-2.x header.");
  }
}

export function createPdfOperationDeadline(
  startedAtMilliseconds: number,
  timeoutMilliseconds: number,
): PdfOperationDeadline {
  if (
    !Number.isFinite(startedAtMilliseconds)
    || startedAtMilliseconds < 0
    || !Number.isSafeInteger(timeoutMilliseconds)
    || timeoutMilliseconds < 1
    || startedAtMilliseconds > Number.MAX_SAFE_INTEGER - timeoutMilliseconds
  ) {
    validationError("resource_overflow", "The operation deadline could not be measured safely.");
  }
  return {
    startedAtMilliseconds,
    expiresAtMilliseconds: startedAtMilliseconds + timeoutMilliseconds,
  };
}

export function pdfOperationMillisecondsRemaining(
  deadline: PdfOperationDeadline,
  nowMilliseconds: number,
): number {
  if (
    !deadline
    || !Number.isFinite(deadline.startedAtMilliseconds)
    || !Number.isFinite(deadline.expiresAtMilliseconds)
    || deadline.startedAtMilliseconds < 0
    || deadline.expiresAtMilliseconds <= deadline.startedAtMilliseconds
    || !Number.isFinite(nowMilliseconds)
    || nowMilliseconds < 0
  ) {
    validationError("resource_overflow", "The operation deadline is invalid.");
  }
  return Math.max(0, Math.ceil(deadline.expiresAtMilliseconds - nowMilliseconds));
}

export function validatePdfPageCount(pageCount: number): number {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    validationError("invalid_page_count", "The PDF does not contain a valid page count.");
  }
  if (pageCount > PDF_TO_IMAGE_LIMITS.maxDocumentPages) {
    validationError(
      "too_many_document_pages",
      `This converter accepts PDFs with no more than ${PDF_TO_IMAGE_LIMITS.maxDocumentPages} pages.`,
    );
  }
  return pageCount;
}

export function parsePdfPageRange(value: string, pageCount: number): number[] {
  validatePdfPageCount(pageCount);
  if (typeof value !== "string") {
    validationError("invalid_page_range", "Enter page numbers such as 1-3,5 or leave the field set to all.");
  }
  const normalized = value.trim();
  if (normalized.length > PDF_TO_IMAGE_LIMITS.maxRangeCharacters) {
    validationError("invalid_page_range", "The page range is too long.");
  }
  if (normalized === "" || /^all$/i.test(normalized)) {
    if (pageCount > PDF_TO_IMAGE_LIMITS.maxOutputPages) {
      validationError(
        "too_many_output_pages",
        `Choose no more than ${PDF_TO_IMAGE_LIMITS.maxOutputPages} pages per conversion.`,
      );
    }
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const segments = normalized.split(",");
  if (segments.length > PDF_TO_IMAGE_LIMITS.maxRangeSegments) {
    validationError("invalid_page_range", "The page range contains too many comma-separated parts.");
  }

  const selected = new Set<number>();
  for (const segment of segments) {
    const match = /^\s*(\d{1,3})(?:\s*-\s*(\d{1,3}))?\s*$/.exec(segment);
    if (!match) {
      validationError("invalid_page_range", "Use page numbers and forward ranges only, such as 1-3,5.");
    }
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    if (first < 1 || last < 1 || first > last) {
      validationError("invalid_page_range", "Page ranges must start at 1 and run from lower to higher pages.");
    }
    if (last > pageCount) {
      validationError("page_out_of_range", `The PDF has ${pageCount} pages, so page ${last} is out of range.`);
    }
    for (let page = first; page <= last; page += 1) {
      selected.add(page);
      if (selected.size > PDF_TO_IMAGE_LIMITS.maxOutputPages) {
        validationError(
          "too_many_output_pages",
          `Choose no more than ${PDF_TO_IMAGE_LIMITS.maxOutputPages} pages per conversion.`,
        );
      }
    }
  }

  if (selected.size === 0) {
    validationError("invalid_page_range", "Choose at least one page to convert.");
  }
  return [...selected].sort((left, right) => left - right);
}

export function isPdfRasterScale(value: number): value is PdfRasterScale {
  return PDF_RASTER_SCALES.some((scale) => scale === value);
}

export function calculateRasterPageBudget(
  widthPoints: number,
  heightPoints: number,
  scale: PdfRasterScale,
  format: PdfImageFormat,
): RasterPageBudget {
  if (!isPdfRasterScale(scale)) {
    validationError("invalid_raster_scale", "Choose one of the available output resolutions.");
  }
  if (format !== "jpg" && format !== "png") {
    validationError("invalid_output_name", "Choose JPG or PNG output.");
  }
  if (!Number.isFinite(widthPoints) || !Number.isFinite(heightPoints) || widthPoints <= 0 || heightPoints <= 0) {
    validationError("invalid_page_dimensions", "The PDF contains a page with invalid dimensions.");
  }

  const widthPixels = Math.ceil(widthPoints * scale);
  const heightPixels = Math.ceil(heightPoints * scale);
  if (!Number.isSafeInteger(widthPixels) || !Number.isSafeInteger(heightPixels)) {
    validationError("resource_overflow", "The PDF page dimensions are too large to process safely.");
  }
  if (
    widthPixels > PDF_TO_IMAGE_LIMITS.maxPageDimensionPixels
    || heightPixels > PDF_TO_IMAGE_LIMITS.maxPageDimensionPixels
  ) {
    validationError(
      "page_dimension_too_large",
      `Each rendered page edge must be ${PDF_TO_IMAGE_LIMITS.maxPageDimensionPixels.toLocaleString()} pixels or smaller.`,
    );
  }

  const pixelCount = checkedProduct(widthPixels, heightPixels);
  if (pixelCount > PDF_TO_IMAGE_LIMITS.maxPixelsPerPage) {
    validationError(
      "page_pixels_too_large",
      `Each rendered page must contain no more than ${Math.round(PDF_TO_IMAGE_LIMITS.maxPixelsPerPage / 1_000_000)} megapixels.`,
    );
  }
  const workUnits = Math.ceil(pixelCount * (format === "png" ? 1.1 : 1));
  return { widthPixels, heightPixels, pixelCount, workUnits };
}

export function addRasterPageBudget(
  batch: RasterBatchBudget,
  page: RasterPageBudget,
): RasterBatchBudget {
  if (
    !Number.isSafeInteger(batch.pages)
    || batch.pages < 0
    || !isNonNegativeSafeInteger(batch.totalPixels)
    || !isNonNegativeSafeInteger(batch.totalWorkUnits)
  ) {
    validationError("resource_overflow", "The raster workload totals are invalid.");
  }
  if (
    !Number.isSafeInteger(page.widthPixels)
    || !Number.isSafeInteger(page.heightPixels)
    || page.widthPixels < 1
    || page.heightPixels < 1
    || page.widthPixels > PDF_TO_IMAGE_LIMITS.maxPageDimensionPixels
    || page.heightPixels > PDF_TO_IMAGE_LIMITS.maxPageDimensionPixels
    || !Number.isSafeInteger(page.pixelCount)
    || page.pixelCount < 1
    || page.pixelCount > PDF_TO_IMAGE_LIMITS.maxPixelsPerPage
    || !Number.isSafeInteger(page.workUnits)
    || page.workUnits < page.pixelCount
  ) {
    validationError("resource_overflow", "The raster page budget is invalid.");
  }
  const pages = checkedAdd(batch.pages, 1);
  if (pages > PDF_TO_IMAGE_LIMITS.maxOutputPages) {
    validationError(
      "too_many_output_pages",
      `Choose no more than ${PDF_TO_IMAGE_LIMITS.maxOutputPages} pages per conversion.`,
    );
  }
  const totalPixels = checkedAdd(batch.totalPixels, page.pixelCount);
  if (totalPixels > PDF_TO_IMAGE_LIMITS.maxTotalPixels) {
    validationError(
      "total_pixels_too_large",
      `The selected pages must render to no more than ${Math.round(PDF_TO_IMAGE_LIMITS.maxTotalPixels / 1_000_000)} megapixels in total.`,
    );
  }
  const totalWorkUnits = checkedAdd(batch.totalWorkUnits, page.workUnits);
  if (totalWorkUnits > PDF_TO_IMAGE_LIMITS.maxRenderWorkUnits) {
    validationError("render_work_too_large", "Choose fewer pages, JPG output, or a lower resolution.");
  }
  return { pages, totalPixels, totalWorkUnits };
}

export function addEncodedOutputBytes(currentBytes: number, nextBytes: number): number {
  validateByteCount(currentBytes, "The current output size");
  validateByteCount(nextBytes, "The next output size");
  const total = checkedAdd(currentBytes, nextBytes);
  if (total > PDF_TO_IMAGE_LIMITS.maxEncodedOutputBytes) {
    validationError("encoded_output_too_large", "The rendered images exceed the 80 MiB output limit.");
  }
  return total;
}

export function validateArchiveBytes(bytes: number): number {
  validateByteCount(bytes, "The ZIP size");
  if (bytes > PDF_TO_IMAGE_LIMITS.maxArchiveBytes) {
    validationError("archive_too_large", "The ZIP archive exceeds the 82 MiB download limit.");
  }
  return bytes;
}

export function normalizePdfOutputBase(value: string, fallback = "webtaskkit-pdf-pages"): string {
  const normalizedFallback = fallback
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "webtaskkit-pdf-pages";
  if (typeof value !== "string") return normalizedFallback;
  const withoutExtension = value.trim().replace(/\.pdf$/i, "");
  return withoutExtension
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || normalizedFallback;
}

export function buildRasterFilename(
  base: string,
  pageNumber: number,
  documentPageCount: number,
  format: PdfImageFormat,
): string {
  const safeBase = normalizePdfOutputBase(base);
  if (
    !Number.isSafeInteger(pageNumber)
    || !Number.isSafeInteger(documentPageCount)
    || pageNumber < 1
    || documentPageCount < 1
    || pageNumber > documentPageCount
    || (format !== "jpg" && format !== "png")
  ) {
    validationError("invalid_output_name", "The output page filename could not be created safely.");
  }
  const digits = Math.max(2, String(documentPageCount).length);
  return `${safeBase}-page-${String(pageNumber).padStart(digits, "0")}.${format}`;
}

export function buildRasterArchiveFilename(base: string): string {
  return `${normalizePdfOutputBase(base)}-images.zip`;
}

export function prepareZipEntries(outputs: readonly EncodedRasterOutput[]): AsyncZippable {
  if (outputs.length < 2 || outputs.length > PDF_TO_IMAGE_LIMITS.maxOutputPages) {
    validationError("invalid_output_name", "A ZIP archive must contain between 2 and 30 page images.");
  }
  const entries: AsyncZippable = Object.create(null) as AsyncZippable;
  let totalBytes = 0;
  for (const output of outputs) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}-page-\d{2,3}\.(?:jpg|png)$/.test(output.name)) {
      validationError("invalid_output_name", "Every ZIP entry must use a safe generated page-image filename.");
    }
    if (Object.prototype.hasOwnProperty.call(entries, output.name)) {
      validationError("duplicate_output_name", "The ZIP archive contains a duplicate page filename.");
    }
    if (!(output.bytes instanceof Uint8Array) || output.bytes.byteLength === 0) {
      validationError("invalid_output_name", "Every ZIP entry must contain a non-empty page image.");
    }
    totalBytes = addEncodedOutputBytes(totalBytes, output.bytes.byteLength);
    entries[output.name] = [output.bytes, {
      level: 0,
      mtime: new Date(1980, 0, 1, 0, 0, 0, 0),
    }];
  }
  return entries;
}
