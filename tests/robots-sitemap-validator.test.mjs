import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  robotsDocumentUrl,
  sitemapDocumentUrl,
  validateRobotsOrSitemap,
} from "../lib/robotsSitemapValidator.ts";
import {
  evaluateRobotsPath,
  parseRobotsDocument,
  ROBOTS_VALIDATOR_LIMITS,
  robotsChecks,
  validateCrawlerProductToken,
  validateRobotsEvaluationPath,
} from "../lib/robotsValidator.ts";
import {
  decodeSitemapBody,
  parseSitemapDocument,
  sitemapChecks,
} from "../lib/sitemapValidator.ts";

const PUBLIC_V4 = "93.184.216.34";
const encoder = new TextEncoder();
const context = () => ({
  signal: new AbortController().signal,
  deadlineMilliseconds: performance.now() + 10_000,
});
const errorCode = (code) => (error) => error?.code === code;
const xml = (body, namespace = ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"') => (
  `<?xml version="1.0" encoding="UTF-8"?><urlset${namespace}>${body}</urlset>`
);

function pinnedResponse(overrides = {}) {
  const body = overrides.body ?? encoder.encode("User-agent: *\nDisallow: /private\n");
  return {
    status: 200,
    location: null,
    contentType: "text/plain; charset=utf-8",
    contentEncoding: null,
    body,
    connectedAddress: PUBLIC_V4,
    ...overrides,
  };
}

test("validator input URLs are exact public default-port documents without query data", () => {
  assert.equal(robotsDocumentUrl("HTTPS://Example.COM/").href, "https://example.com/robots.txt");
  assert.equal(sitemapDocumentUrl("https://example.com/maps/site.XML.GZ").href, "https://example.com/maps/site.XML.GZ");
  for (const value of [
    "https://example.com/page",
    "https://example.com/?secret=1",
    "https://example.com:8443/",
    "http://127.0.0.1/",
  ]) assert.throws(() => robotsDocumentUrl(value));
  for (const value of [
    "https://example.com/sitemap.xml?secret=1",
    "https://example.com/sitemap.txt",
    "file:///sitemap.xml",
  ]) assert.throws(() => sitemapDocumentUrl(value));
});

test("robots parser preserves groups across blank comments and evaluates RFC-style specificity", () => {
  const parsed = parseRobotsDocument(encoder.encode(`
User-agent: ExampleBot

# comments do not terminate a group
Disallow: /private
Allow: /private/public
Allow:
Disallow:
Disallow: *.gif$

User-agent: *
Disallow: /*ab$
Allow: /same
Disallow: /same
Disallow: /search?draft=1
`), context());
  assert.equal(parsed.groups.length, 2);
  assert.equal(evaluateRobotsPath(parsed, "/private/public/a", "examplebot").verdict, "allowed");
  assert.equal(evaluateRobotsPath(parsed, "/asset.gif", "examplebot").verdict, "blocked");
  assert.equal(evaluateRobotsPath(parsed, "/abxxab", "other").verdict, "blocked");
  assert.equal(evaluateRobotsPath(parsed, "/same", "other").verdict, "allowed");
  assert.equal(evaluateRobotsPath(parsed, "/search?draft=1", "other").verdict, "blocked");
  assert.equal(evaluateRobotsPath(parsed, "/robots.txt", "other").verdict, "allowed");
  assert.ok(robotsChecks(parsed, null).some((check) => check.id === "robots-leading-wildcard" && check.category === "crawler_specific"));
});

test("robots structural whitespace is only space/tab and implicit allowance excludes query variants", () => {
  const nbsp = "\u00a0";
  const parsed = parseRobotsDocument(encoder.encode(`User-agent: *\nDisallow: /private${nbsp}\nDisallow: /robots.txt?preview=1`), context());
  assert.equal(evaluateRobotsPath(parsed, "/private", "*").verdict, "allowed");
  assert.equal(evaluateRobotsPath(parsed, `/private${nbsp}`, "*").verdict, "blocked");
  assert.equal(evaluateRobotsPath(parsed, "/robots%2Etxt", "*").verdict, "allowed");
  assert.equal(evaluateRobotsPath(parsed, "/robots.txt?preview=1", "*").verdict, "blocked");
});

test("robots path normalization handles Unicode, percent encoding, reserved octets, and bad input", () => {
  const parsed = parseRobotsDocument(encoder.encode([
    "User-agent: *",
    "Disallow: /caf%C3%A9",
    "Disallow: /slash%2Fencoded",
    "Disallow: /query%3Fx",
  ].join("\n")), context());
  assert.equal(evaluateRobotsPath(parsed, "/café", "*").verdict, "blocked");
  assert.equal(evaluateRobotsPath(parsed, "/slash%2fencoded", "*").verdict, "blocked");
  assert.equal(evaluateRobotsPath(parsed, "/slash/encoded", "*").verdict, "allowed");
  assert.equal(evaluateRobotsPath(parsed, "/query%3fx", "*").verdict, "blocked");
  assert.equal(evaluateRobotsPath(parsed, "/query?x", "*").verdict, "allowed");
  assert.throws(() => validateRobotsEvaluationPath("/bad%ZZ"));
  assert.throws(() => validateRobotsEvaluationPath("/bad\ud800"));
  assert.throws(() => validateCrawlerProductToken("bot2"));
  assert.equal(validateCrawlerProductToken("Google_bot-test"), "google_bot-test");
});

test("RFC 9309 Figure 6 percent-encoded literal star and dollar match raw URI data", () => {
  const parsed = parseRobotsDocument(encoder.encode([
    "User-agent: *",
    "Disallow: /path/file-with-a-%2A.html",
    "Disallow: /path/foo-%24",
  ].join("\n")), context());
  assert.equal(evaluateRobotsPath(parsed, "/path/file-with-a-*.html", "*").verdict, "blocked");
  assert.equal(evaluateRobotsPath(parsed, "/path/foo-$", "*").verdict, "blocked");
});

test("robots parser ignores unsafe lines, recovers parseable rules, and enforces 500 KiB", () => {
  const bytes = Uint8Array.from([
    ...encoder.encode("User-agent: *\nDisallow: /bad path\nDisallow: /ok\n# "),
    0xff,
    ...encoder.encode("\nAllow: /ok/public\n"),
  ]);
  const parsed = parseRobotsDocument(bytes, context());
  assert.equal(parsed.encodingIssueLines, 1);
  assert.equal(parsed.invalidLines, 2);
  assert.equal(evaluateRobotsPath(parsed, "/ok/public", "*").verdict, "allowed");
  const literalReplacement = parseRobotsDocument(encoder.encode("User-agent: *\nDisallow: /\ufffd"), context());
  assert.equal(literalReplacement.encodingIssueLines, 0);
  assert.equal(literalReplacement.ruleCount, 1);
  const commentControl = parseRobotsDocument(encoder.encode("User-agent: * #\u0001\nDisallow: /x"), context());
  assert.equal(commentControl.invalidLines, 2);
  assert.equal(commentControl.ruleCount, 0);
  parseRobotsDocument(new Uint8Array(ROBOTS_VALIDATOR_LIMITS.maximumBytes).fill(0x23), context());
  assert.throws(
    () => parseRobotsDocument(new Uint8Array(ROBOTS_VALIDATOR_LIMITS.maximumBytes + 1), context()),
    errorCode("response_too_large"),
  );
});

test("valid but oversized robots records are explicit tool limits, not malformed syntax", () => {
  const token = "a".repeat(65);
  const pattern = `/${"a".repeat(2_048)}`;
  const tokenResult = parseRobotsDocument(encoder.encode(`User-agent: ${token}\n`), context());
  const patternResult = parseRobotsDocument(encoder.encode(`User-agent: *\nDisallow: ${pattern}\n`), context());
  assert.equal(tokenResult.invalidLines, 0);
  assert.equal(tokenResult.limitedProductTokens, 1);
  assert.equal(patternResult.invalidLines, 0);
  assert.equal(patternResult.limitedRulePatterns, 1);
  assert.ok(robotsChecks(patternResult, null).some((check) => check.id === "robots-record-limits" && check.category === "tool_limit"));
});

test("tool-limited crawler tokens preserve group boundaries without leaking rules", () => {
  const token = "a".repeat(65);
  const separated = parseRobotsDocument(encoder.encode(`User-agent: *\nDisallow: /old\nUser-agent: ${token}\nAllow: /old`), context());
  assert.equal(evaluateRobotsPath(separated, "/old", "other").verdict, "blocked");
  assert.equal(separated.limitedRulesInExcludedGroups, 1);

  const mixed = parseRobotsDocument(encoder.encode(`User-agent: ${token}\nUser-agent: *\nDisallow: /mixed`), context());
  assert.equal(evaluateRobotsPath(mixed, "/mixed", "other").verdict, "blocked");
  assert.equal(mixed.invalidLines, 0);
});

test("robots wildcard evaluation is bounded and honors an expired deadline", () => {
  const pattern = `/${"*a".repeat(14)}b`;
  const parsed = parseRobotsDocument(encoder.encode(`User-agent: *\nDisallow: ${pattern}$\n`), context());
  const started = performance.now();
  assert.equal(evaluateRobotsPath(parsed, `/${"a".repeat(500)}`, "*").verdict, "allowed");
  assert.ok(performance.now() - started < 1_000);
  assert.throws(() => evaluateRobotsPath(parsed, "/anything", "*", {
    signal: new AbortController().signal,
    deadlineMilliseconds: performance.now() - 1,
  }), errorCode("timeout"));
});

test("namespace-aware sitemap parsing distinguishes extensions and core fields", async () => {
  const document = `<?xml version="1.0" encoding="UTF-8"?>
<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <sm:url><sm:loc>https://example.com/a?x=1&amp;y=2</sm:loc><image:image><image:loc>https://cdn.example/image.jpg</image:loc></image:image></sm:url>
</sm:urlset>`;
  const parsed = await parseSitemapDocument(encoder.encode(document), "https://example.com/sitemap.xml", context());
  assert.equal(parsed.type, "urlset");
  assert.equal(parsed.validLocationCount, 1);
  assert.equal(parsed.extensionElementCount, 1);
  assert.equal(parsed.unknownCoreElementCount, 0);
  assert.equal(parsed.previewEntries[0].location, "https://example.com/a?x=1&y=2");
});

test("official root xsi schemaLocation metadata is accepted", async () => {
  const document = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9 http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
    <url><loc>https://example.com/</loc></url>
  </urlset>`;
  const parsed = await parseSitemapDocument(encoder.encode(document), "https://example.com/sitemap.xml", context());
  assert.equal(parsed.unknownCoreAttributeCount, 0);
  assert.ok(!sitemapChecks(parsed, document.length).some((check) => check.id === "sitemap-core-attributes"));
});

test("sitemap XML fails closed for controls, malformed PI, expanded duplicate attributes and DTD", async () => {
  const hostile = [
    xml("<url><loc>https://example.com/\u0001</loc></url>"),
    "<? ?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"/>",
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:a="urn:x" xmlns:b="urn:x" a:x="1" b:x="2"/>',
    '<!DOCTYPE urlset [<!ENTITY x SYSTEM "file:///etc/passwd">]><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>',
  ];
  for (const document of hostile) {
    await assert.rejects(parseSitemapDocument(encoder.encode(document), "https://example.com/sitemap.xml", context()), errorCode("invalid_document"));
  }
  const comment = xml("<!-- literal <!DOCTYPE is harmless here --><url><loc>https://example.com/</loc></url>");
  assert.equal((await parseSitemapDocument(encoder.encode(comment), "https://example.com/sitemap.xml", context())).entryCount, 1);
});

test("sitemap findings include namespace, duplicate fields, hosts, dates and Google-only hints", async () => {
  const document = xml(`
    <url><loc>https://example.com/a</loc><loc>https://example.com/b</loc><lastmod>2999-01-01</lastmod><changefreq>daily</changefreq><priority>0.5</priority></url>
    <url><loc>https://other.example/c</loc><lastmod>2026-01-01T00:00:00+14:01</lastmod></url>
    <url><loc>https://third.example/d</loc></url>
  `, "");
  const parsed = await parseSitemapDocument(encoder.encode(document), "https://example.com/maps/sitemap.xml", context());
  const checks = sitemapChecks(parsed, encoder.encode(document).byteLength);
  assert.ok(checks.some((check) => check.id === "sitemap-namespace" && check.category === "error"));
  assert.ok(checks.some((check) => check.id === "sitemap-duplicate-fields" && check.category === "error"));
  assert.ok(checks.some((check) => check.id === "sitemap-single-host" && check.category === "error"));
  assert.ok(checks.some((check) => check.id === "sitemap-cross-site-ownership" && check.category === "unverifiable"));
  assert.ok(checks.some((check) => check.id === "sitemap-future-lastmod"));
  assert.ok(checks.some((check) => check.id === "sitemap-lastmod"));
  assert.ok(checks.some((check) => check.id === "sitemap-google-hints" && check.category === "crawler_specific"));
  assert.ok(checks.some((check) => check.id === "sitemap-directory-scope" && check.category === "error"));
  assert.ok(checks.some((check) => check.id === "sitemap-search-console-scope" && check.category === "unverifiable"));
});

test("sitemap core order, attributes, location lexemes, and extension placement are errors", async () => {
  const document = `
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url bad="1"><lastmod>2026-01-01</lastmod><loc foo="x">https://example.com/a b\\c</loc><image:image/><priority>0.5</priority><changefreq>daily</changefreq></url>
      <image:image><image:loc>https://example.com/image.jpg</image:loc></image:image>
    </urlset>`;
  const parsed = await parseSitemapDocument(encoder.encode(document), "https://example.com/maps/sitemap.xml", context());
  const checks = sitemapChecks(parsed, document.length);
  for (const id of ["sitemap-field-order", "sitemap-core-attributes", "sitemap-extension-placement", "sitemap-locations"]) {
    assert.ok(checks.some((check) => check.id === id && check.category === "error"), id);
  }
});

test("present but empty optional sitemap fields are protocol errors", async () => {
  const document = xml("<url><loc>https://example.com/</loc><lastmod/><changefreq> </changefreq><priority/></url>");
  const parsed = await parseSitemapDocument(encoder.encode(document), "https://example.com/sitemap.xml", context());
  const checks = sitemapChecks(parsed, document.length);
  for (const id of ["sitemap-lastmod", "sitemap-changefreq", "sitemap-priority"]) {
    assert.ok(checks.some((check) => check.id === id && check.category === "error"), id);
  }
});

test("sitemap accepts bounded XML Schema priority and W3C year lexical forms", async () => {
  const priorities = ["+0.5", "00.50", ".5", "1.", "-0"];
  const dates = ["0001-01-01", "0099-12-31", "10000-01-01", "2024-02-29T24:00:00.0Z", "2026-01-01+14:00"];
  const validDocument = xml(priorities.map((priority, index) => `
    <url><loc>https://example.com/valid-${index}</loc><lastmod>${dates[index]}</lastmod><priority>${priority}</priority></url>
  `).join(""));
  const valid = await parseSitemapDocument(encoder.encode(validDocument), "https://example.com/sitemap.xml", context());
  assert.equal(valid.invalidPriorityCount, 0);
  assert.equal(valid.invalidLastModifiedCount, 0);
  assert.equal(valid.futureLastModifiedCount, 1);

  const badPriorities = ["1.0001", "-0.1", "+1.1", "1e0", "."];
  const badDates = ["0000-01-01", "099-01-01", "2025-02-29", "2026-01-01T24:00:00.1Z", "2026-01-01T00:00:00+14:01"];
  const invalidDocument = xml(badPriorities.map((priority, index) => `
    <url><loc>https://example.com/invalid-${index}</loc><lastmod>${badDates[index]}</lastmod><priority>${priority}</priority></url>
  `).join(""));
  const invalid = await parseSitemapDocument(encoder.encode(invalidDocument), "https://example.com/sitemap.xml", context());
  assert.equal(invalid.invalidPriorityCount, badPriorities.length);
  assert.equal(invalid.invalidLastModifiedCount, badDates.length);

  const leadingZeroExtendedYear = xml("<url><loc>https://example.com/leading-year</loc><lastmod>02026-01-01</lastmod><priority>0.5</priority></url>");
  const leadingYear = await parseSitemapDocument(encoder.encode(leadingZeroExtendedYear), "https://example.com/sitemap.xml", context());
  assert.equal(leadingYear.invalidLastModifiedCount, 1);
});

test("changefreq preserves XML Schema string whitespace", async () => {
  const document = xml("<url><loc>https://example.com/</loc><changefreq> daily </changefreq></url>");
  const parsed = await parseSitemapDocument(encoder.encode(document), "https://example.com/sitemap.xml", context());
  assert.equal(parsed.invalidChangeFrequencyCount, 1);
  assert.ok(sitemapChecks(parsed, document.length).some((check) => check.id === "sitemap-changefreq" && check.category === "error"));
});

test("root foreign extensions follow the schema sequence for both sitemap root types", async () => {
  for (const [root, entry, location] of [
    ["urlset", "url", "https://example.com/page"],
    ["sitemapindex", "sitemap", "https://example.com/child.xml"],
  ]) {
    const beforeEntries = `<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:e="urn:example"><e:metadata/><${entry}><loc>${location}</loc></${entry}></${root}>`;
    const accepted = await parseSitemapDocument(encoder.encode(beforeEntries), "https://example.com/sitemap.xml", context());
    assert.equal(accepted.extensionElementCount, 1, root);
    assert.equal(accepted.invalidExtensionPlacementCount, 0, root);
    assert.ok(!sitemapChecks(accepted, beforeEntries.length).some((check) => check.id === "sitemap-extension-placement"), root);

    const afterEntries = `<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:e="urn:example"><${entry}><loc>${location}</loc></${entry}><e:metadata/></${root}>`;
    const rejected = await parseSitemapDocument(encoder.encode(afterEntries), "https://example.com/sitemap.xml", context());
    assert.equal(rejected.invalidExtensionPlacementCount, 1, root);
    assert.ok(sitemapChecks(rejected, afterEntries.length).some((check) => check.id === "sitemap-extension-placement" && check.category === "error" && /after entries/.test(check.message)), root);
  }
});

test("empty sitemap roots are protocol errors", async () => {
  for (const root of ["urlset", "sitemapindex"]) {
    const document = `<${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>`;
    const parsed = await parseSitemapDocument(encoder.encode(document), "https://example.com/sitemap.xml", context());
    assert.ok(sitemapChecks(parsed, document.length).some((check) => check.id === "sitemap-entries" && check.category === "error"), root);
  }
});

test("sitemap locations reject malformed escapes and unescaped forbidden ASCII while allowing Unicode IRIs", async () => {
  const iriPrefix = "https://example.com/";
  const maximumIri = iriPrefix + "😀".repeat(2_047 - [...iriPrefix].length);
  const oversizedIri = iriPrefix + "😀".repeat(2_048 - [...iriPrefix].length);
  assert.equal([...maximumIri].length, 2_047);
  assert.equal([...oversizedIri].length, 2_048);
  const document = xml(`
    <url><loc>https://example.com/%ZZ</loc></url>
    <url><loc>https://example.com/{x}</loc></url>
    <url><loc>https://example.com/a[b]</loc></url>
    <url><loc>http://a.b/</loc></url>
    <url><loc>https://example.com/café</loc></url>
    <url><loc>https://[2001:4860:4860::8888]/</loc></url>
    <url><loc>${maximumIri}</loc></url>
    <url><loc>${oversizedIri}</loc></url>
  `);
  const parsed = await parseSitemapDocument(encoder.encode(document), "https://example.com/sitemap.xml", context());
  assert.equal(parsed.invalidLocationCount, 5);
  assert.equal(parsed.validLocationCount, 3);
});

test("sitemap uses XML whitespace only and never erases NBSP", async () => {
  const nbspLocation = xml("<url><loc>\u00a0https://example.com/</loc></url>");
  const parsed = await parseSitemapDocument(encoder.encode(nbspLocation), "https://example.com/sitemap.xml", context());
  assert.equal(parsed.invalidLocationCount, 1);
  const structuralNbsp = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\u00a0<url><loc>https://example.com/</loc></url></urlset>';
  await assert.rejects(parseSitemapDocument(encoder.encode(structuralNbsp), "https://example.com/sitemap.xml", context()), errorCode("invalid_document"));
});

test("sitemap protocol count above 50,000 returns a report instead of a parser-limit error", async () => {
  const document = xml("<url/>".repeat(50_001));
  const parsed = await parseSitemapDocument(encoder.encode(document), "https://example.com/sitemap.xml", {
    signal: new AbortController().signal,
    deadlineMilliseconds: performance.now() + 10_000,
  });
  assert.equal(parsed.entryCount, 50_001);
  assert.ok(sitemapChecks(parsed, document.length).some((check) => check.id === "sitemap-entries" && check.category === "error"));
});

test("gzip decoding is bounded and rejects compression/content mismatches", async () => {
  const document = xml("<url><loc>https://example.com/</loc></url>");
  const compressed = gzipSync(document);
  assert.equal(new TextDecoder().decode(await decodeSitemapBody(compressed, true, context())), document);
  await assert.rejects(decodeSitemapBody(compressed, false, context()), errorCode("unsupported_content"));
  await assert.rejects(
    decodeSitemapBody(gzipSync("x".repeat(2 * 1_024 * 1_024 + 1)), true, context()),
    errorCode("response_too_large"),
  );
});

test("the orchestrator fetches exactly one requested document and never listed targets", async () => {
  const requested = [];
  const document = xml("<url><loc>https://example.com/one</loc></url><url><loc>https://example.com/two</loc></url>");
  const result = await validateRobotsOrSitemap({ kind: "sitemap", url: "https://example.com/sitemap.xml" }, {
    resolveHost: async () => [PUBLIC_V4],
    requestPinned: async (target) => {
      requested.push(target.href);
      return pinnedResponse({ contentType: "application/xml", body: encoder.encode(document) });
    },
  });
  assert.deepEqual(requested, ["https://example.com/sitemap.xml"]);
  assert.equal(result.kind, "sitemap");
  assert.equal(result.sitemap.entryCount, 2);
});

test("robots HTTP failures return typed RFC and Google crawler-specific findings", async () => {
  for (const status of [404, 429, 503]) {
    const result = await validateRobotsOrSitemap({ kind: "robots", url: "https://example.com/", path: "/private", userAgent: "googlebot" }, {
      resolveHost: async () => [PUBLIC_V4],
      requestPinned: async () => pinnedResponse({ status, body: new Uint8Array() }),
    });
    assert.equal(result.kind, "robots");
    assert.equal(result.fetched.status, status);
    assert.equal(result.evaluation.verdict, "unverifiable");
    assert.ok(result.checks.some((check) => check.id === "robots-rfc-http-status"));
    assert.ok(result.checks.some((check) => check.id === "robots-google-http-status"));
  }
});

const builtWorkerUrl = new URL("../dist/server/index.js", import.meta.url);
async function dispatchBuilt(path, init = {}) {
  const { default: worker } = await import(`${builtWorkerUrl.href}?validator=${Date.now()}-${Math.random()}`);
  const headers = new Headers(init.headers);
  const request = new Request(`http://webtaskkit.test${path}`, { ...init, headers });
  return worker.fetch(request, { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}
const apiHeaders = { "content-type": "application/json", origin: "http://webtaskkit.test", "sec-fetch-site": "same-origin" };

test("the built validator API fails closed without echoing submitted inputs", async () => {
  const cases = [
    [{ kind: "robots", url: "http://127.0.0.1/private-canary" }, 400, "blocked_destination"],
    [{ kind: "sitemap", url: "file:///private-canary.xml" }, 400, "invalid_url"],
    [{ kind: "robots", url: "https://example.com/", userAgent: "googlebot" }, 400, "invalid_request"],
    [{ kind: "sitemap", url: "https://example.com/sitemap.xml", extra: true }, 400, "invalid_request"],
  ];
  for (const [payload, status, code] of cases) {
    const response = await dispatchBuilt("/api/robots-sitemap-validator", { method: "POST", headers: apiHeaders, body: JSON.stringify(payload) });
    assert.equal(response.status, status);
    const text = await response.text();
    assert.equal(JSON.parse(text).error, code);
    assert.doesNotMatch(text, /127\.0\.0\.1|private-canary|example\.com/);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
  }
});

test("the built validator API requires same-origin bounded JSON and only POST", async () => {
  assert.equal((await dispatchBuilt("/api/robots-sitemap-validator", { method: "GET" })).status, 405);
  assert.equal((await dispatchBuilt("/api/robots-sitemap-validator", { method: "POST", headers: { ...apiHeaders, origin: "https://attacker.example" }, body: "{}" })).status, 403);
  assert.equal((await dispatchBuilt("/api/robots-sitemap-validator", { method: "POST", headers: { ...apiHeaders, "content-type": "text/plain" }, body: "{}" })).status, 415);
  assert.equal((await dispatchBuilt("/api/robots-sitemap-validator", { method: "POST", headers: apiHeaders, body: "x".repeat(2_201) })).status, 413);
});

test("the client contract prevalidates path syntax and never sends a crawler token without a path", async () => {
  const source = await readFile(new URL("../components/tools/RobotsSitemapValidatorTool.tsx", import.meta.url), "utf8");
  assert.match(source, /optionalAgent && !optionalPath/);
  assert.match(source, /%\(\?!\[0-9a-f\]\{2\}\)/i);
  assert.match(source, /point >= 0xd800 && point <= 0xdfff/);
  assert.match(source, /PRODUCT_TOKEN = \/\^\(\?:\\\*\|\[A-Za-z_-\]\{1,64\}\)\$\//);
  assert.match(source, /!reportExport \? <p[^>]+id="validator-export-limit"[^>]+role="status"/);
  assert.match(source, /aria-describedby=\{!reportExport \? "validator-export-limit" : undefined\}/);
  assert.match(source, /className="sr-only" role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(source, /className="preview-panel robots-sitemap-results" aria-live=/);
});

test("the minimal runtime bundles the complete validator dependency closure", async () => {
  const [externalsText, runtimeImage, entries] = await Promise.all([
    readFile(new URL("../dist/server/vinext-externals.json", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readdir(new URL("../dist/server/_next/static/", import.meta.url)),
  ]);
  assert.deepEqual(JSON.parse(externalsText), []);
  let validatorChunk = null;
  let bundledSources = "";
  for (const entry of entries.filter((name) => name.endsWith(".js"))) {
    const source = await readFile(new URL(`../dist/server/_next/static/${entry}`, import.meta.url), "utf8");
    bundledSources += source;
    if (/^route-.*\.js$/.test(entry) && source.includes("Multiple location hosts")) validatorChunk = source;
  }
  assert.ok(validatorChunk, "expected compiled validator API route chunk");
  assert.match(bundledSources, /Pinned lookup hostname mismatch/);
  assert.match(validatorChunk, /Sitemap protocol namespace/);
  assert.doesNotMatch(validatorChunk, /from["'](?:saxes|xmlchars)["']/);
  assert.doesNotMatch(runtimeImage, /node_modules\/(?:saxes|xmlchars)/);
});
