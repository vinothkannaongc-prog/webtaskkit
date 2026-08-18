/**
 * Pure validation and page-layout helpers for the browser-only Image to PDF tool.
 *
 * Image pixels are treated as PDF points at 72 pixels per inch. Images are never
 * enlarged unless `allowUpscale` is explicitly enabled. All emitted geometry is
 * rounded down to centipoints (0.01 PDF point) so repeated calculations are
 * deterministic.
 */

const MEBIBYTE = 1024 * 1024;
const CENTIPOINTS_PER_POINT = 100;
const CRC32_TABLE = new Uint32Array(256);

for (let value = 0; value < CRC32_TABLE.length; value += 1) {
  let entry = value;
  for (let bit = 0; bit < 8; bit += 1) {
    entry = (entry >>> 1) ^ (0xedb88320 & -(entry & 1));
  }
  CRC32_TABLE[value] = entry >>> 0;
}

export const IMAGE_TO_PDF_LIMITS = Object.freeze({
  maxFiles: 20,
  maxFileBytes: 15 * MEBIBYTE,
  maxTotalBytes: 50 * MEBIBYTE,
  maxPixelsPerImage: 24_000_000,
  maxTotalPixels: 80_000_000,
  maxEncodedPdfImageBytes: 60 * MEBIBYTE,
  maxMarginPoints: 144,
  maxRasterDpi: 240,
});

export const PDF_PAGE_SIZES = Object.freeze({
  a4: Object.freeze({ width: 595.28, height: 841.89 }),
  letter: Object.freeze({ width: 612, height: 792 }),
});

const PAGE_SIZES_CENTIPOINTS = {
  a4: { width: 59_528, height: 84_189 },
  letter: { width: 61_200, height: 79_200 },
} as const;

export type ImageFormat = "jpeg" | "png";
export type SupportedImageMimeType = "image/jpeg" | "image/png";
export type PdfPageFormat = keyof typeof PDF_PAGE_SIZES;
export type PdfOrientation = "portrait" | "landscape" | "auto";
export type ResolvedPdfOrientation = Exclude<PdfOrientation, "auto">;

export type ImageToPdfErrorCode =
  | "no_files"
  | "too_many_files"
  | "invalid_file_metadata"
  | "empty_file"
  | "file_too_large"
  | "total_size_too_large"
  | "unsupported_extension"
  | "unsupported_content"
  | "animated_image_unsupported"
  | "extension_content_mismatch"
  | "malformed_image"
  | "image_too_large"
  | "total_pixels_too_large"
  | "encoded_output_too_large"
  | "decoded_dimensions_mismatch"
  | "invalid_page_format"
  | "invalid_orientation"
  | "invalid_margin"
  | "invalid_dimensions"
  | "resource_overflow";

export class ImageToPdfValidationError extends Error {
  readonly code: ImageToPdfErrorCode;

  constructor(code: ImageToPdfErrorCode, message: string) {
    super(message);
    this.name = "ImageToPdfValidationError";
    this.code = code;
  }
}

export type ValidatedImageHeader = {
  format: ImageFormat;
  mimeType: SupportedImageMimeType;
  width: number;
  height: number;
  pixelCount: number;
};

export type ValidatedImageFile = ValidatedImageHeader & {
  name: string;
  sizeBytes: number;
};

export type ImageSelectionMetadata = {
  fileCount: number;
  totalBytes: number;
};

export type ImageBatchTotals = ImageSelectionMetadata & {
  totalPixels: number;
};

export type DecodedImageDimensions = {
  width: number;
  height: number;
  pixelCount: number;
};

export type PdfPageLayout = {
  format: PdfPageFormat;
  orientation: ResolvedPdfOrientation;
  marginPoints: number;
  pageWidthPoints: number;
  pageHeightPoints: number;
  xPoints: number;
  yPoints: number;
  imageWidthPoints: number;
  imageHeightPoints: number;
  scale: number;
};

export type PdfRasterDimensions = {
  width: number;
  height: number;
  pixelCount: number;
  downsampled: boolean;
};

export type ImageFileMetadata = {
  name: string;
  sizeBytes: number;
};

export type ValidateImageFileInput = ImageFileMetadata & {
  bytes: Uint8Array;
};

export type CalculatePdfPageLayoutInput = {
  format: PdfPageFormat;
  orientation: PdfOrientation;
  imageWidth: number;
  imageHeight: number;
  marginPoints: number;
  allowUpscale?: boolean;
};

export type CalculatePdfRasterDimensionsInput = {
  imageWidth: number;
  imageHeight: number;
  imageWidthPoints: number;
  imageHeightPoints: number;
};

type JpegFrame = ValidatedImageHeader & {
  componentIds: ReadonlySet<number>;
};

function validationError(code: ImageToPdfErrorCode, message: string): never {
  throw new ImageToPdfValidationError(code, message);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeProduct(left: number, right: number): number {
  if (!isPositiveSafeInteger(left) || !isPositiveSafeInteger(right)) {
    validationError("invalid_dimensions", "Image dimensions must be positive whole numbers.");
  }
  if (left > Math.floor(Number.MAX_SAFE_INTEGER / right)) {
    validationError("resource_overflow", "Image dimensions are too large to process safely.");
  }
  return left * right;
}

function checkedAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0) {
    validationError("resource_overflow", "Resource totals must be non-negative safe integers.");
  }
  if (left > Number.MAX_SAFE_INTEGER - right) {
    validationError("resource_overflow", "Resource totals are too large to process safely.");
  }
  return left + right;
}

function imageFormatForFilename(filename: string): ImageFormat {
  if (typeof filename !== "string" || filename.trim().length === 0) {
    validationError("invalid_file_metadata", "Each image must have a filename.");
  }
  const match = /\.([^.\\/]+)$/.exec(filename.trim());
  const extension = match?.[1].toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  if (extension === "png") return "png";
  validationError("unsupported_extension", "Only .jpg, .jpeg, and .png files are supported.");
}

function validateFileSize(sizeBytes: number): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    validationError("invalid_file_metadata", "File sizes must be non-negative whole bytes.");
  }
  if (sizeBytes === 0) {
    validationError("empty_file", "Empty image files are not supported.");
  }
  if (sizeBytes > IMAGE_TO_PDF_LIMITS.maxFileBytes) {
    validationError("file_too_large", "Each image must be 15 MiB or smaller.");
  }
}

function makeHeader(format: ImageFormat, width: number, height: number): ValidatedImageHeader {
  const pixelCount = safeProduct(width, height);
  if (pixelCount > IMAGE_TO_PDF_LIMITS.maxPixelsPerImage) {
    validationError("image_too_large", "Each image must contain no more than 24 megapixels.");
  }
  return {
    format,
    mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
    width,
    height,
    pixelCount,
  };
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset > bytes.byteLength - 4) {
    validationError("malformed_image", "The image header is truncated.");
  }
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  );
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset > bytes.byteLength - 2) {
    validationError("malformed_image", "The image header is truncated.");
  }
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunkType(bytes: Uint8Array, offset: number): string {
  let type = "";
  for (let index = 0; index < 4; index += 1) {
    const value = bytes[offset + index];
    const isAsciiLetter = (value >= 65 && value <= 90) || (value >= 97 && value <= 122);
    if (!isAsciiLetter) {
      validationError("malformed_image", "The PNG contains an invalid chunk type.");
    }
    type += String.fromCharCode(value);
  }
  if (type.charCodeAt(2) >= 97) {
    validationError("malformed_image", "The PNG chunk reserved bit is invalid.");
  }
  return type;
}

function validatePngColorMode(bitDepth: number, colorType: number): void {
  const permittedDepths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!permittedDepths[colorType]?.includes(bitDepth)) {
    validationError("malformed_image", "The PNG IHDR color type and bit depth are invalid.");
  }
}

function parsePng(bytes: Uint8Array): ValidatedImageHeader {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const;
  if (bytes.byteLength < 33) {
    validationError("malformed_image", "The PNG header is truncated.");
  }
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      validationError("unsupported_content", "The file is not a supported JPEG or PNG image.");
    }
  }
  if (readUint32BigEndian(bytes, 8) !== 13 || pngChunkType(bytes, 12) !== "IHDR") {
    validationError("malformed_image", "The PNG must begin with a valid IHDR chunk.");
  }
  if (crc32(bytes, 12, 29) !== readUint32BigEndian(bytes, 29)) {
    validationError("malformed_image", "The PNG IHDR checksum is invalid.");
  }

  const width = readUint32BigEndian(bytes, 16);
  const height = readUint32BigEndian(bytes, 20);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  validatePngColorMode(bitDepth, colorType);
  if (bytes[26] !== 0 || bytes[27] !== 0 || (bytes[28] !== 0 && bytes[28] !== 1)) {
    validationError("malformed_image", "The PNG IHDR methods are invalid.");
  }
  const header = makeHeader("png", width, height);

  let position = 33;
  let sawPalette = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let imageDataBytes = 0;
  while (position < bytes.byteLength) {
    if (position > bytes.byteLength - 12) {
      validationError("malformed_image", "The PNG chunk header is truncated.");
    }
    const chunkLength = readUint32BigEndian(bytes, position);
    const chunkType = pngChunkType(bytes, position + 4);
    const dataStart = position + 8;
    if (chunkLength > bytes.byteLength - dataStart - 4) {
      validationError("malformed_image", "The PNG chunk data is truncated.");
    }
    const dataEnd = dataStart + chunkLength;
    if (crc32(bytes, position + 4, dataEnd) !== readUint32BigEndian(bytes, dataEnd)) {
      validationError("malformed_image", "The PNG contains an invalid chunk checksum.");
    }

    if (chunkType === "acTL" || chunkType === "fcTL" || chunkType === "fdAT") {
      validationError("animated_image_unsupported", "Animated PNG images are not supported.");
    }
    if (chunkType === "IHDR") {
      validationError("malformed_image", "The PNG contains more than one IHDR chunk.");
    }
    if (chunkType === "PLTE") {
      if (sawPalette || sawImageData || chunkLength === 0 || chunkLength > 768 || chunkLength % 3 !== 0) {
        validationError("malformed_image", "The PNG palette chunk is invalid.");
      }
      if (colorType === 0 || colorType === 4) {
        validationError("malformed_image", "This PNG color type cannot contain a palette.");
      }
      if (colorType === 3 && chunkLength / 3 > 2 ** bitDepth) {
        validationError("malformed_image", "The indexed PNG palette has too many entries for its bit depth.");
      }
      sawPalette = true;
    } else if (chunkType === "IDAT") {
      if (imageDataEnded) {
        validationError("malformed_image", "PNG image-data chunks must be consecutive.");
      }
      if (colorType === 3 && !sawPalette) {
        validationError("malformed_image", "Indexed PNG images require a palette before image data.");
      }
      sawImageData = true;
      imageDataBytes = checkedAdd(imageDataBytes, chunkLength);
    } else if (sawImageData && chunkType !== "IEND") {
      imageDataEnded = true;
    }

    if (chunkType === "IEND") {
      if (chunkLength !== 0 || !sawImageData || imageDataBytes === 0) {
        validationError("malformed_image", "The PNG ending or image data is invalid.");
      }
      const nextPosition = dataEnd + 4;
      if (nextPosition !== bytes.byteLength) {
        validationError("malformed_image", "The PNG contains data after its ending chunk.");
      }
      return header;
    }

    const isCritical = chunkType.charCodeAt(0) >= 65 && chunkType.charCodeAt(0) <= 90;
    if (isCritical && chunkType !== "PLTE" && chunkType !== "IDAT") {
      validationError("malformed_image", "The PNG contains an unsupported critical chunk.");
    }
    position = dataEnd + 4;
  }
  validationError("malformed_image", "The PNG is missing its ending chunk.");
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function parseJpegFrame(bytes: Uint8Array, dataStart: number, segmentLength: number): JpegFrame {
  if (segmentLength < 11) {
    validationError("malformed_image", "The JPEG frame header is truncated.");
  }
  const precision = bytes[dataStart];
  const height = readUint16BigEndian(bytes, dataStart + 1);
  const width = readUint16BigEndian(bytes, dataStart + 3);
  const componentCount = bytes[dataStart + 5];
  if (precision < 1 || precision > 16 || componentCount < 1 || componentCount > 4) {
    validationError("malformed_image", "The JPEG frame header contains invalid fields.");
  }
  if (segmentLength !== 8 + 3 * componentCount) {
    validationError("malformed_image", "The JPEG frame component table is malformed.");
  }
  const componentIds = new Set<number>();
  for (let index = 0; index < componentCount; index += 1) {
    const componentOffset = dataStart + 6 + index * 3;
    const identifier = bytes[componentOffset];
    const sampling = bytes[componentOffset + 1];
    const horizontalSampling = sampling >>> 4;
    const verticalSampling = sampling & 0x0f;
    const quantizationTable = bytes[componentOffset + 2];
    if (
      componentIds.has(identifier)
      || horizontalSampling < 1
      || horizontalSampling > 4
      || verticalSampling < 1
      || verticalSampling > 4
      || quantizationTable > 3
    ) {
      validationError("malformed_image", "The JPEG frame component table contains invalid fields.");
    }
    componentIds.add(identifier);
  }
  return { ...makeHeader("jpeg", width, height), componentIds };
}

function validateJpegScan(
  bytes: Uint8Array,
  dataStart: number,
  segmentLength: number,
  frame: JpegFrame,
): void {
  if (segmentLength < 8) {
    validationError("malformed_image", "The JPEG scan header is truncated.");
  }
  const componentCount = bytes[dataStart];
  if (componentCount < 1 || componentCount > frame.componentIds.size) {
    validationError("malformed_image", "The JPEG scan component count is invalid.");
  }
  if (segmentLength !== 6 + 2 * componentCount) {
    validationError("malformed_image", "The JPEG scan component table is malformed.");
  }
  const scanIds = new Set<number>();
  for (let index = 0; index < componentCount; index += 1) {
    const componentOffset = dataStart + 1 + index * 2;
    const identifier = bytes[componentOffset];
    const tableSelectors = bytes[componentOffset + 1];
    if (
      !frame.componentIds.has(identifier)
      || scanIds.has(identifier)
      || (tableSelectors >>> 4) > 3
      || (tableSelectors & 0x0f) > 3
    ) {
      validationError("malformed_image", "The JPEG scan component table contains invalid fields.");
    }
    scanIds.add(identifier);
  }
}

function parseJpeg(bytes: Uint8Array): ValidatedImageHeader {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    validationError("unsupported_content", "The file is not a supported JPEG or PNG image.");
  }
  if (bytes.byteLength < 4) {
    validationError("malformed_image", "The JPEG header is truncated.");
  }

  let position = 2;
  let frame: JpegFrame | null = null;
  let sawScan = false;
  while (position < bytes.byteLength) {
    if (bytes[position] !== 0xff) {
      validationError("malformed_image", "The JPEG marker stream is malformed.");
    }
    while (position < bytes.byteLength && bytes[position] === 0xff) position += 1;
    if (position >= bytes.byteLength) {
      validationError("malformed_image", "The JPEG marker stream is truncated.");
    }
    const marker = bytes[position];
    position += 1;

    if (marker === 0x00) {
      validationError("malformed_image", "The JPEG contains a stuffed byte outside scan data.");
    }
    if (marker === 0xd9) {
      if (!frame || !sawScan || position !== bytes.byteLength) {
        validationError("malformed_image", "The JPEG ending or scan data is invalid.");
      }
      return {
        format: frame.format,
        mimeType: frame.mimeType,
        width: frame.width,
        height: frame.height,
        pixelCount: frame.pixelCount,
      };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      validationError("malformed_image", "The JPEG contains an unexpected standalone marker.");
    }
    if (position > bytes.byteLength - 2) {
      validationError("malformed_image", "The JPEG segment length is truncated.");
    }
    const segmentLength = readUint16BigEndian(bytes, position);
    if (segmentLength < 2 || segmentLength > bytes.byteLength - position) {
      validationError("malformed_image", "The JPEG segment is truncated.");
    }
    const dataStart = position + 2;
    const segmentEnd = position + segmentLength;

    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (frame) {
        validationError("malformed_image", "The JPEG contains more than one frame header.");
      }
      frame = parseJpegFrame(bytes, dataStart, segmentLength);
    } else if (marker === 0xda) {
      if (!frame) {
        validationError("malformed_image", "The JPEG scan appears before its frame header.");
      }
      validateJpegScan(bytes, dataStart, segmentLength, frame);
      sawScan = true;
      position = segmentEnd;

      let foundMarker = false;
      let scanDataBytes = 0;
      while (position < bytes.byteLength) {
        if (bytes[position] !== 0xff) {
          scanDataBytes += 1;
          position += 1;
          continue;
        }
        const markerStart = position;
        while (position < bytes.byteLength && bytes[position] === 0xff) position += 1;
        if (position >= bytes.byteLength) {
          validationError("malformed_image", "The JPEG scan data is truncated.");
        }
        const scanMarker = bytes[position];
        if (scanMarker === 0x00) {
          scanDataBytes += 1;
          position += 1;
          continue;
        }
        if (scanMarker >= 0xd0 && scanMarker <= 0xd7) {
          position += 1;
          continue;
        }
        position = markerStart;
        foundMarker = true;
        break;
      }
      if (!foundMarker) {
        validationError("malformed_image", "The JPEG is missing its ending marker.");
      }
      if (scanDataBytes === 0) {
        validationError("malformed_image", "The JPEG scan contains no image data.");
      }
      continue;
    }
    position = segmentEnd;
  }
  validationError("malformed_image", "The JPEG is missing its ending marker.");
}

export function validateImageSelectionMetadata(
  files: readonly ImageFileMetadata[],
): ImageSelectionMetadata {
  if (!Array.isArray(files) || files.length === 0) {
    validationError("no_files", "Choose at least one image.");
  }
  if (files.length > IMAGE_TO_PDF_LIMITS.maxFiles) {
    validationError("too_many_files", "Choose no more than 20 images at a time.");
  }
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file !== "object") {
      validationError("invalid_file_metadata", "Each image must include valid file metadata.");
    }
    imageFormatForFilename(file.name);
    validateFileSize(file.sizeBytes);
    totalBytes = checkedAdd(totalBytes, file.sizeBytes);
    if (totalBytes > IMAGE_TO_PDF_LIMITS.maxTotalBytes) {
      validationError("total_size_too_large", "The selected images must total 50 MiB or less.");
    }
  }
  return { fileCount: files.length, totalBytes };
}

export function inspectImageHeader(bytes: Uint8Array): ValidatedImageHeader {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 2) {
    validationError("unsupported_content", "The file is not a supported JPEG or PNG image.");
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes);
  if (bytes[0] === 137 && bytes[1] === 80) return parsePng(bytes);
  validationError("unsupported_content", "The file is not a supported JPEG or PNG image.");
}

export function validateImageFile(input: ValidateImageFileInput): ValidatedImageFile {
  validateImageSelectionMetadata([{ name: input.name, sizeBytes: input.sizeBytes }]);
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength !== input.sizeBytes) {
    validationError("invalid_file_metadata", "The file size does not match the image bytes read.");
  }
  const expectedFormat = imageFormatForFilename(input.name);
  const header = inspectImageHeader(input.bytes);
  if (expectedFormat !== header.format) {
    validationError(
      "extension_content_mismatch",
      "The image filename extension does not match its actual file content.",
    );
  }
  return { name: input.name.trim(), sizeBytes: input.sizeBytes, ...header };
}

export function validateImageBatch(files: readonly ValidatedImageFile[]): ImageBatchTotals {
  const metadata = validateImageSelectionMetadata(files);
  let totalPixels = 0;
  for (const file of files) {
    if (
      (file.format !== "jpeg" && file.format !== "png")
      || file.mimeType !== (file.format === "jpeg" ? "image/jpeg" : "image/png")
    ) {
      validationError("invalid_file_metadata", "The validated image metadata is inconsistent.");
    }
    const pixelCount = safeProduct(file.width, file.height);
    if (pixelCount !== file.pixelCount) {
      validationError("invalid_file_metadata", "The validated image pixel count is inconsistent.");
    }
    if (pixelCount > IMAGE_TO_PDF_LIMITS.maxPixelsPerImage) {
      validationError("image_too_large", "Each image must contain no more than 24 megapixels.");
    }
    totalPixels = checkedAdd(totalPixels, pixelCount);
    if (totalPixels > IMAGE_TO_PDF_LIMITS.maxTotalPixels) {
      validationError("total_pixels_too_large", "The selected images must total 80 megapixels or less.");
    }
  }
  return { ...metadata, totalPixels };
}

export function revalidateDecodedDimensions(
  header: ValidatedImageHeader,
  decodedWidth: number,
  decodedHeight: number,
): DecodedImageDimensions {
  const pixelCount = safeProduct(decodedWidth, decodedHeight);
  if (pixelCount > IMAGE_TO_PDF_LIMITS.maxPixelsPerImage) {
    validationError("image_too_large", "The decoded image exceeds the 24-megapixel limit.");
  }
  const exactMatch = decodedWidth === header.width && decodedHeight === header.height;
  const orientationSwap = (
    header.format === "jpeg"
    && decodedWidth === header.height
    && decodedHeight === header.width
  );
  if ((!exactMatch && !orientationSwap) || pixelCount !== header.pixelCount) {
    validationError(
      "decoded_dimensions_mismatch",
      "The decoded image dimensions do not match its validated header.",
    );
  }
  return { width: decodedWidth, height: decodedHeight, pixelCount };
}

function sanitizeFilenameBase(value: string): string {
  const leaf = value.split(/[\\/]/).at(-1) ?? "";
  return leaf
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .replace(/(?:\.pdf)+$/giu, "")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. _-]+|[. _-]+$/g, "")
    .slice(0, 80)
    .replace(/[. _-]+$/g, "");
}

export function normalizePdfFilename(value: string, fallbackBase = "webtaskkit-images"): string {
  const primary = sanitizeFilenameBase(typeof value === "string" ? value : "");
  const fallback = sanitizeFilenameBase(typeof fallbackBase === "string" ? fallbackBase : "");
  let base = primary || fallback || "webtaskkit-images";
  const windowsDeviceStem = base.split(".", 1)[0];
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(windowsDeviceStem)) base = `file-${base}`;
  return `${base}.pdf`;
}

function validateLayoutDimension(value: number): void {
  if (!isPositiveSafeInteger(value)) {
    validationError("invalid_dimensions", "Image dimensions must be positive whole numbers.");
  }
}

function pointsFromCentipoints(value: number): number {
  return value / CENTIPOINTS_PER_POINT;
}

export function calculatePdfPageLayout(input: CalculatePdfPageLayoutInput): PdfPageLayout {
  if (!(input.format in PAGE_SIZES_CENTIPOINTS)) {
    validationError("invalid_page_format", "Choose A4 or Letter page size.");
  }
  if (input.orientation !== "portrait" && input.orientation !== "landscape" && input.orientation !== "auto") {
    validationError("invalid_orientation", "Choose portrait, landscape, or automatic orientation.");
  }
  validateLayoutDimension(input.imageWidth);
  validateLayoutDimension(input.imageHeight);
  const pixels = safeProduct(input.imageWidth, input.imageHeight);
  if (pixels > IMAGE_TO_PDF_LIMITS.maxPixelsPerImage) {
    validationError("image_too_large", "The image exceeds the 24-megapixel limit.");
  }
  if (
    !Number.isFinite(input.marginPoints)
    || input.marginPoints < 0
    || input.marginPoints > IMAGE_TO_PDF_LIMITS.maxMarginPoints
  ) {
    validationError("invalid_margin", "Page margin must be a non-negative number.");
  }
  const marginCentipoints = Math.round(input.marginPoints * CENTIPOINTS_PER_POINT);
  if (marginCentipoints > IMAGE_TO_PDF_LIMITS.maxMarginPoints * CENTIPOINTS_PER_POINT) {
    validationError("invalid_margin", "Page margin must not exceed 144 points.");
  }

  const resolvedOrientation: ResolvedPdfOrientation = input.orientation === "auto"
    ? (input.imageWidth > input.imageHeight ? "landscape" : "portrait")
    : input.orientation;
  const portraitPage = PAGE_SIZES_CENTIPOINTS[input.format];
  const pageWidth = resolvedOrientation === "portrait" ? portraitPage.width : portraitPage.height;
  const pageHeight = resolvedOrientation === "portrait" ? portraitPage.height : portraitPage.width;
  const availableWidth = pageWidth - 2 * marginCentipoints;
  const availableHeight = pageHeight - 2 * marginCentipoints;
  if (availableWidth <= 0 || availableHeight <= 0) {
    validationError("invalid_margin", "Page margin leaves no usable page area.");
  }

  const naturalWidth = safeProduct(input.imageWidth, CENTIPOINTS_PER_POINT);
  const naturalHeight = safeProduct(input.imageHeight, CENTIPOINTS_PER_POINT);
  let imageWidth: number;
  let imageHeight: number;
  if (!input.allowUpscale && naturalWidth <= availableWidth && naturalHeight <= availableHeight) {
    imageWidth = naturalWidth;
    imageHeight = naturalHeight;
  } else if (availableWidth * input.imageHeight <= availableHeight * input.imageWidth) {
    imageWidth = availableWidth;
    imageHeight = Math.floor(availableWidth * input.imageHeight / input.imageWidth);
  } else {
    imageHeight = availableHeight;
    imageWidth = Math.floor(availableHeight * input.imageWidth / input.imageHeight);
  }
  if (imageWidth < 1 || imageHeight < 1) {
    validationError(
      "invalid_dimensions",
      "The image aspect ratio cannot be represented safely at centipoint precision.",
    );
  }

  const x = marginCentipoints + Math.floor((availableWidth - imageWidth) / 2);
  const y = marginCentipoints + Math.floor((availableHeight - imageHeight) / 2);
  const scale = Number((imageWidth / naturalWidth).toFixed(8));
  return {
    format: input.format,
    orientation: resolvedOrientation,
    marginPoints: pointsFromCentipoints(marginCentipoints),
    pageWidthPoints: pointsFromCentipoints(pageWidth),
    pageHeightPoints: pointsFromCentipoints(pageHeight),
    xPoints: pointsFromCentipoints(x),
    yPoints: pointsFromCentipoints(y),
    imageWidthPoints: pointsFromCentipoints(imageWidth),
    imageHeightPoints: pointsFromCentipoints(imageHeight),
    scale,
  };
}

/**
 * Bounds the temporary browser canvas to the pixels that can be useful at the
 * image's final physical size. Smaller sources are never enlarged, while large
 * camera images are resampled to at most 240 DPI before they enter jsPDF.
 */
export function calculatePdfRasterDimensions(
  input: CalculatePdfRasterDimensionsInput,
): PdfRasterDimensions {
  validateLayoutDimension(input.imageWidth);
  validateLayoutDimension(input.imageHeight);
  const sourcePixels = safeProduct(input.imageWidth, input.imageHeight);
  if (sourcePixels > IMAGE_TO_PDF_LIMITS.maxPixelsPerImage) {
    validationError("image_too_large", "The image exceeds the 24-megapixel limit.");
  }
  if (
    !Number.isFinite(input.imageWidthPoints)
    || !Number.isFinite(input.imageHeightPoints)
    || input.imageWidthPoints <= 0
    || input.imageHeightPoints <= 0
  ) {
    validationError("invalid_dimensions", "Rendered image dimensions must be positive finite numbers.");
  }

  const maxWidth = Math.max(
    1,
    Math.floor(input.imageWidthPoints * IMAGE_TO_PDF_LIMITS.maxRasterDpi / 72),
  );
  const maxHeight = Math.max(
    1,
    Math.floor(input.imageHeightPoints * IMAGE_TO_PDF_LIMITS.maxRasterDpi / 72),
  );
  const scale = Math.min(1, maxWidth / input.imageWidth, maxHeight / input.imageHeight);
  const width = Math.max(1, Math.floor(input.imageWidth * scale));
  const height = Math.max(1, Math.floor(input.imageHeight * scale));
  const pixelCount = safeProduct(width, height);

  return {
    width,
    height,
    pixelCount,
    downsampled: width < input.imageWidth || height < input.imageHeight,
  };
}

export function addEncodedPdfImageBytes(totalBytes: number, nextBytes: number): number {
  if (!Number.isSafeInteger(nextBytes) || nextBytes <= 0) {
    validationError("resource_overflow", "Encoded image sizes must be positive safe integers.");
  }
  const nextTotal = checkedAdd(totalBytes, nextBytes);
  if (nextTotal > IMAGE_TO_PDF_LIMITS.maxEncodedPdfImageBytes) {
    validationError(
      "encoded_output_too_large",
      "The prepared PDF images exceed the 60 MB output safety limit. Use fewer or smaller images.",
    );
  }
  return nextTotal;
}
