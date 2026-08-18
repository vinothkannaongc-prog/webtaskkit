import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync, zipSync } from "fflate";
import {
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
} from "../lib/pdfToImage.ts";

function pdfBytes(version = "1.7") {
  return new TextEncoder().encode(`%PDF-${version}\n%%EOF\n`);
}

function expectCode(code, callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof PdfToImageValidationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("accepts exact PDF 1.x and 2.x headers with matching metadata", () => {
  for (const version of ["1.0", "1.7", "2.0"]) {
    const bytes = pdfBytes(version);
    assert.doesNotThrow(() => validatePdfFile({ name: "document.PDF", sizeBytes: bytes.byteLength, bytes }));
  }
});

test("preflights filename and byte metadata without allocating or reading file content", () => {
  assert.doesNotThrow(() => validatePdfFileMetadata({ name: "small.pdf", sizeBytes: 1 }));
  assert.doesNotThrow(() => validatePdfFileMetadata({
    name: "boundary.PDF",
    sizeBytes: PDF_TO_IMAGE_LIMITS.maxFileBytes,
  }));
  expectCode("empty_file", () => validatePdfFileMetadata({ name: "empty.pdf", sizeBytes: 0 }));
  expectCode("file_too_large", () => validatePdfFileMetadata({
    name: "oversized.pdf",
    sizeBytes: PDF_TO_IMAGE_LIMITS.maxFileBytes + 1,
  }));
  expectCode("unsupported_extension", () => validatePdfFileMetadata({ name: "renamed.txt", sizeBytes: 1 }));
  expectCode("invalid_file_metadata", () => validatePdfFileMetadata({ name: "document.pdf", sizeBytes: 1.5 }));
});

test("rejects empty, mismatched, oversized, renamed, and non-PDF selections", () => {
  expectCode("empty_file", () => validatePdfFile({ name: "empty.pdf", sizeBytes: 0, bytes: new Uint8Array() }));
  expectCode("invalid_file_metadata", () => validatePdfFile({ name: "changed.pdf", sizeBytes: 9, bytes: pdfBytes() }));
  expectCode("unsupported_extension", () => {
    const bytes = pdfBytes();
    validatePdfFile({ name: "renamed.txt", sizeBytes: bytes.byteLength, bytes });
  });
  expectCode("unsupported_content", () => {
    const bytes = new TextEncoder().encode("not a PDF");
    validatePdfFile({ name: "fake.pdf", sizeBytes: bytes.byteLength, bytes });
  });
  expectCode("file_too_large", () => validatePdfFile({
    name: "large.pdf",
    sizeBytes: PDF_TO_IMAGE_LIMITS.maxFileBytes + 1,
    bytes: pdfBytes(),
  }));
});

test("uses one absolute inspection or conversion deadline without phase resets", () => {
  const inspect = createPdfOperationDeadline(1_000, PDF_TO_IMAGE_TIMEOUTS.inspectMilliseconds);
  assert.deepEqual(inspect, { startedAtMilliseconds: 1_000, expiresAtMilliseconds: 31_000 });
  assert.equal(pdfOperationMillisecondsRemaining(inspect, 1_000), 30_000);
  assert.equal(pdfOperationMillisecondsRemaining(inspect, 30_999.2), 1);
  assert.equal(pdfOperationMillisecondsRemaining(inspect, 31_000), 0);
  assert.equal(pdfOperationMillisecondsRemaining(inspect, 99_000), 0);

  const convert = createPdfOperationDeadline(5_000, PDF_TO_IMAGE_TIMEOUTS.convertMilliseconds);
  assert.equal(convert.expiresAtMilliseconds, 125_000);
  assert.equal(pdfOperationMillisecondsRemaining(convert, 65_000), 60_000);
  assert.equal(convert.expiresAtMilliseconds, 125_000, "phase checks must not extend the deadline");
  expectCode("resource_overflow", () => createPdfOperationDeadline(-1, 30_000));
  expectCode("resource_overflow", () => createPdfOperationDeadline(1_000, 0));
});

test("rejects headers that do not start at byte zero or claim an unsupported major version", () => {
  for (const source of [" \n%PDF-1.7", "%PDF-3.0", "%PDF-1-x", "%PDF-"]) {
    const bytes = new TextEncoder().encode(source);
    expectCode("unsupported_content", () => validatePdfFile({ name: "bad.pdf", sizeBytes: bytes.byteLength, bytes }));
  }
});

test("enforces document page counts below, at, and above the fixed limit", () => {
  assert.equal(validatePdfPageCount(1), 1);
  assert.equal(validatePdfPageCount(PDF_TO_IMAGE_LIMITS.maxDocumentPages), PDF_TO_IMAGE_LIMITS.maxDocumentPages);
  expectCode("invalid_page_count", () => validatePdfPageCount(0));
  expectCode("invalid_page_count", () => validatePdfPageCount(1.5));
  expectCode("too_many_document_pages", () => validatePdfPageCount(PDF_TO_IMAGE_LIMITS.maxDocumentPages + 1));
});

test("parses all, single pages, forward ranges, whitespace, and duplicates in document order", () => {
  assert.deepEqual(parsePdfPageRange("all", 4), [1, 2, 3, 4]);
  assert.deepEqual(parsePdfPageRange("", 3), [1, 2, 3]);
  assert.deepEqual(parsePdfPageRange(" 5, 1-3, 2, 7 - 8 ", 8), [1, 2, 3, 5, 7, 8]);
});

test("enforces the selected-page limit below, at, and above its boundary", () => {
  assert.equal(parsePdfPageRange("1-29", 40).length, 29);
  assert.equal(parsePdfPageRange("1-30", 40).length, PDF_TO_IMAGE_LIMITS.maxOutputPages);
  expectCode("too_many_output_pages", () => parsePdfPageRange("1-31", 40));
  expectCode("too_many_output_pages", () => parsePdfPageRange("all", 31));
});

test("rejects malformed, reverse, zero, negative, and out-of-range page expressions", () => {
  for (const value of ["1-", "a", "1;2", "-1", "1--2", "1.5", "5-3", "0", ",1", "1,"]) {
    expectCode("invalid_page_range", () => parsePdfPageRange(value, 10));
  }
  expectCode("page_out_of_range", () => parsePdfPageRange("11", 10));
  expectCode("invalid_page_range", () => parsePdfPageRange("1".repeat(PDF_TO_IMAGE_LIMITS.maxRangeCharacters + 1), 10));
});

test("bounds comma-separated range work before expansion", () => {
  const tooManySegments = Array.from({ length: PDF_TO_IMAGE_LIMITS.maxRangeSegments + 1 }, () => "1").join(",");
  expectCode("invalid_page_range", () => parsePdfPageRange(tooManySegments, 10));
});

test("calculates deterministic JPG and PNG raster budgets", () => {
  assert.deepEqual(calculateRasterPageBudget(612, 792, 2, "jpg"), {
    widthPixels: 1224,
    heightPixels: 1584,
    pixelCount: 1_938_816,
    workUnits: 1_938_816,
  });
  const png = calculateRasterPageBudget(612, 792, 2, "png");
  assert.equal(png.pixelCount, 1_938_816);
  assert.equal(png.workUnits, Math.ceil(1_938_816 * 1.1));
  expectCode("invalid_raster_scale", () => calculateRasterPageBudget(612, 792, 1, "jpg"));
});

test("enforces rendered edge dimensions at their exact boundary", () => {
  assert.equal(calculateRasterPageBudget(4096, 0.5, 2, "jpg").widthPixels, 8192);
  expectCode("page_dimension_too_large", () => calculateRasterPageBudget(4096.1, 0.5, 2, "jpg"));
});

test("enforces per-page pixels below, at, and above the fixed cap", () => {
  assert.equal(calculateRasterPageBudget(3000, 1500, 2, "jpg").pixelCount, 18_000_000);
  assert.equal(calculateRasterPageBudget(2999.5, 1500, 2, "jpg").pixelCount, 17_997_000);
  expectCode("page_pixels_too_large", () => calculateRasterPageBudget(3000, 1500.5, 2, "jpg"));
});

test("rejects non-finite and non-positive page geometry", () => {
  for (const [width, height] of [[0, 10], [-1, 10], [10, Number.POSITIVE_INFINITY], [Number.NaN, 10]]) {
    expectCode("invalid_page_dimensions", () => calculateRasterPageBudget(width, height, 2, "jpg"));
  }
});

test("adds raster pages while enforcing aggregate pixel totals", () => {
  const page = { widthPixels: 6000, heightPixels: 3000, pixelCount: 18_000_000, workUnits: 18_000_000 };
  let batch = { pages: 0, totalPixels: 0, totalWorkUnits: 0 };
  for (let index = 0; index < 5; index += 1) batch = addRasterPageBudget(batch, page);
  assert.deepEqual(batch, { pages: 5, totalPixels: 90_000_000, totalWorkUnits: 90_000_000 });
  expectCode("total_pixels_too_large", () => addRasterPageBudget(batch, {
    widthPixels: 1,
    heightPixels: 1,
    pixelCount: 1,
    workUnits: 1,
  }));
});

test("enforces the aggregate render-work cap independently", () => {
  const page = { widthPixels: 1, heightPixels: 1, pixelCount: 1, workUnits: 20_000_000 };
  let batch = { pages: 0, totalPixels: 0, totalWorkUnits: 0 };
  for (let index = 0; index < 5; index += 1) batch = addRasterPageBudget(batch, page);
  assert.equal(batch.totalWorkUnits, PDF_TO_IMAGE_LIMITS.maxRenderWorkUnits);
  expectCode("render_work_too_large", () => addRasterPageBudget(batch, page));
});

test("rejects fabricated raster budgets instead of trusting callers", () => {
  expectCode("resource_overflow", () => addRasterPageBudget(
    { pages: 0, totalPixels: 0, totalWorkUnits: 0 },
    { widthPixels: 0, heightPixels: 1, pixelCount: 1, workUnits: 1 },
  ));
  expectCode("resource_overflow", () => addRasterPageBudget(
    { pages: 0, totalPixels: 0, totalWorkUnits: 0 },
    { widthPixels: 1, heightPixels: 1, pixelCount: 1, workUnits: 0 },
  ));
});

test("enforces encoded-output and archive bytes below, at, and above each cap", () => {
  assert.equal(addEncodedOutputBytes(PDF_TO_IMAGE_LIMITS.maxEncodedOutputBytes - 1, 1), PDF_TO_IMAGE_LIMITS.maxEncodedOutputBytes);
  expectCode("encoded_output_too_large", () => addEncodedOutputBytes(PDF_TO_IMAGE_LIMITS.maxEncodedOutputBytes, 1));
  assert.equal(validateArchiveBytes(PDF_TO_IMAGE_LIMITS.maxArchiveBytes), PDF_TO_IMAGE_LIMITS.maxArchiveBytes);
  expectCode("archive_too_large", () => validateArchiveBytes(PDF_TO_IMAGE_LIMITS.maxArchiveBytes + 1));
});

test("normalizes untrusted PDF names to bounded portable output bases", () => {
  assert.equal(normalizePdfOutputBase("  Résumé / Q3:final.PDF  "), "Resume-Q3-final");
  assert.equal(normalizePdfOutputBase("..."), "webtaskkit-pdf-pages");
  assert.equal(normalizePdfOutputBase("a".repeat(100)).length, 64);
});

test("builds deterministic page filenames and archive names", () => {
  assert.equal(buildRasterFilename("report.pdf", 1, 8, "jpg"), "report-page-01.jpg");
  assert.equal(buildRasterFilename("report", 8, 100, "png"), "report-page-008.png");
  assert.equal(buildRasterArchiveFilename("report.pdf"), "report-images.zip");
  expectCode("invalid_output_name", () => buildRasterFilename("report", 0, 8, "jpg"));
  expectCode("invalid_output_name", () => buildRasterFilename("report", 9, 8, "jpg"));
});

test("prepares a flat ZIP with exact safe unique page entries", () => {
  const outputs = [
    { name: "report-page-01.jpg", bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]) },
    { name: "report-page-03.jpg", bytes: Uint8Array.from([0xff, 0xd8, 0x01, 0xd9]) },
  ];
  const archive = zipSync(prepareZipEntries(outputs));
  const repeatedArchive = zipSync(prepareZipEntries(outputs));
  assert.deepEqual(repeatedArchive, archive, "fixed entry mtimes must make ZIP bytes repeatable");
  const unpacked = unzipSync(archive);
  assert.deepEqual(Object.keys(unpacked).sort(), ["report-page-01.jpg", "report-page-03.jpg"]);
  assert.deepEqual(unpacked["report-page-01.jpg"], outputs[0].bytes);
  assert.deepEqual(unpacked["report-page-03.jpg"], outputs[1].bytes);
});

test("rejects ZIPs with unsafe, duplicate, empty, or single entries", () => {
  expectCode("invalid_output_name", () => prepareZipEntries([
    { name: "report-page-01.jpg", bytes: Uint8Array.of(1) },
  ]));
  expectCode("invalid_output_name", () => prepareZipEntries([
    { name: "../report-page-01.jpg", bytes: Uint8Array.of(1) },
    { name: "report-page-02.jpg", bytes: Uint8Array.of(2) },
  ]));
  expectCode("duplicate_output_name", () => prepareZipEntries([
    { name: "report-page-01.png", bytes: Uint8Array.of(1) },
    { name: "report-page-01.png", bytes: Uint8Array.of(2) },
  ]));
  expectCode("invalid_output_name", () => prepareZipEntries([
    { name: "report-page-01.png", bytes: new Uint8Array() },
    { name: "report-page-02.png", bytes: Uint8Array.of(2) },
  ]));
});
