import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import tls from "node:tls";
import test from "node:test";
import {
  EXPECTED_SITEMAP_ENTRIES,
  EXPECTED_SITEMAP_URLS,
  HTTP_PROBE_SPECS,
  TLS_PROBE_SPECS,
  assertNoCliArguments,
  buildPublicSiteHealthReport,
  createNodeHttpProbe,
  createNodeTlsProbe,
  formatPublicSiteHealthReport,
  publicSiteHealthExitCode,
  validateHomepage,
  validateRobots,
  validateSitemap,
} from "../scripts/public-site-health-report.mjs";

const OBSERVED_AT = new Date("2026-08-16T03:00:00.000Z");
const CERTIFICATE_EXPIRY = "Nov 11 02:05:58 2026 GMT";
const builtWorkerUrl = new URL("../dist/server/index.js", import.meta.url);

async function dispatchBuilt(path) {
  const { default: worker } = await import(builtWorkerUrl.href);
  const request = new Request(`http://webtaskkit.test${path}`);
  const environment = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };
  return worker.fetch(request, environment, context);
}

function robotsBody() {
  return [
    "User-agent: *",
    "Allow: /",
    "Sitemap: https://webtaskkit.com/sitemap.xml",
    "",
  ].join("\n");
}

function sitemapBody(entries = EXPECTED_SITEMAP_ENTRIES) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(({ url, changeFrequency, priority }) => [
      "<url>",
      `<loc>${url}</loc>`,
      `<changefreq>${changeFrequency}</changefreq>`,
      `<priority>${priority}</priority>`,
      "</url>",
    ].join("")),
    "</urlset>",
  ].join("");
}

function changedEntries(index, changes) {
  return EXPECTED_SITEMAP_ENTRIES.map((entry, entryIndex) => (
    entryIndex === index ? { ...entry, ...changes } : entry
  ));
}

function homepageBody({
  title = "WebTaskKit — Fast, Private Online Tools",
  canonical = "https://webtaskkit.com",
  applicationName = "WebTaskKit",
  extraHead = "",
} = {}) {
  return [
    "<!doctype html><html><head>",
    `<title>${title}</title>`,
    `<meta name="application-name" content="${applicationName}"/>`,
    `<link rel="canonical" href="${canonical}"/>`,
    extraHead,
    "</head><body>WebTaskKit</body></html>",
  ].join("");
}

function defaultHttpResponse(spec) {
  if (spec.expectedLocation) {
    return {
      status: 301,
      location: "https://webtaskkit.com/",
      contentType: "text/html; charset=utf-8",
      body: "",
      durationMs: 10,
    };
  }
  if (spec.id === "https_apex_root") {
    return {
      status: 200,
      location: null,
      contentType: "text/html; charset=utf-8",
      body: homepageBody(),
      durationMs: 40,
    };
  }
  if (spec.id === "robots_policy") {
    return {
      status: 200,
      location: null,
      contentType: "text/plain; charset=utf-8",
      body: robotsBody(),
      durationMs: 20,
    };
  }
  return {
    status: 200,
    location: null,
    contentType: "application/xml",
    body: sitemapBody(),
    durationMs: 30,
  };
}

function fixture(overrides = {}) {
  const httpCalls = [];
  const tlsCalls = [];
  const httpProbe = async (spec) => {
    httpCalls.push(spec);
    const override = overrides.http?.[spec.id];
    if (override instanceof Error) throw override;
    if (typeof override === "function") return override(spec);
    return { ...defaultHttpResponse(spec), ...override };
  };
  const tlsProbe = async (spec) => {
    tlsCalls.push(spec);
    const override = overrides.tls?.[spec.id];
    if (override instanceof Error) throw override;
    if (typeof override === "function") return override(spec);
    return {
      validTo: CERTIFICATE_EXPIRY,
      protocol: "TLSv1.3",
      durationMs: spec.id === "tls_apex" ? 15 : 20,
      ...override,
    };
  };
  return {
    httpCalls,
    tlsCalls,
    dependencies: {
      httpProbe,
      tlsProbe,
      now: () => new Date(OBSERVED_AT),
    },
  };
}

test("builds aggregate-only evidence for the fixed WebTaskKit contract", async () => {
  const run = fixture();
  const report = await buildPublicSiteHealthReport(run.dependencies);

  assert.equal(report.site, "webtaskkit.com");
  assert.equal(report.observed_at, OBSERVED_AT.toISOString());
  assert.equal(report.overall_status, "pass");
  assert.match(report.evidence_type, /not an uptime SLA/);
  assert.deepEqual(report.synthetic_probe_floor, {
    http_requests_per_run: 6,
    tls_handshakes_per_run: 2,
    notice: "Synthetic requests are operational evidence, not visits or users.",
  });
  assert.deepEqual(report.http, {
    checks: 6,
    passed: 6,
    failed: 0,
    transport_or_contract_failures: 0,
    status_classes: { "1xx": 0, "2xx": 3, "3xx": 3, "4xx": 0, "5xx": 0 },
    server_errors_5xx: 0,
    maximum_response_seconds: 0.04,
  });
  assert.equal(report.tls.checks, 2);
  assert.equal(report.tls.passed, 2);
  assert.equal(report.tls.minimum_required_days_remaining, 21);
  assert.ok(report.tls.minimum_days_remaining > 80);
  assert.deepEqual(report.tls.protocols, { "TLSv1.3": 2 });
  assert.deepEqual(report.robots, { valid: true });
  assert.deepEqual(report.sitemap, {
    valid: true,
    canonical_urls: 13,
    expected_canonical_urls: 13,
  });
  assert.deepEqual(report.failure_codes, []);
  assert.equal(publicSiteHealthExitCode(report), 0);

  assert.deepEqual(run.httpCalls, HTTP_PROBE_SPECS);
  assert.deepEqual(run.tlsCalls, TLS_PROBE_SPECS);
  for (const spec of run.httpCalls) {
    const parsed = new URL(spec.url);
    assert.equal(parsed.search, "");
    assert.equal(parsed.hash, "");
    assert.equal("headers" in spec, false);
    assert.equal("body" in spec, false);
  }

  const serialized = formatPublicSiteHealthReport(report);
  assert.doesNotMatch(serialized, /\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  assert.doesNotMatch(serialized, /serial|fingerprint|dns|raw_/i);
});

test("accepts no target, header, body, or other command-line arguments", () => {
  assert.doesNotThrow(() => assertNoCliArguments([]));
  for (const argv of [
    ["--url", "https://example.com"],
    ["--header", "X-Probe: rejected-value"],
    ["--body", "rejected-value"],
    ["--help"],
  ]) {
    assert.throws(() => assertNoCliArguments(argv), /accepts no command-line arguments/);
  }
});

test("reports fixed failure codes for 5xx, redirect, and transport failures without leaking details", async () => {
  const canary = "private-network-error-192.0.2.44";
  const run = fixture({
    http: {
      http_apex_redirect: { location: "https://example.com/" },
      https_apex_root: { status: 503 },
      robots_policy: new Error(canary),
    },
  });
  const report = await buildPublicSiteHealthReport(run.dependencies);
  const serialized = formatPublicSiteHealthReport(report);

  assert.equal(report.overall_status, "fail");
  assert.equal(publicSiteHealthExitCode(report), 1);
  assert.equal(report.http.server_errors_5xx, 1);
  assert.equal(report.http.status_classes["5xx"], 1);
  assert.deepEqual(report.failure_codes, ["http_apex_redirect", "https_apex_root", "robots_policy"]);
  assert.doesNotMatch(serialized, new RegExp(canary));
  assert.doesNotMatch(serialized, /example\.com/);
});

test("validates the exact public robots policy with standard comments and CR-only lines", () => {
  assert.equal(validateRobots(robotsBody()), true);
  assert.equal(validateRobots([
    "# WebTaskKit crawler policy",
    "User-Agent: *# all crawlers",
    "Allow: / # public site",
    "# canonical discovery",
    "Sitemap: https://webtaskkit.com/sitemap.xml# fixed sitemap",
    "",
  ].join("\r")), true);
  for (const invalid of [
    "User-agent: *\nDisallow: /\nSitemap: https://webtaskkit.com/sitemap.xml\n",
    "User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n",
    "User-agent: *\nAllow /\nSitemap: https://webtaskkit.com/sitemap.xml\n",
    "User-agent: other\nAllow: /\nSitemap: https://webtaskkit.com/sitemap.xml\n",
    "User-agent: *\nAllow: /\nCrawl-delay: 1\nSitemap: https://webtaskkit.com/sitemap.xml\n",
    "User-agent: *\nAllow: /\nAllow: /extra\nSitemap: https://webtaskkit.com/sitemap.xml\n",
  ]) {
    assert.throws(() => validateRobots(invalid));
  }
});

test("requires the exact ordered sitemap serializer contract", () => {
  assert.equal(validateSitemap(sitemapBody()), EXPECTED_SITEMAP_URLS.length);
  assert.deepEqual(EXPECTED_SITEMAP_ENTRIES, [
    { url: "https://webtaskkit.com/", changeFrequency: "weekly", priority: "1" },
    { url: "https://webtaskkit.com/generators", changeFrequency: "monthly", priority: "0.8" },
    { url: "https://webtaskkit.com/converters", changeFrequency: "monthly", priority: "0.8" },
    { url: "https://webtaskkit.com/editors", changeFrequency: "monthly", priority: "0.8" },
    { url: "https://webtaskkit.com/about", changeFrequency: "monthly", priority: "0.3" },
    { url: "https://webtaskkit.com/privacy", changeFrequency: "monthly", priority: "0.3" },
    { url: "https://webtaskkit.com/generators/qr-code", changeFrequency: "monthly", priority: "0.8" },
    { url: "https://webtaskkit.com/generators/barcode", changeFrequency: "monthly", priority: "0.8" },
    { url: "https://webtaskkit.com/converters/txt-to-pdf", changeFrequency: "monthly", priority: "0.8" },
    { url: "https://webtaskkit.com/converters/image-to-pdf", changeFrequency: "monthly", priority: "0.8" },
    { url: "https://webtaskkit.com/editors/svg", changeFrequency: "monthly", priority: "0.8" },
    { url: "https://webtaskkit.com/editors/text", changeFrequency: "monthly", priority: "0.8" },
    { url: "https://webtaskkit.com/generators/tone", changeFrequency: "monthly", priority: "0.8" },
  ]);
});

test("rejects hostile extensions, foreign markup, reordering, and lexical sitemap drift", () => {
  const reordered = [
    EXPECTED_SITEMAP_ENTRIES[1],
    EXPECTED_SITEMAP_ENTRIES[0],
    ...EXPECTED_SITEMAP_ENTRIES.slice(2),
  ];
  const firstBlock = [
    "<url>",
    "<loc>https://webtaskkit.com/</loc>",
    "<changefreq>weekly</changefreq>",
    "<priority>1</priority>",
    "</url>",
  ].join("");
  const cases = [
    `<!DOCTYPE urlset [<!ENTITY xxe "canary">]>${sitemapBody()}`,
    sitemapBody().replace("<urlset", "<!--comment--><urlset"),
    sitemapBody().replace("https://webtaskkit.com/", "<![CDATA[https://webtaskkit.com/]]>"),
    sitemapBody().replace("https://webtaskkit.com/about", "https://webtaskkit.com/&custom;"),
    sitemapBody(changedEntries(0, { url: "https://example.com/" })),
    sitemapBody(changedEntries(EXPECTED_SITEMAP_ENTRIES.length - 1, { url: EXPECTED_SITEMAP_URLS[0] })),
    sitemapBody(changedEntries(1, { url: `${EXPECTED_SITEMAP_URLS[1]}?probe=1` })),
    sitemapBody(changedEntries(1, { url: `${EXPECTED_SITEMAP_URLS[1]}#fragment` })),
    sitemapBody(changedEntries(1, { url: `${EXPECTED_SITEMAP_URLS[1]}/changed` })),
    sitemapBody().replace("<urlset ", '<urlset xmlns:image="https://example.com/image" '),
    sitemapBody().replace("</url>", "<image:image/></url>"),
    sitemapBody().replace("</urlset>", "<foreign/></urlset>"),
    sitemapBody().replace("</loc>", "</loc><lastmod>2026-08-16</lastmod>"),
    sitemapBody(reordered),
    sitemapBody().replace(
      firstBlock,
      "<url><changefreq>weekly</changefreq><loc>https://webtaskkit.com/</loc><priority>1</priority></url>",
    ),
    sitemapBody().replace("<priority>0.8</priority>", "<priority>0.80</priority>"),
    sitemapBody().replace("<changefreq>monthly</changefreq>", "<changefreq>Monthly</changefreq>"),
    ` ${sitemapBody()}`,
    sitemapBody().replace('encoding="UTF-8"', 'encoding="utf-8"'),
    sitemapBody().replace('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"', "xmlns='http://www.sitemaps.org/schemas/sitemap/0.9'"),
    sitemapBody().replace("https://webtaskkit.com/about", " https://webtaskkit.com/about "),
    sitemapBody().replace("</urlset>", "\u0001</urlset>"),
    sitemapBody().replace("</urlset>", "\uD800</urlset>"),
  ];
  for (const invalid of cases) assert.throws(() => validateSitemap(invalid));
});

test("validates homepage identity and its one exact canonical link", async () => {
  assert.equal(validateHomepage(homepageBody()), true);
  for (const invalid of [
    homepageBody({ title: "Example Site" }),
    homepageBody({ canonical: "https://www.webtaskkit.com/" }),
    homepageBody({ canonical: "https://webtaskkit.com/" }),
    homepageBody({ applicationName: "Other Kit" }),
    homepageBody({ extraHead: '<link rel="canonical" href="https://webtaskkit.com"/>' }),
    homepageBody().replace('rel="canonical"', 'rel="canonical alternate"'),
    homepageBody().replace('href="https://webtaskkit.com"', 'href="https://webtaskkit.com" href="https://example.com"'),
    homepageBody({
      canonical: "https://example.com",
      extraHead: '<!--<link rel="canonical" href="https://webtaskkit.com"/>-->',
    }),
    "<!doctype html><html><body><title>WebTaskKit — Fast, Private Online Tools</title></body></html>",
  ]) {
    assert.throws(() => validateHomepage(invalid));
  }

  const report = await buildPublicSiteHealthReport(fixture({
    http: { https_apex_root: { body: homepageBody({ canonical: "https://example.com" }) } },
  }).dependencies);
  assert.equal(report.overall_status, "fail");
  assert.ok(report.failure_codes.includes("https_apex_root"));
});

test("the rendered homepage, robots policy, and sitemap satisfy the fixed evidence contracts", async () => {
  const [homepage, robots, sitemap] = await Promise.all([
    dispatchBuilt("/"),
    dispatchBuilt("/robots.txt"),
    dispatchBuilt("/sitemap.xml"),
  ]);
  assert.equal(homepage.status, 200);
  assert.equal(robots.status, 200);
  assert.equal(sitemap.status, 200);
  assert.equal(validateHomepage(await homepage.text()), true);
  assert.equal(validateRobots(await robots.text()), true);
  assert.equal(validateSitemap(await sitemap.text()), EXPECTED_SITEMAP_ENTRIES.length);
});

test("fails closed on TLS transport errors and certificates inside the expiry threshold", async () => {
  const canary = "tls-private-canary";
  const failedTransport = fixture({ tls: { tls_apex: new Error(canary) } });
  const failedReport = await buildPublicSiteHealthReport(failedTransport.dependencies);
  assert.equal(failedReport.overall_status, "fail");
  assert.deepEqual(failedReport.failure_codes, ["tls_apex"]);
  assert.doesNotMatch(formatPublicSiteHealthReport(failedReport), new RegExp(canary));

  const nearExpiry = new Date(OBSERVED_AT.getTime() + 20 * 24 * 60 * 60 * 1_000).toUTCString();
  const thresholdRun = fixture({ tls: { tls_www: { validTo: nearExpiry } } });
  const thresholdReport = await buildPublicSiteHealthReport(thresholdRun.dependencies);
  assert.equal(thresholdReport.overall_status, "fail");
  assert.deepEqual(thresholdReport.failure_codes, ["tls_www"]);
  assert.equal(thresholdReport.tls.minimum_days_remaining, 20);
});

test("the injected HTTP transport enforces manual, credential-free requests and body caps", async () => {
  let captured;
  let timeoutDelay;
  const probe = createNodeHttpProbe({
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response("<html>ok</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
    scheduleTimeout: (_callback, delay) => {
      timeoutDelay = delay;
      return 7;
    },
    cancelTimeout: (id) => assert.equal(id, 7),
    monotonicNow: (() => {
      const values = [100, 125];
      return () => values.shift();
    })(),
  });
  const result = await probe(HTTP_PROBE_SPECS.find(({ id }) => id === "https_apex_root"));

  assert.equal(timeoutDelay, 8_000);
  assert.equal(captured.url, "https://webtaskkit.com/");
  assert.deepEqual(captured.init.headers, { Accept: "text/html" });
  assert.equal(captured.init.method, "GET");
  assert.equal(captured.init.redirect, "manual");
  assert.equal(captured.init.credentials, "omit");
  assert.equal(captured.init.referrerPolicy, "no-referrer");
  assert.equal(captured.init.body, undefined);
  assert.equal(result.durationMs, 25);

  const oversized = createNodeHttpProbe({
    fetchImpl: async () => new Response("small", {
      status: 200,
      headers: {
        "content-type": "text/html",
        "content-length": String(512 * 1_024 + 1),
      },
    }),
  });
  await assert.rejects(
    oversized(HTTP_PROBE_SPECS.find(({ id }) => id === "https_apex_root")),
    /HTTP probe failed/,
  );
});

test("the injected HTTP transport aborts at its fixed timeout without retrying", async () => {
  let timeoutCallback;
  let calls = 0;
  const probe = createNodeHttpProbe({
    fetchImpl: async (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
    scheduleTimeout: (callback) => {
      timeoutCallback = callback;
      return 1;
    },
    cancelTimeout: () => {},
  });

  const pending = probe(HTTP_PROBE_SPECS[0]);
  timeoutCallback();
  await assert.rejects(pending, /timed out/);
  assert.equal(calls, 1);
});

test("the injected TLS transport uses fixed SNI and normal CA/hostname verification", async () => {
  class FakeTlsSocket extends EventEmitter {
    constructor() {
      super();
      this.destroyedByProbe = false;
    }

    getPeerCertificate() {
      return { valid_to: CERTIFICATE_EXPIRY, serialNumber: "must-not-be-emitted" };
    }

    getProtocol() {
      return "TLSv1.3";
    }

    destroy() {
      this.destroyedByProbe = true;
    }
  }

  const socket = new FakeTlsSocket();
  let options;
  let deadlineDelay;
  let cancelledDeadline;
  const probe = createNodeTlsProbe({
    connectImpl: (receivedOptions, onSecure) => {
      options = receivedOptions;
      queueMicrotask(onSecure);
      return socket;
    },
    scheduleTimeout: (_callback, delay) => {
      deadlineDelay = delay;
      return 73;
    },
    cancelTimeout: (id) => {
      cancelledDeadline = id;
    },
    monotonicNow: (() => {
      const values = [200, 230];
      return () => values.shift();
    })(),
  });
  const result = await probe(TLS_PROBE_SPECS.find(({ id }) => id === "tls_www"));

  assert.equal(options.host, "www.webtaskkit.com");
  assert.equal(options.servername, "www.webtaskkit.com");
  assert.equal(options.port, 443);
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.checkServerIdentity, tls.checkServerIdentity);
  assert.equal(options.minVersion, "TLSv1.2");
  assert.equal("ca" in options, false);
  assert.equal(deadlineDelay, 8_000);
  assert.equal(cancelledDeadline, 73);
  assert.equal(socket.destroyedByProbe, true);
  assert.deepEqual(result, {
    validTo: CERTIFICATE_EXPIRY,
    protocol: "TLSv1.3",
    durationMs: 30,
  });
  assert.doesNotMatch(JSON.stringify(result), /serial/i);
});

test("the TLS transport uses an absolute deadline, destroys the socket, and never retries", async () => {
  class PendingTlsSocket extends EventEmitter {
    destroy() {
      this.destroyedByProbe = true;
    }
  }

  const socket = new PendingTlsSocket();
  let deadlineCallback;
  let deadlineDelay;
  let cancelledDeadline;
  let connections = 0;
  const probe = createNodeTlsProbe({
    connectImpl: () => {
      connections += 1;
      return socket;
    },
    scheduleTimeout: (callback, delay) => {
      deadlineCallback = callback;
      deadlineDelay = delay;
      return 91;
    },
    cancelTimeout: (id) => {
      cancelledDeadline = id;
    },
  });

  const pending = probe(TLS_PROBE_SPECS[0]);
  socket.emit("data", Buffer.from("activity must not extend an absolute deadline"));
  deadlineCallback();
  await assert.rejects(pending, /TLS probe failed/);
  assert.equal(deadlineDelay, 8_000);
  assert.equal(cancelledDeadline, 91);
  assert.equal(socket.destroyedByProbe, true);
  assert.equal(connections, 1);
});
