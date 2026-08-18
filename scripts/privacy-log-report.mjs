#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { createGunzip } from "node:zlib";

const SITE = "webtaskkit.com";
const MAX_INPUTS_PER_KIND = 32;
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_LINE_BYTES = 4 * 1024;
const MAX_RECORDS = 1_000_000;
const MAX_WINDOW_MILLISECONDS = 31 * 24 * 60 * 60 * 1_000;
const MAX_RESPONSE_BYTES = 1_000_000_000;
const MAX_DURATION_SECONDS = 3_600;

const ACCESS_METHODS = ["GET", "HEAD", "POST", "OPTIONS", "OTHER"];
const ACCESS_PATHS = [
  "/", "/about", "/privacy", "/generators", "/generators/qr-code",
  "/generators/barcode", "/generators/tone", "/converters",
  "/converters/txt-to-pdf", "/converters/image-to-pdf", "/editors", "/editors/svg", "/editors/text",
  "/robots.txt", "/sitemap.xml", "/_other",
];
const EVENT_NAMES = [
  "tool_started", "tool_completed", "output_action", "validation_error",
];
const EVENT_PATHS = [
  "/generators/qr-code", "/generators/barcode", "/generators/tone",
  "/converters/txt-to-pdf", "/converters/image-to-pdf", "/editors/svg", "/editors/text",
];
const STATUS_CLASSES = ["1xx", "2xx", "3xx", "4xx", "5xx"];

const accessMethodSet = new Set(ACCESS_METHODS);
const accessPathSet = new Set(ACCESS_PATHS);
const eventNameSet = new Set(EVENT_NAMES);
const eventPathSet = new Set(EVENT_PATHS);
const timestampPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const decimalSecondsPattern = "(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?";
const upstreamSecondsPattern = new RegExp(
  `^(?:-|${decimalSecondsPattern})(?: *(?:,|:) *(?:-|${decimalSecondsPattern}))*$`,
);

class PrivacyLogError extends Error {
  constructor(message) {
    super(message);
    this.name = "PrivacyLogError";
  }
}

function objectWithZeros(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function parseTimestamp(value, label) {
  if (typeof value !== "string") {
    throw new PrivacyLogError(`${label} must be an ISO-8601 timestamp with a timezone.`);
  }
  const match = timestampPattern.exec(value);
  if (!match) {
    throw new PrivacyLogError(`${label} must be an ISO-8601 timestamp with a timezone.`);
  }

  const [
    , yearText, monthText, dayText, hourText, minuteText, secondText,
    fraction = "", zone, sign, offsetHourText, offsetMinuteText,
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, "0"));
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);

  if (month < 1 || month > 12
    || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59
    || offsetHour > 14 || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)) {
    throw new PrivacyLogError(`${label} is not a valid calendar timestamp.`);
  }

  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, millisecond);
  if (local.getUTCFullYear() !== year
    || local.getUTCMonth() !== month - 1
    || local.getUTCDate() !== day
    || local.getUTCHours() !== hour
    || local.getUTCMinutes() !== minute
    || local.getUTCSeconds() !== second
    || local.getUTCMilliseconds() !== millisecond) {
    throw new PrivacyLogError(`${label} is not a valid calendar timestamp.`);
  }

  const offsetDirection = sign === "-" ? 1 : -1;
  const milliseconds = local.getTime()
    + offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  if (!Number.isFinite(milliseconds)) {
    throw new PrivacyLogError(`${label} is not a valid calendar timestamp.`);
  }
  return milliseconds;
}

function parseUpstreamSeconds(value) {
  if (value === "") return null;
  if (typeof value !== "string" || !upstreamSecondsPattern.test(value)) return undefined;
  let total = 0;
  let numericParts = 0;
  for (const part of value.split(/ *(?:,|:) */)) {
    if (part === "-") continue;
    const seconds = Number(part);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > MAX_DURATION_SECONDS) {
      return undefined;
    }
    total += seconds;
    numericParts += 1;
    if (!Number.isFinite(total) || total > MAX_DURATION_SECONDS) return undefined;
  }
  return numericParts === 0 ? null : round(total);
}

function validateAccessRecord(value) {
  const fields = [
    "timestamp", "site", "method", "path", "status", "bytes",
    "request_seconds", "upstream_seconds",
  ];
  if (!exactKeys(value, fields) || value.site !== SITE) return null;
  if (!accessMethodSet.has(value.method) || !accessPathSet.has(value.path)) return null;
  if (!Number.isInteger(value.status) || value.status < 100 || value.status > 599) return null;
  if (!Number.isSafeInteger(value.bytes)
    || value.bytes < 0
    || value.bytes > MAX_RESPONSE_BYTES) return null;
  if (typeof value.request_seconds !== "number"
    || !Number.isFinite(value.request_seconds)
    || value.request_seconds < 0
    || value.request_seconds > MAX_DURATION_SECONDS) return null;
  const upstreamSeconds = parseUpstreamSeconds(value.upstream_seconds);
  if (upstreamSeconds === undefined) return null;
  try {
    return {
      ...value,
      timestamp: parseTimestamp(value.timestamp, "Record timestamp"),
      upstream_seconds: upstreamSeconds,
    };
  } catch {
    return null;
  }
}

function validateEventRecord(value) {
  if (!exactKeys(value, ["timestamp", "site", "event", "path"])) return null;
  if (value.site !== SITE || !eventNameSet.has(value.event) || !eventPathSet.has(value.path)) return null;
  try {
    return { ...value, timestamp: parseTimestamp(value.timestamp, "Record timestamp") };
  } catch {
    return null;
  }
}

function round(value) {
  return Number(value.toFixed(6));
}

function ratio(numerator, denominator) {
  return denominator === 0 ? null : round(numerator / denominator);
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  return round(sortedValues[Math.max(0, Math.ceil(sortedValues.length * fraction) - 1)]);
}

function createState() {
  const eventByPath = {};
  for (const path of EVENT_PATHS) eventByPath[path] = objectWithZeros(EVENT_NAMES);
  return {
    recordsSeen: 0,
    inputs: {
      valid_access_lines: 0,
      valid_event_lines: 0,
      included_access_lines: 0,
      included_event_lines: 0,
      out_of_window_lines: 0,
      rejected_lines: 0,
    },
    access: {
      requests: 0,
      by_method: objectWithZeros(ACCESS_METHODS),
      by_status_class: objectWithZeros(STATUS_CLASSES),
      by_path: objectWithZeros(ACCESS_PATHS),
      serverErrors: 0,
      requestSeconds: [],
      upstreamSeconds: [],
      upstreamMissing: 0,
    },
    events: {
      total: 0,
      by_event: objectWithZeros(EVENT_NAMES),
      by_path: eventByPath,
    },
  };
}

async function* readLines(stream, kind, inputIndex) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  let uncompressedBytes = 0;
  let lineNumber = 0;

  for await (const chunk of stream) {
    uncompressedBytes += chunk.length;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new PrivacyLogError(`${kind} input ${inputIndex} exceeds the uncompressed size limit.`);
    }
    try {
      buffered += decoder.decode(chunk, { stream: true });
    } catch {
      throw new PrivacyLogError(`${kind} input ${inputIndex} is not valid UTF-8.`);
    }

    let newlineIndex = buffered.indexOf("\n");
    while (newlineIndex !== -1) {
      let line = buffered.slice(0, newlineIndex);
      buffered = buffered.slice(newlineIndex + 1);
      lineNumber += 1;
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length === 0 || Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) {
        throw new PrivacyLogError(`${kind} input ${inputIndex} contains an invalid record at line ${lineNumber}.`);
      }
      yield { line, lineNumber };
      newlineIndex = buffered.indexOf("\n");
    }

    if (Buffer.byteLength(buffered, "utf8") > MAX_LINE_BYTES) {
      throw new PrivacyLogError(`${kind} input ${inputIndex} contains an invalid record at line ${lineNumber + 1}.`);
    }
  }

  try {
    buffered += decoder.decode();
  } catch {
    throw new PrivacyLogError(`${kind} input ${inputIndex} is not valid UTF-8.`);
  }
  if (buffered.length > 0) {
    lineNumber += 1;
    if (buffered.endsWith("\r")) buffered = buffered.slice(0, -1);
    if (buffered.length === 0 || Buffer.byteLength(buffered, "utf8") > MAX_LINE_BYTES) {
      throw new PrivacyLogError(`${kind} input ${inputIndex} contains an invalid record at line ${lineNumber}.`);
    }
    yield { line: buffered, lineNumber };
  }
}

async function consumeFile(input, kind, inputIndex, window, state) {
  const source = input.size === 0
    ? Readable.from([])
    : createReadStream(input.path, { start: 0, end: input.size - 1 });
  const output = new PassThrough();
  let transferFailure = null;
  const transfer = (input.path.toLowerCase().endsWith(".gz")
    ? pipeline(source, createGunzip(), output)
    : pipeline(source, output)).catch((error) => {
    transferFailure = error;
    output.destroy();
  });
  try {
    for await (const { line, lineNumber } of readLines(output, kind, inputIndex)) {
      state.recordsSeen += 1;
      if (state.recordsSeen > MAX_RECORDS) {
        throw new PrivacyLogError("The combined record limit was exceeded.");
      }
      let decoded;
      try {
        decoded = JSON.parse(line);
      } catch {
        throw new PrivacyLogError(`${kind} input ${inputIndex} contains an invalid record at line ${lineNumber}.`);
      }
      const record = kind === "Access" ? validateAccessRecord(decoded) : validateEventRecord(decoded);
      if (!record) {
        throw new PrivacyLogError(`${kind} input ${inputIndex} contains an invalid record at line ${lineNumber}.`);
      }

      if (kind === "Access") state.inputs.valid_access_lines += 1;
      else state.inputs.valid_event_lines += 1;
      if (record.timestamp < window.since || record.timestamp >= window.until) {
        state.inputs.out_of_window_lines += 1;
        continue;
      }

      if (kind === "Access") {
        state.inputs.included_access_lines += 1;
        state.access.requests += 1;
        state.access.by_method[record.method] += 1;
        state.access.by_path[record.path] += 1;
        state.access.by_status_class[`${Math.floor(record.status / 100)}xx`] += 1;
        if (record.status >= 500) state.access.serverErrors += 1;
        state.access.requestSeconds.push(record.request_seconds);
        if (record.upstream_seconds === null) state.access.upstreamMissing += 1;
        else state.access.upstreamSeconds.push(record.upstream_seconds);
      } else {
        state.inputs.included_event_lines += 1;
        state.events.total += 1;
        state.events.by_event[record.event] += 1;
        state.events.by_path[record.path][record.event] += 1;
      }
    }
    await transfer;
    if (transferFailure) throw transferFailure;
  } catch (error) {
    if (error instanceof PrivacyLogError) throw error;
    throw new PrivacyLogError(`${kind} input ${inputIndex} could not be read.`);
  } finally {
    output.destroy();
    source.destroy();
    await transfer;
  }
}

function parseBoundary(value, label) {
  return parseTimestamp(value, label);
}

function validateInputs(accessFiles, eventFiles) {
  if (!Array.isArray(accessFiles) || accessFiles.length === 0) {
    throw new PrivacyLogError("At least one access input is required.");
  }
  if (!Array.isArray(eventFiles) || eventFiles.length === 0) {
    throw new PrivacyLogError("At least one event input is required.");
  }
  if (accessFiles.length > MAX_INPUTS_PER_KIND || eventFiles.length > MAX_INPUTS_PER_KIND) {
    throw new PrivacyLogError(`No more than ${MAX_INPUTS_PER_KIND} inputs per log type are allowed.`);
  }
  if (![...accessFiles, ...eventFiles].every((value) => typeof value === "string" && value.length > 0)) {
    throw new PrivacyLogError("Every input must be a file path.");
  }
  const resolved = [...accessFiles, ...eventFiles].map((filename) => resolve(filename));
  if (new Set(resolved).size !== resolved.length) {
    throw new PrivacyLogError("Each input file must be listed exactly once.");
  }
}

async function canonicalizeInputs(accessFiles, eventFiles) {
  const physicalPaths = new Set();
  const physicalIdentities = new Set();

  async function inspect(files, kind) {
    const inspected = [];
    for (const [index, filename] of files.entries()) {
      let canonicalPath;
      let metadata;
      try {
        canonicalPath = await realpath(resolve(filename));
        metadata = await stat(canonicalPath);
      } catch {
        throw new PrivacyLogError(`${kind} input ${index + 1} could not be read.`);
      }
      if (!metadata.isFile()) {
        throw new PrivacyLogError(`${kind} input ${index + 1} is not a regular file.`);
      }
      if (metadata.size > MAX_COMPRESSED_BYTES) {
        throw new PrivacyLogError(`${kind} input ${index + 1} exceeds the file-size limit.`);
      }

      const identity = `${metadata.dev}:${metadata.ino}`;
      if (physicalPaths.has(canonicalPath) || physicalIdentities.has(identity)) {
        throw new PrivacyLogError("Every input must refer to a distinct physical file.");
      }
      physicalPaths.add(canonicalPath);
      physicalIdentities.add(identity);
      inspected.push({ path: canonicalPath, size: metadata.size });
    }
    return inspected;
  }

  return {
    access: await inspect(accessFiles, "Access"),
    events: await inspect(eventFiles, "Event"),
  };
}

export async function buildPrivacyLogReport({ accessFiles, eventFiles, since, until }) {
  validateInputs(accessFiles, eventFiles);
  const sinceMilliseconds = parseBoundary(since, "--since");
  const untilMilliseconds = parseBoundary(until, "--until");
  if (sinceMilliseconds >= untilMilliseconds) throw new PrivacyLogError("--since must be earlier than --until.");
  if (untilMilliseconds - sinceMilliseconds > MAX_WINDOW_MILLISECONDS) {
    throw new PrivacyLogError("The reporting window cannot exceed 31 days.");
  }
  const inputs = await canonicalizeInputs(accessFiles, eventFiles);

  const state = createState();
  const window = { since: sinceMilliseconds, until: untilMilliseconds };
  for (const [index, input] of inputs.access.entries()) {
    await consumeFile(input, "Access", index + 1, window, state);
  }
  for (const [index, input] of inputs.events.entries()) {
    await consumeFile(input, "Event", index + 1, window, state);
  }

  state.access.requestSeconds.sort((left, right) => left - right);
  state.access.upstreamSeconds.sort((left, right) => left - right);
  const eventCountRatiosByPath = {};
  for (const path of EVENT_PATHS) {
    const started = state.events.by_path[path].tool_started;
    const completed = state.events.by_path[path].tool_completed;
    eventCountRatiosByPath[path] = {
      tool_started: started,
      tool_completed: completed,
      tool_completed_per_tool_started: ratio(completed, started),
    };
  }

  return {
    schema_version: 1,
    site: SITE,
    window: {
      since: new Date(sinceMilliseconds).toISOString(),
      until: new Date(untilMilliseconds).toISOString(),
      semantics: "since-inclusive, until-exclusive",
    },
    notices: [
      "Request counts are aggregate requests, not users, visitors, or visits.",
      "Event ratios compare unpaired aggregate event counts; they are not user- or session-level conversion rates.",
    ],
    inputs: {
      access_files: accessFiles.length,
      event_files: eventFiles.length,
      snapshot: "File sizes are captured before reading; bytes appended later are excluded.",
      ...state.inputs,
    },
    access: {
      requests: state.access.requests,
      by_method: state.access.by_method,
      by_status_class: state.access.by_status_class,
      by_path: state.access.by_path,
      server_errors_5xx: {
        count: state.access.serverErrors,
        per_request: ratio(state.access.serverErrors, state.access.requests),
      },
      request_seconds: {
        samples: state.access.requestSeconds.length,
        p50: percentile(state.access.requestSeconds, 0.5),
        p95: percentile(state.access.requestSeconds, 0.95),
        maximum: state.access.requestSeconds.length === 0 ? null : round(state.access.requestSeconds.at(-1)),
      },
      upstream_seconds: {
        semantics: "Per request, numeric comma/colon-separated upstream attempts are summed; empty or dash-only values are missing.",
        samples: state.access.upstreamSeconds.length,
        missing: state.access.upstreamMissing,
        p50: percentile(state.access.upstreamSeconds, 0.5),
        p95: percentile(state.access.upstreamSeconds, 0.95),
        maximum: state.access.upstreamSeconds.length === 0
          ? null
          : round(state.access.upstreamSeconds.at(-1)),
      },
    },
    events: {
      total: state.events.total,
      by_event: state.events.by_event,
      by_path: state.events.by_path,
      unpaired_event_count_ratios: {
        overall: {
          tool_started: state.events.by_event.tool_started,
          tool_completed: state.events.by_event.tool_completed,
          tool_completed_per_tool_started: ratio(
            state.events.by_event.tool_completed,
            state.events.by_event.tool_started,
          ),
        },
        by_path: eventCountRatiosByPath,
      },
    },
  };
}

export function formatPrivacyLogReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function parseArguments(argv) {
  const options = { accessFiles: [], eventFiles: [], since: null, until: null };
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (!["--access", "--events", "--since", "--until"].includes(argument) || value === undefined) {
      throw new PrivacyLogError("Usage: privacy-log-report --since <ISO> --until <ISO> --access <file> --events <file> [more inputs].");
    }
    if (argument === "--access") options.accessFiles.push(value);
    if (argument === "--events") options.eventFiles.push(value);
    if (argument === "--since") {
      if (options.since !== null) throw new PrivacyLogError("--since may be provided only once.");
      options.since = value;
    }
    if (argument === "--until") {
      if (options.until !== null) throw new PrivacyLogError("--until may be provided only once.");
      options.until = value;
    }
  }
  if (options.since === null || options.until === null) {
    throw new PrivacyLogError("Both --since and --until are required.");
  }
  return options;
}

async function main() {
  try {
    const report = await buildPrivacyLogReport(parseArguments(process.argv.slice(2)));
    process.stdout.write(formatPrivacyLogReport(report));
  } catch (error) {
    const message = error instanceof PrivacyLogError ? error.message : "The privacy log report could not be created.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

const isDirectExecution = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isDirectExecution) await main();
