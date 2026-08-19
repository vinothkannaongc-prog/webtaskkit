import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { link, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import {
  buildPrivacyLogReport,
  formatPrivacyLogReport,
} from "../scripts/privacy-log-report.mjs";

const SINCE = "2026-08-14T09:48:22Z";
const UNTIL = "2026-08-15T09:48:22Z";
const execFileAsync = promisify(execFile);
const reporterPath = fileURLToPath(new URL("../scripts/privacy-log-report.mjs", import.meta.url));

function access(overrides = {}) {
  return {
    timestamp: SINCE,
    site: "webtaskkit.com",
    method: "GET",
    path: "/generators/qr-code",
    status: 200,
    bytes: 1234,
    request_seconds: 0.04,
    upstream_seconds: "0.039",
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    timestamp: SINCE,
    site: "webtaskkit.com",
    event: "tool_started",
    path: "/generators/qr-code",
    ...overrides,
  };
}

async function fixtureDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "webtaskkit-privacy-report-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeJsonl(filename, records, gzip = false) {
  const body = records
    .map((record) => typeof record === "string" ? record : JSON.stringify(record))
    .join("\n");
  const content = `${body}${body ? "\n" : ""}`;
  await writeFile(filename, gzip ? gzipSync(content) : content);
}

test("aggregates bounded plain and gzipped logs deterministically", async (t) => {
  const directory = await fixtureDirectory(t);
  const accessPlain = join(directory, "access.jsonl");
  const accessGzip = join(directory, "access.jsonl-20260814.gz");
  const eventsPlain = join(directory, "events.jsonl");
  const eventsGzip = join(directory, "events.jsonl-20260814.gz");

  await writeJsonl(accessPlain, [
    access({ timestamp: "2026-08-14T09:48:21Z", path: "/" }),
    access({ upstream_seconds: "" }),
    access({ timestamp: UNTIL, path: "/about" }),
  ]);
  await writeJsonl(accessGzip, [
    access({
      timestamp: "2026-08-15T09:48:21.999Z",
      method: "HEAD",
      status: 503,
      request_seconds: 1.2,
      upstream_seconds: "0.4, 0.3: 0.2",
    }),
  ], true);
  await writeJsonl(eventsPlain, [
    event(),
    event({ event: "tool_completed" }),
    event({ event: "output_action" }),
  ]);
  await writeJsonl(eventsGzip, [
    event({ timestamp: "2026-08-14T09:48:21.999Z", path: "/editors/text" }),
    event({ timestamp: UNTIL, event: "validation_error" }),
  ], true);

  const options = {
    accessFiles: [accessPlain, accessGzip],
    eventFiles: [eventsPlain, eventsGzip],
    since: SINCE,
    until: UNTIL,
  };
  const report = await buildPrivacyLogReport(options);

  assert.equal(report.site, "webtaskkit.com");
  assert.deepEqual(report.window, {
    since: "2026-08-14T09:48:22.000Z",
    until: "2026-08-15T09:48:22.000Z",
    semantics: "since-inclusive, until-exclusive",
  });
  assert.deepEqual(report.inputs, {
    access_files: 2,
    event_files: 2,
    snapshot: "File sizes are captured before reading; bytes appended later are excluded.",
    valid_access_lines: 4,
    valid_event_lines: 5,
    included_access_lines: 2,
    included_event_lines: 3,
    out_of_window_lines: 4,
    rejected_lines: 0,
  });
  assert.equal(report.access.requests, 2);
  assert.equal(report.access.by_method.GET, 1);
  assert.equal(report.access.by_method.HEAD, 1);
  assert.equal(report.access.by_status_class["2xx"], 1);
  assert.equal(report.access.by_status_class["5xx"], 1);
  assert.deepEqual(report.access.server_errors_5xx, { count: 1, per_request: 0.5 });
  assert.deepEqual(report.access.request_seconds, {
    samples: 2,
    p50: 0.04,
    p95: 1.2,
    maximum: 1.2,
  });
  assert.deepEqual(report.access.upstream_seconds, {
    semantics: "Per request, numeric comma/colon-separated upstream attempts are summed; empty or dash-only values are missing.",
    samples: 1,
    missing: 1,
    p50: 0.9,
    p95: 0.9,
    maximum: 0.9,
  });
  assert.equal(report.events.total, 3);
  assert.equal(report.events.by_event.tool_started, 1);
  assert.equal(report.events.by_event.tool_completed, 1);
  assert.deepEqual(report.events.unpaired_event_count_ratios.overall, {
    tool_started: 1,
    tool_completed: 1,
    tool_completed_per_tool_started: 1,
  });
  assert.match(report.notices[1], /unpaired aggregate event counts/);
  assert.equal(
    formatPrivacyLogReport(report),
    formatPrivacyLogReport(await buildPrivacyLogReport(options)),
  );
});

test("returns a zero-safe aggregate for empty logs", async (t) => {
  const directory = await fixtureDirectory(t);
  const accessFile = join(directory, "access.jsonl");
  const eventFile = join(directory, "events.jsonl");
  await Promise.all([writeFile(accessFile, ""), writeFile(eventFile, "")]);

  const report = await buildPrivacyLogReport({
    accessFiles: [accessFile],
    eventFiles: [eventFile],
    since: SINCE,
    until: UNTIL,
  });

  assert.equal(report.access.requests, 0);
  assert.equal(report.access.server_errors_5xx.per_request, null);
  assert.deepEqual(report.access.request_seconds, {
    samples: 0,
    p50: null,
    p95: null,
    maximum: null,
  });
  assert.equal(
    report.events.unpaired_event_count_ratios.overall.tool_completed_per_tool_started,
    null,
  );
  for (const counts of Object.values(report.events.unpaired_event_count_ratios.by_path)) {
    assert.equal(counts.tool_completed_per_tool_started, null);
  }
});

test("accepts converters and public-document SEO tools only as exact access and event paths", async (t) => {
  const directory = await fixtureDirectory(t);
  const accessFile = join(directory, "access.jsonl");
  const eventFile = join(directory, "events.jsonl");
  const eventPaths = [
    "/converters/image-to-pdf",
    "/converters/pdf-to-jpg",
    "/seo-tools/on-page-seo-audit",
    "/seo-tools/robots-sitemap-validator",
  ];
  const accessPaths = [
    ...eventPaths,
    "/api/seo-audit",
    "/api/robots-sitemap-validator",
  ];
  await writeJsonl(accessFile, accessPaths.map((path) => access({ path })));
  await writeJsonl(eventFile, [
    ...eventPaths.map((path) => event({ path })),
    ...eventPaths.map((path) => event({ event: "tool_completed", path })),
  ]);

  const report = await buildPrivacyLogReport({
    accessFiles: [accessFile],
    eventFiles: [eventFile],
    since: SINCE,
    until: UNTIL,
  });
  for (const path of accessPaths) {
    assert.equal(report.access.by_path[path], 1);
  }
  for (const path of eventPaths) {
    assert.equal(report.events.by_path[path].tool_started, 1);
    assert.equal(report.events.by_path[path].tool_completed, 1);
    assert.equal(
      report.events.unpaired_event_count_ratios.by_path[path].tool_completed_per_tool_started,
      1,
    );
  }
});

test("CLI prints only aggregate JSON and keeps input names out of output", async (t) => {
  const directory = await fixtureDirectory(t);
  const accessFile = join(directory, "access-sensitive-location.jsonl");
  const eventFile = join(directory, "events-sensitive-location.jsonl.gz");
  await writeJsonl(accessFile, [access()]);
  await writeJsonl(eventFile, [event(), event({ event: "tool_completed" })], true);

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    reporterPath,
    "--since", SINCE,
    "--until", UNTIL,
    "--access", accessFile,
    "--events", eventFile,
  ]);
  const report = JSON.parse(stdout);

  assert.equal(stderr, "");
  assert.equal(report.access.requests, 1);
  assert.equal(
    report.events.unpaired_event_count_ratios.overall.tool_completed_per_tool_started,
    1,
  );
  assert.doesNotMatch(stdout, /sensitive-location|webtaskkit-privacy-report-/);
});

test("fails closed on invalid records without echoing raw data", async (t) => {
  const directory = await fixtureDirectory(t);
  const validAccess = join(directory, "valid-access.jsonl");
  const validEvents = join(directory, "valid-events.jsonl");
  await writeJsonl(validAccess, [access()]);
  await writeJsonl(validEvents, [event()]);

  const canary = "private-canary-amount-987654";
  const invalidCases = [
    ["access-malformed.jsonl", "{truncated", "access"],
    ["access-extra-key.jsonl", access({ ip: canary }), "access"],
    ["access-wrong-site.jsonl", access({ site: "example.com" }), "access"],
    ["access-wrong-path.jsonl", access({ path: "/secret?value=1" }), "access"],
    ["access-wrong-method.jsonl", access({ method: "TRACE" }), "access"],
    ["access-wrong-status.jsonl", access({ status: 600 }), "access"],
    ["access-wrong-bytes.jsonl", access({ bytes: -1 }), "access"],
    ["access-too-many-bytes.jsonl", access({ bytes: 1_000_000_001 }), "access"],
    ["access-wrong-duration.jsonl", access({ request_seconds: -0.01 }), "access"],
    ["access-long-duration.jsonl", access({ request_seconds: 3_600.000001 }), "access"],
    ["access-wrong-upstream.jsonl", access({ upstream_seconds: canary }), "access"],
    ["access-long-upstream.jsonl", access({ upstream_seconds: "3600, 0.000001" }), "access"],
    ["access-wrong-time.jsonl", access({ timestamp: "not-a-timestamp" }), "access"],
    ["access-impossible-date.jsonl", access({ timestamp: "2026-02-30T09:48:22Z" }), "access"],
    ["access-invalid-offset.jsonl", access({ timestamp: "2026-08-14T09:48:22+14:01" }), "access"],
    ["event-extra-key.jsonl", event({ input: canary }), "event"],
    ["event-wrong-name.jsonl", event({ event: "page_view" }), "event"],
    ["event-wrong-path.jsonl", event({ path: "/generators/qr-code?text=secret" }), "event"],
  ];

  for (const [name, record, kind] of invalidCases) {
    await t.test(name, async () => {
      const filename = join(directory, name);
      await writeJsonl(filename, [record]);
      const options = {
        accessFiles: kind === "access" ? [filename] : [validAccess],
        eventFiles: kind === "event" ? [filename] : [validEvents],
        since: SINCE,
        until: UNTIL,
      };
      await assert.rejects(buildPrivacyLogReport(options), (error) => {
        assert.match(error.message, /contains an invalid record/);
        assert.doesNotMatch(error.message, new RegExp(canary));
        assert.doesNotMatch(error.message, /secret\?|987654/);
        return true;
      });
    });
  }
});

test("accepts exact numeric limits and deterministic multi-upstream sums", async (t) => {
  const directory = await fixtureDirectory(t);
  const accessFile = join(directory, "access.jsonl");
  const eventFile = join(directory, "events.jsonl");
  await writeJsonl(accessFile, [access({
    bytes: 1_000_000_000,
    request_seconds: 3_600,
    upstream_seconds: "1800, 900: 900",
  })]);
  await writeJsonl(eventFile, [event()]);

  const report = await buildPrivacyLogReport({
    accessFiles: [accessFile],
    eventFiles: [eventFile],
    since: SINCE,
    until: UNTIL,
  });
  assert.equal(report.access.request_seconds.p50, 3_600);
  assert.equal(report.access.request_seconds.p95, 3_600);
  assert.equal(report.access.upstream_seconds.p50, 3_600);
  assert.equal(report.access.upstream_seconds.p95, 3_600);
});

test("enforces file-count, file-size, window, UTF-8, and calendar bounds", async (t) => {
  const directory = await fixtureDirectory(t);
  const accessFile = join(directory, "access.jsonl");
  const eventFile = join(directory, "events.jsonl");
  await writeJsonl(accessFile, [access()]);
  await writeJsonl(eventFile, [event()]);

  const tooManyAccessFiles = Array.from(
    { length: 33 },
    (_, index) => join(directory, `access-${index}.jsonl`),
  );
  await assert.rejects(
    buildPrivacyLogReport({
      accessFiles: tooManyAccessFiles,
      eventFiles: [eventFile],
      since: SINCE,
      until: UNTIL,
    }),
    /No more than 32 inputs/,
  );
  await assert.rejects(
    buildPrivacyLogReport({
      accessFiles: [accessFile],
      eventFiles: [eventFile],
      since: "2026-08-01T00:00:00Z",
      until: "2026-09-02T00:00:00Z",
    }),
    /cannot exceed 31 days/,
  );
  await assert.rejects(
    buildPrivacyLogReport({
      accessFiles: [accessFile],
      eventFiles: [eventFile],
      since: "2026-02-30T00:00:00Z",
      until: UNTIL,
    }),
    /valid calendar timestamp/,
  );

  const oversized = join(directory, "oversized.jsonl");
  await writeFile(oversized, "");
  await truncate(oversized, 64 * 1024 * 1024 + 1);
  await assert.rejects(
    buildPrivacyLogReport({
      accessFiles: [oversized],
      eventFiles: [eventFile],
      since: SINCE,
      until: UNTIL,
    }),
    /file-size limit/,
  );

  const invalidUtf8 = join(directory, "invalid-utf8.jsonl");
  await writeFile(invalidUtf8, Buffer.from([0xc3, 0x28, 0x0a]));
  await assert.rejects(
    buildPrivacyLogReport({
      accessFiles: [invalidUtf8],
      eventFiles: [eventFile],
      since: SINCE,
      until: UNTIL,
    }),
    /not valid UTF-8/,
  );
});

test("rejects physical aliases before reading records", async (t) => {
  const directory = await fixtureDirectory(t);
  const accessFile = join(directory, "access.jsonl");
  const aliasFile = join(directory, "hardlink-events.jsonl");
  await writeJsonl(accessFile, [access()]);
  await link(accessFile, aliasFile);

  await assert.rejects(
    buildPrivacyLogReport({
      accessFiles: [accessFile],
      eventFiles: [aliasFile],
      since: SINCE,
      until: UNTIL,
    }),
    /distinct physical file/,
  );
});

test("missing and corrupt gzip inputs fail once without path or stack leakage", async (t) => {
  const directory = await fixtureDirectory(t);
  const accessFile = join(directory, "access.jsonl");
  const eventFile = join(directory, "events.jsonl");
  const missingFile = join(directory, "missing-private-canary.jsonl.gz");
  const corruptFile = join(directory, "corrupt-private-canary.jsonl.gz");
  await writeJsonl(accessFile, [access()]);
  await writeJsonl(eventFile, [event()]);
  await writeFile(corruptFile, Buffer.from("not-gzip-data", "utf8"));

  for (const candidate of [missingFile, corruptFile]) {
    await t.test(candidate === missingFile ? "missing gzip" : "corrupt gzip", async () => {
      try {
        await execFileAsync(process.execPath, [
          reporterPath,
          "--since", SINCE,
          "--until", UNTIL,
          "--access", accessFile,
          "--events", candidate,
        ]);
        assert.fail("The reporter should reject the gzip input.");
      } catch (error) {
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /Event input 1 (?:could not be read|is not valid UTF-8)/);
        assert.doesNotMatch(error.stderr, /private-canary|webtaskkit-privacy-report-|at file:/);
        assert.equal(error.stderr.trim().split("\n").length, 1);
      }
    });
  }
});

test("requires complete, non-duplicated inputs and a valid window", async (t) => {
  const directory = await fixtureDirectory(t);
  const accessFile = join(directory, "access.jsonl");
  const eventFile = join(directory, "events.jsonl");
  await writeJsonl(accessFile, [access()]);
  await writeJsonl(eventFile, [event()]);

  await assert.rejects(
    buildPrivacyLogReport({ accessFiles: [], eventFiles: [eventFile], since: SINCE, until: UNTIL }),
    /At least one access input/,
  );
  await assert.rejects(
    buildPrivacyLogReport({ accessFiles: [accessFile], eventFiles: [], since: SINCE, until: UNTIL }),
    /At least one event input/,
  );
  await assert.rejects(
    buildPrivacyLogReport({
      accessFiles: [accessFile, accessFile],
      eventFiles: [eventFile],
      since: SINCE,
      until: UNTIL,
    }),
    /listed exactly once/,
  );
  await assert.rejects(
    buildPrivacyLogReport({
      accessFiles: [accessFile],
      eventFiles: [eventFile],
      since: UNTIL,
      until: SINCE,
    }),
    /earlier than/,
  );
});
