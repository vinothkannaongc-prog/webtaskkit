import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { SaxesParser } from "saxes";
import type { SaxesTagNS } from "saxes";
import { SecureHtmlFetchError } from "./secureHtmlFetch.ts";
import type { SitemapPreviewEntry, ValidatorCheck } from "./robotsSitemapTypes.ts";

const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";
const XML_SCHEMA_INSTANCE_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";

export const SITEMAP_VALIDATOR_LIMITS = Object.freeze({
  maximumRawBytes: 1 * 1_024 * 1_024,
  maximumDecodedBytes: 2 * 1_024 * 1_024,
  maximumEntriesToCount: 100_000,
  protocolMaximumEntries: 50_000,
  maximumElements: 250_000,
  maximumDepth: 64,
  maximumAttributesPerElement: 256,
  maximumTagCharacters: 64 * 1_024,
  maximumTextTokenCharacters: 256 * 1_024,
  maximumFieldCharacters: 4_096,
  maximumPreviewEntries: 100,
  parserChunkCharacters: 64 * 1_024,
});

type SitemapType = "urlset" | "sitemapindex";
type FieldName = "loc" | "lastmod" | "changefreq" | "priority";
type EntryAccumulator = {
  location: string | null;
  lastModified: string | null;
  changeFrequency: string | null;
  priority: string | null;
  issues: string[];
  seenFields: Set<FieldName>;
  lastCoreOrder: number;
  extensionsStarted: boolean;
};

export type ParsedSitemap = {
  type: SitemapType;
  namespace: string;
  entryCount: number;
  validLocationCount: number;
  invalidLocationCount: number;
  duplicateLocationCount: number;
  duplicateCoreFieldCount: number;
  outOfOrderCoreFieldCount: number;
  lastModifiedCount: number;
  changeFrequencyCount: number;
  priorityCount: number;
  previewEntries: SitemapPreviewEntry[];
  invalidLastModifiedCount: number;
  futureLastModifiedCount: number;
  invalidChangeFrequencyCount: number;
  invalidPriorityCount: number;
  outOfScopeCount: number;
  crossOriginCount: number;
  locationOriginCount: number;
  unknownCoreElementCount: number;
  unknownCoreAttributeCount: number;
  extensionElementCount: number;
  invalidExtensionPlacementCount: number;
};

function ensureBudget(signal: AbortSignal, deadlineMilliseconds: number) {
  if (signal.aborted) throw new SecureHtmlFetchError("aborted");
  if (performance.now() >= deadlineMilliseconds) throw new SecureHtmlFetchError("timeout");
}

function invalidDocument(): never {
  throw new SecureHtmlFetchError("invalid_document");
}

function normalizedMediaType(contentType: string | null) {
  if (!contentType) return { type: null, charset: null };
  const [rawType, ...parameters] = contentType.split(";");
  const type = rawType.trim().toLowerCase();
  let charset: string | null = null;
  for (const parameter of parameters) {
    const match = /^\s*charset\s*=\s*["']?([^\s;"']+)/i.exec(parameter);
    if (match) charset = match[1].toLowerCase();
  }
  return { type, charset };
}

export function validateSitemapMediaType(contentType: string | null, gzip: boolean) {
  const { type, charset } = normalizedMediaType(contentType);
  if (charset && !["utf-8", "utf8", "us-ascii"].includes(charset)) {
    throw new SecureHtmlFetchError("unsupported_content");
  }
  const xmlTypes = new Set(["application/xml", "text/xml", "text/plain", "application/octet-stream"]);
  const gzipTypes = new Set(["application/gzip", "application/x-gzip", "application/octet-stream"]);
  if (type === "text/html" || (type && !(gzip ? gzipTypes.has(type) : (xmlTypes.has(type) || type.endsWith("+xml"))))) {
    throw new SecureHtmlFetchError("unsupported_content");
  }
}

export async function decodeSitemapBody(
  body: Uint8Array,
  gzip: boolean,
  context: { signal: AbortSignal; deadlineMilliseconds: number },
) {
  if (body.byteLength > SITEMAP_VALIDATOR_LIMITS.maximumRawBytes) throw new SecureHtmlFetchError("response_too_large");
  const hasGzipMagic = body.byteLength >= 2 && body[0] === 0x1f && body[1] === 0x8b;
  if (gzip !== hasGzipMagic) throw new SecureHtmlFetchError("unsupported_content");
  if (!gzip) return body;

  const gunzip = createGunzip();
  const source = Readable.from([Buffer.from(body)]);
  const abort = () => {
    source.destroy();
    gunzip.destroy();
  };
  context.signal.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    source.pipe(gunzip);
    for await (const chunk of gunzip) {
      ensureBudget(context.signal, context.deadlineMilliseconds);
      const buffer = Buffer.from(chunk as Buffer | Uint8Array);
      bytes += buffer.byteLength;
      if (bytes > SITEMAP_VALIDATOR_LIMITS.maximumDecodedBytes) {
        abort();
        throw new SecureHtmlFetchError("response_too_large");
      }
      chunks.push(buffer);
    }
    ensureBudget(context.signal, context.deadlineMilliseconds);
    return new Uint8Array(Buffer.concat(chunks, bytes));
  } catch (error) {
    if (error instanceof SecureHtmlFetchError) throw error;
    throw new SecureHtmlFetchError(context.signal.aborted ? "aborted" : "invalid_document");
  } finally {
    context.signal.removeEventListener("abort", abort);
    abort();
  }
}

function preflightXmlTokens(
  text: string,
  context: { signal: AbortSignal; deadlineMilliseconds: number },
) {
  let markupStart = -1;
  let quote = "";
  let textStart = 0;
  for (let index = 0; index < text.length; index += 1) {
    if ((index & 16_383) === 0) ensureBudget(context.signal, context.deadlineMilliseconds);
    const character = text[index];
    if (markupStart < 0) {
      if (character === "<") {
        if (index - textStart > SITEMAP_VALIDATOR_LIMITS.maximumTextTokenCharacters) {
          throw new SecureHtmlFetchError("analysis_too_complex");
        }
        markupStart = index;
        quote = "";
      }
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === ">") {
      if (index - markupStart + 1 > SITEMAP_VALIDATOR_LIMITS.maximumTagCharacters) {
        throw new SecureHtmlFetchError("analysis_too_complex");
      }
      markupStart = -1;
      textStart = index + 1;
    }
  }
  if (markupStart >= 0 && text.length - markupStart > SITEMAP_VALIDATOR_LIMITS.maximumTagCharacters) {
    throw new SecureHtmlFetchError("analysis_too_complex");
  }
  if (markupStart < 0 && text.length - textStart > SITEMAP_VALIDATOR_LIMITS.maximumTextTokenCharacters) {
    throw new SecureHtmlFetchError("analysis_too_complex");
  }
}

function emptyEntry(): EntryAccumulator {
  return {
    location: null,
    lastModified: null,
    changeFrequency: null,
    priority: null,
    issues: [],
    seenFields: new Set(),
    lastCoreOrder: -1,
    extensionsStarted: false,
  };
}

function unexpectedCoreAttributes(tag: SaxesTagNS, root: boolean) {
  return Object.values(tag.attributes).filter((attribute) => {
    if (attribute.uri === "http://www.w3.org/2000/xmlns/") return false;
    return !(root
      && attribute.uri === XML_SCHEMA_INSTANCE_NAMESPACE
      && attribute.local === "schemaLocation");
  }).length;
}

function trimXmlWhitespace(value: string) {
  let start = 0;
  let end = value.length;
  while (start < end && [0x09, 0x0a, 0x0d, 0x20].includes(value.charCodeAt(start))) start += 1;
  while (end > start && [0x09, 0x0a, 0x0d, 0x20].includes(value.charCodeAt(end - 1))) end -= 1;
  return value.slice(start, end);
}

function hasNonXmlWhitespace(value: string) {
  for (const character of value) {
    if (![0x09, 0x0a, 0x0d, 0x20].includes(character.charCodeAt(0))) return true;
  }
  return false;
}

function decimalModulo(value: string, divisor: number) {
  let remainder = 0;
  for (let index = 0; index < value.length; index += 1) remainder = (remainder * 10 + Number(value[index])) % divisor;
  return remainder;
}

function parsedLastModified(value: string) {
  const match = /^(\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return null;
  const yearDigits = match[1];
  if (/^0+$/.test(yearDigits) || (yearDigits.length > 4 && yearDigits.startsWith("0"))) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const leapYear = decimalModulo(yearDigits, 4) === 0
    && (decimalModulo(yearDigits, 100) !== 0 || decimalModulo(yearDigits, 400) === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return null;
  const hasTime = match[4] !== undefined;
  const hour = hasTime ? Number(match[4]) : 0;
  const minute = hasTime ? Number(match[5]) : 0;
  const second = hasTime ? Number(match[6]) : 0;
  const fraction = match[7]?.slice(1) ?? "";
  if (minute > 59 || second > 59 || hour > 24 || (hour === 24 && (minute !== 0 || second !== 0 || /[1-9]/.test(fraction)))) return null;
  if (match[8] !== undefined && match[8] !== "Z") {
    const offsetHour = Number(match[10]);
    const offsetMinute = Number(match[11]);
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute !== 0)) return null;
  }
  const normalizedYear = yearDigits.replace(/^0+/, "");
  if (normalizedYear.length > 4) return { future: true };
  const year = Number(normalizedYear);
  const timestamp = new Date(0);
  timestamp.setUTCHours(0, 0, 0, 0);
  timestamp.setUTCFullYear(year, month - 1, day);
  timestamp.setUTCHours(hour, minute, second, Number(`${fraction}000`.slice(0, 3)) || 0);
  if (!Number.isFinite(timestamp.getTime())) return null;
  let offsetMinutes = 0;
  if (match[8] !== undefined && match[8] !== "Z") {
    offsetMinutes = (Number(match[10]) * 60 + Number(match[11])) * (match[9] === "+" ? 1 : -1);
  }
  return { future: timestamp.getTime() - offsetMinutes * 60_000 > Date.now() + 24 * 60 * 60 * 1_000 };
}

function validPriority(value: string) {
  const match = /^([+-]?)(\d+(?:\.\d*)?|\.\d+)$/.exec(value);
  if (!match) return false;
  const [integerPart = "", fractionPart = ""] = match[2].split(".");
  const normalizedInteger = integerPart.replace(/^0+/, "") || "0";
  const fractionIsZero = !/[1-9]/.test(fractionPart);
  const isZero = normalizedInteger === "0" && fractionIsZero;
  if (match[1] === "-" && !isZero) return false;
  return normalizedInteger === "0" || (normalizedInteger === "1" && fractionIsZero);
}

function unsafeLocationLexeme(value: string) {
  if (value.includes("\\")) return true;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f || /\s/u.test(character)) return true;
  }
  return false;
}

function invalidIriLexeme(value: string) {
  const allowedAscii = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]$/;
  const authorityStart = value.indexOf("://") + 3;
  const authorityTail = authorityStart >= 3 ? value.slice(authorityStart).search(/[/?#]/) : -1;
  const authorityEnd = authorityTail < 0 ? value.length : authorityStart + authorityTail;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.codePointAt(index) ?? 0;
    if (value[index] === "%") {
      if (!/^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))) return true;
      index += 2;
      continue;
    }
    if ((value[index] === "[" || value[index] === "]") && !(index >= authorityStart && index < authorityEnd)) return true;
    if (codePoint <= 0x7f && !allowedAscii.test(value[index])) return true;
    if (codePoint > 0xffff) index += 1;
  }
  return false;
}

function xmlCharacterCount(value: string) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if ((value.codePointAt(index) ?? 0) > 0xffff) index += 1;
    count += 1;
  }
  return count;
}

function finalizeEntry(entry: EntryAccumulator, type: SitemapType, documentUrl: URL, seenLocations: Set<string>) {
  let validLocation = false;
  let duplicate = false;
  let outOfScope = false;
  let crossOrigin = false;
  let locationOrigin: string | null = null;
  const locationCharacters = entry.location ? xmlCharacterCount(entry.location) : 0;
  if (!entry.location) entry.issues.push("Missing required loc element.");
  else if (locationCharacters < 12 || locationCharacters >= 2_048) entry.issues.push("Location must contain from 12 through 2,047 XML characters.");
  else if (unsafeLocationLexeme(entry.location)) entry.issues.push("Location contains whitespace, a control character, or a backslash.");
  else if (invalidIriLexeme(entry.location)) entry.issues.push("Location contains a malformed percent escape or an unescaped ASCII character not allowed in a URI.");
  else {
    let parsed: URL | null = null;
    try { parsed = new URL(entry.location); } catch { entry.issues.push("Location is not an absolute URL."); }
    if (parsed) {
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
        entry.issues.push("Location must be an absolute HTTP(S) URL without credentials or a fragment.");
      } else {
        validLocation = true;
        locationOrigin = parsed.origin;
        crossOrigin = parsed.origin !== documentUrl.origin;
        if (crossOrigin) entry.issues.push("Cross-origin location requires separately verified ownership or submission context.");
        const directory = documentUrl.pathname.slice(0, documentUrl.pathname.lastIndexOf("/") + 1);
        if (!crossOrigin && !parsed.pathname.startsWith(directory)) {
          outOfScope = true;
          entry.issues.push("Location falls outside the sitemap file directory scope.");
        }
        if (seenLocations.has(parsed.href)) {
          duplicate = true;
          entry.issues.push("Duplicate location.");
        } else seenLocations.add(parsed.href);
      }
    }
  }
  let invalidLastModified = false;
  let futureLastModified = false;
  if (entry.seenFields.has("lastmod")) {
    const timestamp = entry.lastModified ? parsedLastModified(entry.lastModified) : null;
    if (timestamp === null) {
      invalidLastModified = true;
      entry.issues.push("lastmod is empty or is not a valid W3C date or date-time.");
    } else if (timestamp.future) {
      futureLastModified = true;
      entry.issues.push("lastmod is in the future.");
    }
  }
  let invalidChangeFrequency = false;
  if (type === "urlset" && entry.seenFields.has("changefreq") && (!entry.changeFrequency || !new Set(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]).has(entry.changeFrequency))) {
    invalidChangeFrequency = true;
    entry.issues.push("changefreq is not a protocol value.");
  }
  let invalidPriority = false;
  if (type === "urlset" && entry.seenFields.has("priority") && (!entry.priority || !validPriority(entry.priority))) {
    invalidPriority = true;
    entry.issues.push("priority must be a decimal from 0.0 through 1.0.");
  }
  return {
    preview: {
      location: entry.location,
      lastModified: entry.lastModified,
      ...(type === "urlset" ? { changeFrequency: entry.changeFrequency, priority: entry.priority } : {}),
      issues: entry.issues,
    } satisfies SitemapPreviewEntry,
    validLocation,
    duplicate,
    outOfScope,
    crossOrigin,
    locationOrigin,
    invalidLastModified,
    futureLastModified,
    invalidChangeFrequency,
    invalidPriority,
  };
}

export async function parseSitemapDocument(
  body: Uint8Array,
  documentUrl: string,
  context: { signal: AbortSignal; deadlineMilliseconds: number },
): Promise<ParsedSitemap> {
  if (body.byteLength > SITEMAP_VALIDATOR_LIMITS.maximumDecodedBytes) throw new SecureHtmlFetchError("response_too_large");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(body); } catch { throw new SecureHtmlFetchError("unsupported_content"); }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  preflightXmlTokens(text, context);

  const target = new URL(documentUrl);
  const seenLocations = new Set<string>();
  const locationOrigins = new Set<string>();
  const previewEntries: SitemapPreviewEntry[] = [];
  let root: SitemapType | null = null;
  let rootNamespace = "";
  let depth = 0;
  let ignoredDepth: number | null = null;
  let currentEntry: EntryAccumulator | null = null;
  let captureField: FieldName | null = null;
  let captureText = "";
  let elementCount = 0;
  let entryCount = 0;
  let validLocationCount = 0;
  let invalidLocationCount = 0;
  let duplicateLocationCount = 0;
  let duplicateCoreFieldCount = 0;
  let outOfOrderCoreFieldCount = 0;
  let lastModifiedCount = 0;
  let changeFrequencyCount = 0;
  let priorityCount = 0;
  let invalidLastModifiedCount = 0;
  let futureLastModifiedCount = 0;
  let invalidChangeFrequencyCount = 0;
  let invalidPriorityCount = 0;
  let outOfScopeCount = 0;
  let crossOriginCount = 0;
  let unknownCoreElementCount = 0;
  let unknownCoreAttributeCount = 0;
  let extensionElementCount = 0;
  let invalidExtensionPlacementCount = 0;
  let rootEntrySeen = false;
  let parserError: SecureHtmlFetchError | null = null;

  const fail = (error: SecureHtmlFetchError = new SecureHtmlFetchError("invalid_document")): never => {
    parserError = error;
    throw error;
  };
  const appendText = (value: string) => {
    if (!value || ignoredDepth !== null) return;
    if (!captureField) {
      if (hasNonXmlWhitespace(value)) fail();
      return;
    }
    captureText += value;
    if (captureText.length > SITEMAP_VALIDATOR_LIMITS.maximumFieldCharacters) fail();
  };
  const parser = new SaxesParser({ xmlns: true, position: true });
  parser.on("error", () => fail());
  parser.on("doctype", () => fail());
  parser.on("xmldecl", (declaration) => {
    if (declaration.version !== "1.0" || (declaration.encoding && declaration.encoding.toLowerCase() !== "utf-8")) fail();
  });
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("opentag", (tag: SaxesTagNS) => {
    ensureBudget(context.signal, context.deadlineMilliseconds);
    elementCount += 1;
    depth += 1;
    if (
      elementCount > SITEMAP_VALIDATOR_LIMITS.maximumElements
      || depth > SITEMAP_VALIDATOR_LIMITS.maximumDepth
      || Object.keys(tag.attributes).length > SITEMAP_VALIDATOR_LIMITS.maximumAttributesPerElement
    ) fail(new SecureHtmlFetchError("analysis_too_complex"));
    if (ignoredDepth !== null) return;
    if (depth === 1) {
      if (root || (tag.local !== "urlset" && tag.local !== "sitemapindex")) fail();
      root = tag.local;
      rootNamespace = tag.uri;
      unknownCoreAttributeCount += unexpectedCoreAttributes(tag, true);
      return;
    }
    const core = tag.uri === rootNamespace;
    if (depth === 2) {
      const entryName = root === "urlset" ? "url" : "sitemap";
      if (core && tag.local === entryName) {
        rootEntrySeen = true;
        currentEntry = emptyEntry();
      }
      else {
        if (core) unknownCoreElementCount += 1;
        else {
          extensionElementCount += 1;
          if (rootEntrySeen) invalidExtensionPlacementCount += 1;
        }
        ignoredDepth = depth;
      }
      if (core) unknownCoreAttributeCount += unexpectedCoreAttributes(tag, false);
      return;
    }
    if (depth === 3 && currentEntry) {
      const fields = root === "urlset"
        ? new Set(["loc", "lastmod", "changefreq", "priority"])
        : new Set(["loc", "lastmod"]);
      if (core && fields.has(tag.local)) {
        if (captureField) fail();
        captureField = tag.local as FieldName;
        captureText = "";
        const order = ["loc", "lastmod", "changefreq", "priority"].indexOf(tag.local);
        if (order < currentEntry.lastCoreOrder || currentEntry.extensionsStarted) {
          outOfOrderCoreFieldCount += 1;
          currentEntry.issues.push(`${tag.local} is out of protocol order.`);
        }
        currentEntry.lastCoreOrder = Math.max(currentEntry.lastCoreOrder, order);
      } else {
        if (core) unknownCoreElementCount += 1;
        else {
          extensionElementCount += 1;
          currentEntry.extensionsStarted = true;
        }
        ignoredDepth = depth;
      }
      if (core) unknownCoreAttributeCount += unexpectedCoreAttributes(tag, false);
    } else if (captureField) fail();
  });
  parser.on("closetag", (tag: SaxesTagNS) => {
    ensureBudget(context.signal, context.deadlineMilliseconds);
    if (ignoredDepth === null && captureField && depth === 3 && tag.local === captureField && currentEntry) {
      const value = captureField === "changefreq" ? captureText : trimXmlWhitespace(captureText);
      if (currentEntry.seenFields.has(captureField)) {
        duplicateCoreFieldCount += 1;
        currentEntry.issues.push(`Duplicate ${captureField} element.`);
      }
      currentEntry.seenFields.add(captureField);
      if (captureField === "loc") currentEntry.location = value || null;
      if (captureField === "lastmod") currentEntry.lastModified = value || null;
      if (captureField === "changefreq") currentEntry.changeFrequency = value || null;
      if (captureField === "priority") currentEntry.priority = value || null;
      captureField = null;
      captureText = "";
    } else if (ignoredDepth === null && currentEntry && depth === 2) {
      entryCount += 1;
      if (entryCount > SITEMAP_VALIDATOR_LIMITS.maximumEntriesToCount) fail(new SecureHtmlFetchError("analysis_too_complex"));
      const outcome = finalizeEntry(currentEntry, root!, target, seenLocations);
      if (outcome.validLocation) validLocationCount += 1;
      else invalidLocationCount += 1;
      if (outcome.duplicate) duplicateLocationCount += 1;
      if (outcome.outOfScope) outOfScopeCount += 1;
      if (outcome.crossOrigin) crossOriginCount += 1;
      if (outcome.locationOrigin) locationOrigins.add(outcome.locationOrigin);
      if (currentEntry.seenFields.has("lastmod")) lastModifiedCount += 1;
      if (currentEntry.seenFields.has("changefreq")) changeFrequencyCount += 1;
      if (currentEntry.seenFields.has("priority")) priorityCount += 1;
      if (outcome.invalidLastModified) invalidLastModifiedCount += 1;
      if (outcome.futureLastModified) futureLastModifiedCount += 1;
      if (outcome.invalidChangeFrequency) invalidChangeFrequencyCount += 1;
      if (outcome.invalidPriority) invalidPriorityCount += 1;
      if (previewEntries.length < SITEMAP_VALIDATOR_LIMITS.maximumPreviewEntries) previewEntries.push(outcome.preview);
      currentEntry = null;
    }
    if (ignoredDepth === depth) ignoredDepth = null;
    depth -= 1;
  });

  try {
    for (let offset = 0; offset < text.length; offset += SITEMAP_VALIDATOR_LIMITS.parserChunkCharacters) {
      ensureBudget(context.signal, context.deadlineMilliseconds);
      parser.write(text.slice(offset, offset + SITEMAP_VALIDATOR_LIMITS.parserChunkCharacters));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    parser.close();
  } catch (error) {
    if (error instanceof SecureHtmlFetchError) throw error;
    if (parserError) throw parserError;
    throw new SecureHtmlFetchError("invalid_document");
  }
  ensureBudget(context.signal, context.deadlineMilliseconds);
  if (!root || depth !== 0 || currentEntry || captureField || ignoredDepth !== null) invalidDocument();
  return {
    type: root,
    namespace: rootNamespace,
    entryCount,
    validLocationCount,
    invalidLocationCount,
    duplicateLocationCount,
    duplicateCoreFieldCount,
    outOfOrderCoreFieldCount,
    lastModifiedCount,
    changeFrequencyCount,
    priorityCount,
    previewEntries,
    invalidLastModifiedCount,
    futureLastModifiedCount,
    invalidChangeFrequencyCount,
    invalidPriorityCount,
    outOfScopeCount,
    crossOriginCount,
    locationOriginCount: locationOrigins.size,
    unknownCoreElementCount,
    unknownCoreAttributeCount,
    extensionElementCount,
    invalidExtensionPlacementCount,
  };
}

export function sitemapChecks(parsed: ParsedSitemap, decodedBytes: number) {
  const checks: ValidatorCheck[] = [
    parsed.namespace === SITEMAP_NAMESPACE
      ? { id: "sitemap-namespace", category: "pass", label: "Sitemap namespace", message: "The root uses the Sitemap protocol namespace." }
      : { id: "sitemap-namespace", category: "error", label: "Sitemap namespace", message: parsed.namespace ? "The root namespace is not the Sitemap protocol namespace." : "The root is missing the required Sitemap protocol namespace." },
    parsed.entryCount
      ? {
        id: "sitemap-entries",
        category: parsed.entryCount > SITEMAP_VALIDATOR_LIMITS.protocolMaximumEntries ? "error" : "pass",
        label: "Entry count",
        message: parsed.entryCount > SITEMAP_VALIDATOR_LIMITS.protocolMaximumEntries
          ? `The document exceeds the protocol maximum of ${SITEMAP_VALIDATOR_LIMITS.protocolMaximumEntries.toLocaleString("en-US")} entries.`
          : `${parsed.entryCount.toLocaleString("en-US")} ${parsed.type === "urlset" ? "URL" : "child sitemap"} entr${parsed.entryCount === 1 ? "y" : "ies"} found.`,
      }
      : { id: "sitemap-entries", category: "error", label: "No entries", message: `The ${parsed.type} contains no entries, but the protocol schema requires at least one.` },
    parsed.invalidLocationCount
      ? { id: "sitemap-locations", category: "error", label: "Invalid locations", message: `${parsed.invalidLocationCount} entr${parsed.invalidLocationCount === 1 ? "y has" : "ies have"} a missing or invalid location.` }
      : { id: "sitemap-locations", category: "pass", label: "Entry locations", message: "Every entry has an absolute HTTP(S) location." },
    { id: "sitemap-safe-size", category: "pass", label: "Safe scan size", message: `The ${decodedBytes.toLocaleString("en-US")}-byte uncompressed document is within this tool's 2 MiB safety limit.` },
  ];
  if (parsed.duplicateCoreFieldCount) checks.push({ id: "sitemap-duplicate-fields", category: "error", label: "Duplicate core fields", message: `${parsed.duplicateCoreFieldCount} duplicate core field${parsed.duplicateCoreFieldCount === 1 ? " was" : "s were"} found.` });
  if (parsed.outOfOrderCoreFieldCount) checks.push({ id: "sitemap-field-order", category: "error", label: "Core field order", message: `${parsed.outOfOrderCoreFieldCount} core field${parsed.outOfOrderCoreFieldCount === 1 ? " is" : "s are"} outside the protocol sequence.` });
  if (parsed.locationOriginCount > 1) {
    checks.push({ id: "sitemap-single-host", category: "error", label: "Multiple location hosts", message: `The base Sitemap protocol requires one host per file, but entries span ${parsed.locationOriginCount} origins.` });
    checks.push({ id: "sitemap-cross-site-ownership", category: "unverifiable", label: "Cross-site submission context", message: "Google documents cross-site submission when every site is verified; this tool cannot verify that ownership context." });
  } else if (parsed.crossOriginCount) checks.push({ id: "sitemap-cross-origin", category: "unverifiable", label: "Cross-origin submission context", message: `${parsed.crossOriginCount} location${parsed.crossOriginCount === 1 ? " is" : "s are"} cross-origin. This can be valid with verified ownership, which this tool cannot confirm.` });
  if (parsed.duplicateLocationCount) checks.push({ id: "sitemap-duplicates", category: "warning", label: "Duplicate locations", message: `${parsed.duplicateLocationCount} duplicate location${parsed.duplicateLocationCount === 1 ? " was" : "s were"} found.` });
  if (parsed.invalidLastModifiedCount) checks.push({ id: "sitemap-lastmod", category: "error", label: "Invalid lastmod values", message: `${parsed.invalidLastModifiedCount} lastmod value${parsed.invalidLastModifiedCount === 1 ? " is" : "s are"} not a valid W3C date or date-time.` });
  if (parsed.futureLastModifiedCount) checks.push({ id: "sitemap-future-lastmod", category: "warning", label: "Future lastmod values", message: `${parsed.futureLastModifiedCount} lastmod value${parsed.futureLastModifiedCount === 1 ? " is" : "s are"} in the future.` });
  if (parsed.invalidChangeFrequencyCount) checks.push({ id: "sitemap-changefreq", category: "error", label: "Invalid changefreq values", message: `${parsed.invalidChangeFrequencyCount} changefreq value${parsed.invalidChangeFrequencyCount === 1 ? " is" : "s are"} outside the protocol vocabulary.` });
  if (parsed.invalidPriorityCount) checks.push({ id: "sitemap-priority", category: "error", label: "Invalid priority values", message: `${parsed.invalidPriorityCount} priority value${parsed.invalidPriorityCount === 1 ? " is" : "s are"} outside 0.0 through 1.0.` });
  if (parsed.changeFrequencyCount || parsed.priorityCount) checks.push({ id: "sitemap-google-hints", category: "crawler_specific", label: "Google ignores changefreq and priority", message: "These protocol fields may be used elsewhere, but Google says it ignores changefreq and priority values." });
  if (parsed.outOfScopeCount) {
    checks.push({ id: "sitemap-directory-scope", category: "error", label: "Directory scope", message: `${parsed.outOfScopeCount} URL${parsed.outOfScopeCount === 1 ? " falls" : "s fall"} outside the sitemap file's directory under the base Sitemap protocol.` });
    checks.push({ id: "sitemap-search-console-scope", category: "unverifiable", label: "Search Console submission context", message: "Google documents broader scope for sitemaps submitted through Search Console; this tool cannot verify that submission context." });
  }
  if (parsed.unknownCoreElementCount) checks.push({ id: "sitemap-unknown-core", category: "error", label: "Unknown core elements", message: `${parsed.unknownCoreElementCount} unrecognized core-namespace element${parsed.unknownCoreElementCount === 1 ? " was" : "s were"} found.` });
  if (parsed.unknownCoreAttributeCount) checks.push({ id: "sitemap-core-attributes", category: "error", label: "Unexpected core attributes", message: `${parsed.unknownCoreAttributeCount} attribute${parsed.unknownCoreAttributeCount === 1 ? " is" : "s are"} not allowed on a core Sitemap element.` });
  if (parsed.invalidExtensionPlacementCount) checks.push({ id: "sitemap-extension-placement", category: "error", label: "Extension placement", message: `${parsed.invalidExtensionPlacementCount} root extension element${parsed.invalidExtensionPlacementCount === 1 ? " appears" : "s appear"} after entries, which violates the Sitemap schema sequence.` });
  if (parsed.extensionElementCount) checks.push({ id: "sitemap-extensions", category: "information", label: "Sitemap extensions", message: `${parsed.extensionElementCount} foreign-namespace extension element${parsed.extensionElementCount === 1 ? " was" : "s were"} structurally checked but not interpreted.` });
  if (parsed.entryCount > SITEMAP_VALIDATOR_LIMITS.maximumPreviewEntries) checks.push({ id: "sitemap-preview-limit", category: "tool_limit", label: "Entry preview limited", message: `Every accepted entry was checked, but only the first ${SITEMAP_VALIDATOR_LIMITS.maximumPreviewEntries} are returned for display.` });
  checks.push({ id: "sitemap-target-fetch", category: "unverifiable", label: "Listed targets not fetched", message: parsed.type === "urlset" ? "This check does not fetch listed pages, so their live status and canonicalization are not verified." : "This check does not fetch child sitemaps, so their availability and contents are not verified." });
  return checks;
}
