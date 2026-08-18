import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_TO_PDF_LIMITS,
  PDF_PAGE_SIZES,
  ImageToPdfValidationError,
  addEncodedPdfImageBytes,
  calculatePdfPageLayout,
  calculatePdfRasterDimensions,
  inspectImageHeader,
  normalizePdfFilename,
  revalidateDecodedDimensions,
  validateImageBatch,
  validateImageFile,
  validateImageSelectionMetadata,
} from "../lib/imageToPdf.ts";

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value) {
  return [
    Math.floor(value / 0x1000000) & 0xff,
    Math.floor(value / 0x10000) & 0xff,
    Math.floor(value / 0x100) & 0xff,
    value & 0xff,
  ];
}

function pngChunk(type, data = []) {
  const typeBytes = [...type].map((character) => character.charCodeAt(0));
  const payload = [...typeBytes, ...data];
  return [...uint32(data.length), ...payload, ...uint32(crc32(payload))];
}

function makePng({
  width = 2,
  height = 3,
  bitDepth = 8,
  colorType = 6,
  compression = 0,
  filter = 0,
  interlace = 0,
  beforeIdat = [],
  imageData = [1],
  afterIdat = [],
} = {}) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = pngChunk("IHDR", [
    ...uint32(width),
    ...uint32(height),
    bitDepth,
    colorType,
    compression,
    filter,
    interlace,
  ]);
  return Uint8Array.from([
    ...signature,
    ...ihdr,
    ...beforeIdat.flat(),
    ...pngChunk("IDAT", imageData),
    ...afterIdat.flat(),
    ...pngChunk("IEND"),
  ]);
}

function makeJpeg({ width = 2, height = 3, trailing = [] } = {}) {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11,
    0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03,
    0x01, 0x11, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x0c,
    0x03,
    0x01, 0x00,
    0x02, 0x11,
    0x03, 0x11,
    0x00, 0x3f, 0x00,
    0x01, 0x02, 0xff, 0x00, 0x03,
    0xff, 0xd9,
    ...trailing,
  ]);
}

function errorCode(code) {
  return (error) => {
    assert.ok(error instanceof ImageToPdfValidationError);
    assert.equal(error.code, code);
    return true;
  };
}

function metadataFiles(count, sizeBytes = 1) {
  return Array.from({ length: count }, (_, index) => ({
    name: `image-${index}.png`,
    sizeBytes,
  }));
}

function validated(overrides = {}) {
  const width = overrides.width ?? 2;
  const height = overrides.height ?? 3;
  return {
    name: "image.png",
    sizeBytes: 1,
    format: "png",
    mimeType: "image/png",
    width,
    height,
    pixelCount: width * height,
    ...overrides,
  };
}

test("exports the fixed file, byte, pixel, and margin budgets", () => {
  assert.deepEqual(IMAGE_TO_PDF_LIMITS, {
    maxFiles: 20,
    maxFileBytes: 15 * 1024 * 1024,
    maxTotalBytes: 50 * 1024 * 1024,
    maxPixelsPerImage: 24_000_000,
    maxTotalPixels: 80_000_000,
    maxEncodedPdfImageBytes: 60 * 1024 * 1024,
    maxMarginPoints: 144,
    maxRasterDpi: 240,
  });
  assert.deepEqual(PDF_PAGE_SIZES, {
    a4: { width: 595.28, height: 841.89 },
    letter: { width: 612, height: 792 },
  });
});

test("enforces below, exact, and above file-count bounds", () => {
  assert.equal(validateImageSelectionMetadata(metadataFiles(19)).fileCount, 19);
  assert.equal(validateImageSelectionMetadata(metadataFiles(20)).fileCount, 20);
  assert.throws(() => validateImageSelectionMetadata(metadataFiles(21)), errorCode("too_many_files"));
  assert.throws(() => validateImageSelectionMetadata([]), errorCode("no_files"));
});

test("enforces below, exact, and above per-file byte bounds", () => {
  const maximum = IMAGE_TO_PDF_LIMITS.maxFileBytes;
  assert.equal(validateImageSelectionMetadata(metadataFiles(1, maximum - 1)).totalBytes, maximum - 1);
  assert.equal(validateImageSelectionMetadata(metadataFiles(1, maximum)).totalBytes, maximum);
  assert.throws(
    () => validateImageSelectionMetadata(metadataFiles(1, maximum + 1)),
    errorCode("file_too_large"),
  );
  assert.throws(() => validateImageSelectionMetadata(metadataFiles(1, 0)), errorCode("empty_file"));
  assert.throws(
    () => validateImageSelectionMetadata(metadataFiles(1, Number.MAX_SAFE_INTEGER + 1)),
    errorCode("invalid_file_metadata"),
  );
});

test("enforces below, exact, and above aggregate byte bounds without allocation", () => {
  const mib = 1024 * 1024;
  const below = [15, 15, 15, 5].map((size, index) => ({ name: `${index}.png`, sizeBytes: size * mib }));
  below[3].sizeBytes -= 1;
  const exact = [15, 15, 15, 5].map((size, index) => ({ name: `${index}.png`, sizeBytes: size * mib }));
  const above = exact.map((file) => ({ ...file }));
  above[3].sizeBytes += 1;
  assert.equal(validateImageSelectionMetadata(below).totalBytes, 50 * mib - 1);
  assert.equal(validateImageSelectionMetadata(exact).totalBytes, 50 * mib);
  assert.throws(() => validateImageSelectionMetadata(above), errorCode("total_size_too_large"));
});

test("parses complete PNG and JPEG marker structures rather than trusting extensions", () => {
  assert.deepEqual(inspectImageHeader(makePng({ width: 17, height: 19 })), {
    format: "png",
    mimeType: "image/png",
    width: 17,
    height: 19,
    pixelCount: 323,
  });
  assert.deepEqual(inspectImageHeader(makeJpeg({ width: 23, height: 29 })), {
    format: "jpeg",
    mimeType: "image/jpeg",
    width: 23,
    height: 29,
    pixelCount: 667,
  });
});

test("accepts matching extensions and rejects spoofed or unsupported extensions and content", () => {
  const png = makePng();
  const jpeg = makeJpeg();
  assert.equal(validateImageFile({ name: "IMAGE.PNG", sizeBytes: png.length, bytes: png }).format, "png");
  assert.equal(validateImageFile({ name: "photo.JPEG", sizeBytes: jpeg.length, bytes: jpeg }).format, "jpeg");
  assert.throws(
    () => validateImageFile({ name: "spoof.jpg", sizeBytes: png.length, bytes: png }),
    errorCode("extension_content_mismatch"),
  );
  assert.throws(
    () => validateImageFile({ name: "spoof.png", sizeBytes: jpeg.length, bytes: jpeg }),
    errorCode("extension_content_mismatch"),
  );
  assert.throws(
    () => validateImageSelectionMetadata([{ name: "image.gif", sizeBytes: 10 }]),
    errorCode("unsupported_extension"),
  );
  assert.throws(
    () => validateImageFile({ name: "image.png", sizeBytes: 6, bytes: Uint8Array.from([71, 73, 70, 56, 57, 97]) }),
    errorCode("unsupported_content"),
  );
  assert.throws(
    () => validateImageFile({ name: "image.png", sizeBytes: png.length + 1, bytes: png }),
    errorCode("invalid_file_metadata"),
  );
});

test("rejects malformed and truncated PNG structures and invalid IHDR fields", () => {
  const valid = makePng();
  const badCrc = valid.slice();
  badCrc[29] ^= 1;
  const invalidColorMode = makePng({ bitDepth: 4, colorType: 6 });
  const invalidCompression = makePng({ compression: 1 });
  const noEnding = valid.slice(0, -12);
  const trailing = Uint8Array.from([...valid, 0]);
  for (const bytes of [
    Uint8Array.from([137, 80]),
    valid.slice(0, 32),
    badCrc,
    invalidColorMode,
    invalidCompression,
    noEnding,
    trailing,
  ]) {
    assert.throws(() => inspectImageHeader(bytes), errorCode("malformed_image"));
  }
});

test("rejects APNG animation control and invalid PNG palette ordering", () => {
  const animationControl = pngChunk("acTL", [...uint32(2), ...uint32(0)]);
  assert.throws(
    () => inspectImageHeader(makePng({ beforeIdat: [animationControl] })),
    errorCode("animated_image_unsupported"),
  );
  assert.throws(
    () => inspectImageHeader(makePng({ colorType: 3, bitDepth: 8 })),
    errorCode("malformed_image"),
  );
  const palette = pngChunk("PLTE", [0, 0, 0]);
  assert.equal(inspectImageHeader(makePng({ colorType: 3, bitDepth: 8, beforeIdat: [palette] })).format, "png");
  const oversizedOneBitPalette = pngChunk("PLTE", [0, 0, 0, 255, 255, 255, 127, 127, 127]);
  assert.throws(
    () => inspectImageHeader(makePng({ colorType: 3, bitDepth: 1, beforeIdat: [oversizedOneBitPalette] })),
    errorCode("malformed_image"),
  );
});

test("rejects malformed, truncated, and polyglot-like JPEG marker streams", () => {
  const valid = makeJpeg();
  const badSegmentLength = valid.slice();
  badSegmentLength[4] = 0xff;
  badSegmentLength[5] = 0xff;
  const noEnd = valid.slice(0, -2);
  const noScan = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);
  const emptyScan = Uint8Array.from([...valid.slice(0, -7), 0xff, 0xd9]);
  for (const bytes of [
    Uint8Array.from([0xff, 0xd8]),
    badSegmentLength,
    noEnd,
    noScan,
    emptyScan,
    makeJpeg({ trailing: [0x3c, 0x68, 0x74, 0x6d, 0x6c] }),
  ]) {
    assert.throws(() => inspectImageHeader(bytes), errorCode("malformed_image"));
  }
});

test("enforces below, exact, and above per-image pixel bounds", () => {
  const below = makePng({ width: 5_999, height: 4_000 });
  const exact = makePng({ width: 6_000, height: 4_000 });
  const above = makePng({ width: 6_001, height: 4_000 });
  assert.equal(inspectImageHeader(below).pixelCount, 23_996_000);
  assert.equal(inspectImageHeader(exact).pixelCount, 24_000_000);
  assert.throws(() => inspectImageHeader(above), errorCode("image_too_large"));
});

test("enforces below, exact, and above aggregate pixel bounds", () => {
  const below = [
    validated({ width: 5_000, height: 4_000 }),
    validated({ width: 5_000, height: 4_000 }),
    validated({ width: 5_000, height: 4_000 }),
    validated({ width: 4_999, height: 4_000 }),
  ];
  const exact = Array.from({ length: 4 }, () => validated({ width: 5_000, height: 4_000 }));
  const above = [
    ...exact,
    validated({ width: 1, height: 1 }),
  ];
  assert.equal(validateImageBatch(below).totalPixels, 79_996_000);
  assert.equal(validateImageBatch(exact).totalPixels, 80_000_000);
  assert.throws(() => validateImageBatch(above), errorCode("total_pixels_too_large"));
});

test("fails safely on enormous dimensions, inconsistent totals, and integer overflow", () => {
  assert.throws(
    () => inspectImageHeader(makePng({ width: 0xffffffff, height: 0xffffffff })),
    errorCode("resource_overflow"),
  );
  assert.throws(
    () => inspectImageHeader(makePng({ width: 24_000_001, height: 1 })),
    errorCode("image_too_large"),
  );
  assert.throws(
    () => validateImageBatch([validated({ pixelCount: 7 })]),
    errorCode("invalid_file_metadata"),
  );
});

test("revalidates decoded dimensions, including JPEG EXIF-orientation swaps only", () => {
  const png = inspectImageHeader(makePng({ width: 120, height: 80 }));
  const jpeg = inspectImageHeader(makeJpeg({ width: 120, height: 80 }));
  assert.deepEqual(revalidateDecodedDimensions(png, 120, 80), {
    width: 120,
    height: 80,
    pixelCount: 9_600,
  });
  assert.deepEqual(revalidateDecodedDimensions(jpeg, 80, 120), {
    width: 80,
    height: 120,
    pixelCount: 9_600,
  });
  assert.throws(() => revalidateDecodedDimensions(png, 80, 120), errorCode("decoded_dimensions_mismatch"));
  assert.throws(() => revalidateDecodedDimensions(jpeg, 121, 80), errorCode("decoded_dimensions_mismatch"));
  assert.throws(() => revalidateDecodedDimensions(jpeg, 40_000_001, 1), errorCode("image_too_large"));
});

test("selects A4 and Letter orientation deterministically", () => {
  const portrait = calculatePdfPageLayout({
    format: "a4",
    orientation: "auto",
    imageWidth: 600,
    imageHeight: 900,
    marginPoints: 0,
  });
  assert.equal(portrait.orientation, "portrait");
  assert.equal(portrait.pageWidthPoints, 595.28);
  assert.equal(portrait.pageHeightPoints, 841.89);

  const landscape = calculatePdfPageLayout({
    format: "letter",
    orientation: "auto",
    imageWidth: 900,
    imageHeight: 600,
    marginPoints: 0,
  });
  assert.equal(landscape.orientation, "landscape");
  assert.equal(landscape.pageWidthPoints, 792);
  assert.equal(landscape.pageHeightPoints, 612);

  const explicit = calculatePdfPageLayout({
    format: "letter",
    orientation: "portrait",
    imageWidth: 900,
    imageHeight: 600,
    marginPoints: 0,
  });
  assert.equal(explicit.orientation, "portrait");
  assert.equal(explicit.pageWidthPoints, 612);
  assert.equal(explicit.pageHeightPoints, 792);
});

test("enforces below, exact, and above non-negative margin bounds", () => {
  const input = {
    format: "a4",
    orientation: "portrait",
    imageWidth: 100,
    imageHeight: 100,
  };
  assert.equal(calculatePdfPageLayout({ ...input, marginPoints: 143.99 }).marginPoints, 143.99);
  assert.equal(calculatePdfPageLayout({ ...input, marginPoints: 144 }).marginPoints, 144);
  assert.throws(() => calculatePdfPageLayout({ ...input, marginPoints: 144.001 }), errorCode("invalid_margin"));
  assert.throws(() => calculatePdfPageLayout({ ...input, marginPoints: 144.01 }), errorCode("invalid_margin"));
  assert.throws(() => calculatePdfPageLayout({ ...input, marginPoints: -0.01 }), errorCode("invalid_margin"));
  assert.throws(() => calculatePdfPageLayout({ ...input, marginPoints: Number.NaN }), errorCode("invalid_margin"));
});

test("contain-fits and centers at centipoint precision without upscaling by default", () => {
  const small = calculatePdfPageLayout({
    format: "a4",
    orientation: "portrait",
    imageWidth: 100,
    imageHeight: 50,
    marginPoints: 0,
  });
  assert.deepEqual(
    {
      x: small.xPoints,
      y: small.yPoints,
      width: small.imageWidthPoints,
      height: small.imageHeightPoints,
      scale: small.scale,
    },
    { x: 247.64, y: 395.94, width: 100, height: 50, scale: 1 },
  );

  const enlarged = calculatePdfPageLayout({
    format: "a4",
    orientation: "portrait",
    imageWidth: 100,
    imageHeight: 50,
    marginPoints: 0,
    allowUpscale: true,
  });
  assert.deepEqual(
    {
      x: enlarged.xPoints,
      y: enlarged.yPoints,
      width: enlarged.imageWidthPoints,
      height: enlarged.imageHeightPoints,
    },
    { x: 0, y: 272.12, width: 595.28, height: 297.64 },
  );

  const contained = calculatePdfPageLayout({
    format: "a4",
    orientation: "portrait",
    imageWidth: 1_200,
    imageHeight: 600,
    marginPoints: 0,
  });
  assert.equal(contained.imageWidthPoints, 595.28);
  assert.equal(contained.imageHeightPoints, 297.64);
  assert.equal(contained.scale, 0.49606667);
});

test("rounds margins and geometry deterministically and rejects unrepresentable ratios", () => {
  const layout = calculatePdfPageLayout({
    format: "letter",
    orientation: "portrait",
    imageWidth: 500,
    imageHeight: 500,
    marginPoints: 1.234,
  });
  assert.equal(layout.marginPoints, 1.23);
  for (const value of [
    layout.marginPoints,
    layout.pageWidthPoints,
    layout.pageHeightPoints,
    layout.xPoints,
    layout.yPoints,
    layout.imageWidthPoints,
    layout.imageHeightPoints,
  ]) {
    assert.equal(Math.round(value * 100), value * 100);
  }
  assert.throws(
    () => calculatePdfPageLayout({
      format: "a4",
      orientation: "portrait",
      imageWidth: 24_000_000,
      imageHeight: 1,
      marginPoints: 0,
    }),
    errorCode("invalid_dimensions"),
  );
});

test("bounds the temporary canvas to 240 DPI without upscaling smaller sources", () => {
  const below = calculatePdfRasterDimensions({
    imageWidth: 239,
    imageHeight: 239,
    imageWidthPoints: 72,
    imageHeightPoints: 72,
  });
  assert.deepEqual(below, { width: 239, height: 239, pixelCount: 57_121, downsampled: false });

  const exact = calculatePdfRasterDimensions({
    imageWidth: 240,
    imageHeight: 240,
    imageWidthPoints: 72,
    imageHeightPoints: 72,
  });
  assert.deepEqual(exact, { width: 240, height: 240, pixelCount: 57_600, downsampled: false });

  const above = calculatePdfRasterDimensions({
    imageWidth: 241,
    imageHeight: 241,
    imageWidthPoints: 72,
    imageHeightPoints: 72,
  });
  assert.deepEqual(above, { width: 240, height: 240, pixelCount: 57_600, downsampled: true });

  const pageSized = calculatePdfRasterDimensions({
    imageWidth: 6_000,
    imageHeight: 4_000,
    imageWidthPoints: 576,
    imageHeightPoints: 384,
  });
  assert.deepEqual(pageSized, {
    width: 1_920,
    height: 1_280,
    pixelCount: 2_457_600,
    downsampled: true,
  });
  assert.throws(
    () => calculatePdfRasterDimensions({
      imageWidth: 1,
      imageHeight: 1,
      imageWidthPoints: 0,
      imageHeightPoints: 72,
    }),
    errorCode("invalid_dimensions"),
  );
});

test("enforces below, exact, and above cumulative encoded-output bounds", () => {
  const maximum = IMAGE_TO_PDF_LIMITS.maxEncodedPdfImageBytes;
  assert.equal(addEncodedPdfImageBytes(0, maximum - 1), maximum - 1);
  assert.equal(addEncodedPdfImageBytes(maximum - 1, 1), maximum);
  assert.throws(() => addEncodedPdfImageBytes(maximum, 1), errorCode("encoded_output_too_large"));
  assert.throws(() => addEncodedPdfImageBytes(0, 0), errorCode("resource_overflow"));
  assert.throws(() => addEncodedPdfImageBytes(Number.MAX_SAFE_INTEGER, 1), errorCode("resource_overflow"));
});

test("normalizes safe bounded PDF download filenames", () => {
  assert.equal(normalizePdfFilename("report.PDF"), "report.pdf");
  assert.equal(normalizePdfFilename("../../CON.pdf"), "file-CON.pdf");
  assert.equal(normalizePdfFilename("COM1.notes.pdf"), "file-COM1.notes.pdf");
  assert.equal(normalizePdfFilename("résumé 2026?.PDF"), "resume-2026.pdf");
  assert.equal(normalizePdfFilename("...\u0000"), "webtaskkit-images.pdf");
  assert.equal(normalizePdfFilename("report.pdf.pdf"), "report.pdf");
  assert.equal(normalizePdfFilename("", "My fallback"), "My-fallback.pdf");
  const longName = normalizePdfFilename("a".repeat(200));
  assert.equal(longName, `${"a".repeat(80)}.pdf`);
  assert.equal(longName.length, 84);
});
