import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { analyzeSeoHtml } from "../lib/seoAudit.ts";
import {
  fetchAndAuditPublicHtml,
  isPublicInternetAddress,
  resolvePublicAddresses,
  SECURE_HTML_FETCH_LIMITS,
  SecureHtmlFetchError,
  singleResponseHeader,
  validatePublicAuditUrl,
} from "../lib/secureHtmlFetch.ts";

const PUBLIC_V4 = "93.184.216.34";
const OTHER_PUBLIC_V4 = "1.1.1.1";
const htmlBytes = (html) => new TextEncoder().encode(html);

function errorCode(expected) {
  return (error) => {
    assert.ok(error instanceof SecureHtmlFetchError);
    assert.equal(error.code, expected);
    assert.doesNotMatch(error.message, /example|127\.0\.0\.1|canary/i);
    return true;
  };
}

function response(overrides = {}) {
  return {
    status: 200,
    location: null,
    contentType: "text/html; charset=utf-8",
    contentEncoding: null,
    body: htmlBytes(`<!doctype html><html lang="en"><head>
      <title>Example product documentation</title>
      <meta name="description" content="A useful and specific description of this public example page for people deciding whether to visit.">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <link rel="canonical" href="https://example.com/page">
      <meta property="og:title" content="Example product documentation">
      <meta property="og:type" content="website">
      <meta property="og:image" content="https://example.com/image.jpg">
      <meta property="og:url" content="https://example.com/page">
      <meta property="og:description" content="A useful sharing description.">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="Example product documentation">
      <meta name="twitter:description" content="A useful sharing description.">
      <meta name="twitter:image" content="https://example.com/image.jpg">
      <script type="application/ld+json">{"@type":"WebPage"}</script>
    </head><body><h1>Example product documentation</h1><h2>Details</h2>
      <img src="/image.jpg" alt="Product overview"><a href="/details">Details</a>
    </body></html>`),
    connectedAddress: PUBLIC_V4,
    ...overrides,
  };
}

test("classifies public and IANA special-use IPv4 and IPv6 destinations", () => {
  for (const address of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1", "192.88.99.1",
    "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1",
    "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "64:ff9b::1",
    "100::1", "2000::1", "2001::1", "2001:1ff:ffff::1", "2001:db8::1",
    "2001:c000::1", "2002::1", "2003:4000::1", "2420::1", "2500::1",
    "2612::1", "2a20::1", "2c10::1", "2d00::1", "3000::1", "3ffe::1", "3fff::1", "fc00::1",
    "fd00:ec2::254", "fe80::1", "ff02::1",
  ]) assert.equal(isPublicInternetAddress(address), false, address);

  for (const address of [
    "1.1.1.1", "8.8.8.8", PUBLIC_V4,
    "2001:200::1", "2001:3ff:ffff::1", "2001:4860:4860::8888",
    "2003::1", "2003:3fff:ffff::1", "2400::1", "240f:ffff::1",
    "2410::1", "241f:ffff::1", "2600::1", "260f:ffff::1",
    "2610::1", "2610:1ff:ffff::1", "2620::1", "2620:1ff:ffff::1",
    "2630::1", "263f:ffff::1", "2800::1", "280f:ffff::1",
    "2a00::1", "2a0f:ffff::1", "2a10::1", "2a1f:ffff::1",
    "2c00::1", "2c0f:ffff::1", "2606:4700:4700::1111",
  ]) assert.equal(isPublicInternetAddress(address), true, address);
});

test("accepts only conventional public HTTP(S) URL forms", () => {
  assert.equal(validatePublicAuditUrl("https://example.com/page?view=source").href, "https://example.com/page?view=source");
  assert.equal(validatePublicAuditUrl("https://example.com:443/").href, "https://example.com/");
  assert.equal(validatePublicAuditUrl("http://example.com:80/").href, "http://example.com/");
  assert.equal(validatePublicAuditUrl("https://8.8.8.8/").href, "https://8.8.8.8/");

  for (const value of [
    "", " https://example.com", "https://example.com/a b", "https://example.com\\@127.0.0.1/",
    "file:///etc/passwd", "ftp://example.com/", "https://user:pass@example.com/",
    "https://example.com/#secret", "https://example.com:8443/", "http://localhost/",
    "https://service/",
    "http://service.local/", "http://service.internal/", "http://example.test/",
    "http://example.com./", "http://127.1/", "http://2130706433/", "http://0x7f000001/",
    "https://134744072/", "https://0x08080808/", "https://010.010.010.010/", "https://8.8.8/",
    "http://[::1]/", "http://[::ffff:127.0.0.1]/",
  ]) assert.throws(() => validatePublicAuditUrl(value), SecureHtmlFetchError, value);
});

test("analyzes one bounded HTML document without returning its raw body", async () => {
  const rawCanary = "private-body-canary-that-is-not-a-metadata-field";
  const html = new TextDecoder().decode(response().body).replace("</body>", `<p>${rawCanary}</p></body>`);
  const result = await analyzeSeoHtml({
    html,
    finalUrl: "https://example.com/page",
    status: 200,
    contentType: "text/html",
    responseBytes: htmlBytes(html).byteLength,
    redirects: 0,
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.page.title, "Example product documentation");
  assert.equal(result.page.canonical, "https://example.com/page");
  assert.equal(result.page.imagesMissingAlt, 0);
  assert.equal(result.social.openGraph["og:title"], "Example product documentation");
  assert.equal(result.summary.issues, 0);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(rawCanary));
});

test("bounds hostile document depth and JSON-LD syntax/depth work", async () => {
  const deep = `<!doctype html><html><body>${"<div>".repeat(300)}x${"</div>".repeat(300)}</body></html>`;
  await assert.rejects(analyzeSeoHtml({
    html: deep,
    finalUrl: "https://example.com/",
    status: 200,
    contentType: "text/html",
    responseBytes: deep.length,
    redirects: 0,
  }), (error) => error?.code === "too_complex");

  const nestedJson = `${"[".repeat(70)}0${"]".repeat(70)}`;
  const malformed = await analyzeSeoHtml({
    html: `<!doctype html><html><head><title>Useful page title</title><script type='application/ld+json'>{broken</script><script type='application/ld+json'>${nestedJson}</script></head><body><h1>Useful page</h1></body></html>`,
    finalUrl: "https://example.com/",
    status: 200,
    contentType: "text/html",
    responseBytes: 160,
    redirects: 0,
  });
  assert.equal(malformed.checks.find(({ id }) => id === "structured-data")?.status, "warning");
  assert.match(malformed.checks.find(({ id }) => id === "structured-data")?.message ?? "", /invalid or exceeded/);
});

test("treats robots none as noindex and repeated og:image as valid alternatives", async () => {
  const html = new TextDecoder().decode(response().body)
    .replace("</head>", `<meta name="robots" content="none"><meta property="og:image" content="https://example.com/alternate.jpg"></head>`);
  const result = await analyzeSeoHtml({
    html,
    finalUrl: "https://example.com/page",
    status: 200,
    contentType: "text/html",
    responseBytes: html.length,
    redirects: 0,
  });
  assert.equal(result.checks.find(({ id }) => id === "robots")?.status, "warning");
  assert.equal(result.checks.find(({ id }) => id === "open-graph")?.status, "pass");
});

test("preflight permits bounded raw script text containing less-than operators", async () => {
  const script = "if(a<b){value+=1;}".repeat(800);
  assert.ok(script.length > 8 * 1_024);
  const html = `<!doctype html><html lang="en"><head><title>Raw text parser regression</title></head><body><h1>Raw text parser regression</h1><script>${script}</script></body></html>`;
  const result = await analyzeSeoHtml({
    html,
    finalUrl: "https://example.com/",
    status: 200,
    contentType: "text/html",
    responseBytes: html.length,
    redirects: 0,
  });
  assert.equal(result.page.title, "Raw text parser regression");
});

test("ignores inert template contents when evaluating live page signals", async () => {
  const html = `<!doctype html><html lang="en"><head><template><title>Inert title</title><meta name="description" content="Inert description"><link rel="canonical" href="https://example.com/inert"></template></head><body><template><h1>Inert heading</h1><img src="/inert.jpg"><a href="/inert">Inert link</a></template></body></html>`;
  const result = await analyzeSeoHtml({
    html,
    finalUrl: "https://example.com/",
    status: 200,
    contentType: "text/html",
    responseBytes: html.length,
    redirects: 0,
  });
  assert.equal(result.page.title, null);
  assert.equal(result.page.description, null);
  assert.equal(result.page.canonical, null);
  assert.equal(result.page.headings, 0);
  assert.equal(result.page.images, 0);
  assert.equal(result.page.internalLinks, 0);
  for (const id of ["title", "meta-description", "canonical", "h1"]) {
    assert.equal(result.checks.find((check) => check.id === id)?.status, "issue", id);
  }
});

test("resolves relative canonical, link, and Open Graph URLs against the first active base href", async () => {
  const html = `<!doctype html><html lang="en"><head><base href="https://other.example/sub/"><title>Document base regression</title><meta name="description" content="A sufficiently useful description for the document base regression fixture and its expected URL behavior."><link rel="canonical" href="/page"><meta property="og:title" content="Document base regression"><meta property="og:type" content="website"><meta property="og:image" content="image.jpg"><meta property="og:url" content="/page"></head><body><h1>Document base regression</h1><a href="next">Next</a></body></html>`;
  const result = await analyzeSeoHtml({
    html,
    finalUrl: "https://example.com/page",
    status: 200,
    contentType: "text/html",
    responseBytes: html.length,
    redirects: 0,
  });
  assert.equal(result.page.canonical, "https://other.example/page");
  assert.equal(result.page.internalLinks, 0);
  assert.equal(result.page.externalLinks, 1);
  assert.equal(result.checks.find((check) => check.id === "canonical")?.status, "warning");
  assert.equal(result.social.openGraph["og:url"], "/page");
  assert.match(result.checks.find((check) => check.id === "open-graph-urls")?.evidence ?? "", /^https:\/\/other\.example\//);

  const invalidBaseHtml = html.replace("https://other.example/sub/", "file:///private/");
  const fallback = await analyzeSeoHtml({
    html: invalidBaseHtml,
    finalUrl: "https://example.com/page",
    status: 200,
    contentType: "text/html",
    responseBytes: invalidBaseHtml.length,
    redirects: 0,
  });
  assert.equal(fallback.page.canonical, "https://example.com/page");
  assert.equal(fallback.checks.find((check) => check.id === "document-base")?.status, "warning");
});

test("hostile nested and single-token documents fail closed in a bounded subprocess", () => {
  const moduleUrl = new URL("../lib/seoAudit.ts", import.meta.url).href;
  const program = `
    import { analyzeSeoHtml } from ${JSON.stringify(moduleUrl)};
    const nested = "<div>".repeat(47000) + "x" + "</div>".repeat(47000);
    if (nested.length !== 517001) process.exit(11);
    let attributes = "";
    for (let index = 0; attributes.length < 509900; index += 1) attributes += " a" + index;
    const singleToken = "<html" + attributes + ">";
    if (singleToken.length >= 512 * 1024) process.exit(12);
    const wideAdoption = "<!doctype html><html><body><b><div>" + "<!---->".repeat(25000) + "</b></div></body></html>";
    if (wideAdoption.length >= 512 * 1024) process.exit(15);
    for (const html of [nested, singleToken, wideAdoption]) {
      try {
        await analyzeSeoHtml({
          html,
          finalUrl: "https://example.com/",
          status: 200,
          contentType: "text/html",
          responseBytes: html.length,
          redirects: 0,
          deadlineMilliseconds: performance.now() + 500,
        });
        process.exit(13);
      } catch (error) {
        if (error?.code !== "too_complex" && error?.code !== "timeout") process.exit(14);
      }
    }
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    timeout: 4_000,
  });
  assert.equal(child.error?.code, undefined, child.error?.message);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, `unexpected child status; stderr length=${child.stderr.length}`);
});

test("analysis honors an injected monotonic deadline and an in-flight abort between chunks", async () => {
  const input = {
    html: response().body.length ? new TextDecoder().decode(response().body) : "",
    finalUrl: "https://example.com/",
    status: 200,
    contentType: "text/html",
    responseBytes: response().body.length,
    redirects: 0,
  };
  let clock = 0;
  await assert.rejects(analyzeSeoHtml({
    ...input,
    deadlineMilliseconds: 3,
    monotonicNow: () => { clock += 1; return clock; },
    yieldControl: async () => {},
  }), (error) => error?.code === "timeout");

  const controller = new AbortController();
  await assert.rejects(analyzeSeoHtml({
    ...input,
    signal: controller.signal,
    yieldControl: async () => { controller.abort(); },
  }), (error) => error?.code === "aborted");
});

test("resolves every answer, rejects mixed public/private DNS, and preserves classified errors", async () => {
  let requestCalls = 0;
  await assert.rejects(fetchAndAuditPublicHtml("https://example.com/", {
    resolveHost: async () => [PUBLIC_V4, "127.0.0.1"],
    requestPinned: async () => {
      requestCalls += 1;
      return response();
    },
  }), errorCode("blocked_address"));
  assert.equal(requestCalls, 0);

  await assert.rejects(fetchAndAuditPublicHtml("https://example.com/", {
    resolveHost: async () => { throw new SecureHtmlFetchError("dns_failed"); },
    requestPinned: async () => response(),
  }), errorCode("dns_failed"));
});

test("an already-aborted caller signal prevents DNS and request work", async () => {
  const controller = new AbortController();
  controller.abort();
  let resolveCalls = 0;
  let requestCalls = 0;
  await assert.rejects(fetchAndAuditPublicHtml("https://example.com/", {
    signal: controller.signal,
    resolveHost: async () => {
      resolveCalls += 1;
      return [PUBLIC_V4];
    },
    requestPinned: async () => {
      requestCalls += 1;
      return response();
    },
  }), errorCode("aborted"));
  assert.equal(resolveCalls, 0);
  assert.equal(requestCalls, 0);
});

test("aborting DNS actively cancels its per-request resolver", async () => {
  const controller = new AbortController();
  let cancelCalls = 0;
  let outstanding = 0;
  const never = () => {
    outstanding += 1;
    return new Promise(() => {});
  };
  const pending = resolvePublicAddresses("example.com", controller.signal, () => ({
    cancel() {
      cancelCalls += 1;
      outstanding = 0;
    },
    resolve4: never,
    resolve6: never,
  }));
  controller.abort();
  await assert.rejects(pending, errorCode("aborted"));
  assert.ok(cancelCalls >= 1);
  assert.equal(outstanding, 0);
});

test("pins the chosen DNS address and rejects a different connected socket", async () => {
  await assert.rejects(fetchAndAuditPublicHtml("https://example.com/", {
    resolveHost: async () => [PUBLIC_V4],
    requestPinned: async () => response({ connectedAddress: OTHER_PUBLIC_V4 }),
  }), errorCode("blocked_address"));
});

test("revalidates and pins every safe redirect", async () => {
  const resolved = [];
  const requested = [];
  const result = await fetchAndAuditPublicHtml("https://example.com/start", {
    resolveHost: async (hostname) => {
      resolved.push(hostname);
      return [hostname === "example.com" ? PUBLIC_V4 : OTHER_PUBLIC_V4];
    },
    requestPinned: async (target, address) => {
      requested.push([target.href, address]);
      if (target.hostname === "example.com") return response({
        status: 302,
        location: "https://www.example.org/page",
        body: new Uint8Array(),
        connectedAddress: PUBLIC_V4,
      });
      return response({ connectedAddress: OTHER_PUBLIC_V4 });
    },
  });
  assert.deepEqual(resolved, ["example.com", "www.example.org"]);
  assert.deepEqual(requested, [
    ["https://example.com/start", PUBLIC_V4],
    ["https://www.example.org/page", OTHER_PUBLIC_V4],
  ]);
  assert.equal(result.fetched.redirects, 1);
});

test("rejects downgrade, private redirect, missing location, loops, and excess hops", async (t) => {
  await t.test("HTTPS downgrade", async () => {
    await assert.rejects(fetchAndAuditPublicHtml("https://example.com/", {
      resolveHost: async () => [PUBLIC_V4],
      requestPinned: async () => response({ status: 302, location: "http://example.org/", body: new Uint8Array() }),
    }), errorCode("unsafe_redirect"));
  });
  await t.test("private redirect answer", async () => {
    await assert.rejects(fetchAndAuditPublicHtml("https://example.com/", {
      resolveHost: async (hostname) => hostname === "example.com" ? [PUBLIC_V4] : ["169.254.169.254"],
      requestPinned: async () => response({ status: 302, location: "https://metadata.example.org/", body: new Uint8Array() }),
    }), errorCode("blocked_address"));
  });
  await t.test("missing Location", async () => {
    await assert.rejects(fetchAndAuditPublicHtml("https://example.com/", {
      resolveHost: async () => [PUBLIC_V4],
      requestPinned: async () => response({ status: 302, location: null, body: new Uint8Array() }),
    }), errorCode("unsafe_redirect"));
  });
  await t.test("redirect loop", async () => {
    await assert.rejects(fetchAndAuditPublicHtml("https://example.com/one", {
      resolveHost: async () => [PUBLIC_V4],
      requestPinned: async (target) => response({ status: 302, location: target.pathname === "/one" ? "/two" : "/one", body: new Uint8Array() }),
    }), errorCode("too_many_redirects"));
  });
  await t.test("more than three redirects", async () => {
    await assert.rejects(fetchAndAuditPublicHtml("https://example.com/0", {
      resolveHost: async () => [PUBLIC_V4],
      requestPinned: async (target) => response({ status: 302, location: `/${Number(target.pathname.slice(1)) + 1}`, body: new Uint8Array() }),
    }), errorCode("too_many_redirects"));
  });
});

test("rejects duplicate critical headers, compression, oversized bodies, types and statuses", async () => {
  assert.throws(() => singleResponseHeader({ headersDistinct: { location: ["/one", "/two"] } }, "location"), errorCode("network_failed"));
  assert.equal(singleResponseHeader({ headersDistinct: { location: ["/one"] } }, "location"), "/one");

  const fixture = (overrides) => fetchAndAuditPublicHtml("https://example.com/", {
    resolveHost: async () => [PUBLIC_V4],
    requestPinned: async () => response(overrides),
  });
  await assert.rejects(fixture({ contentEncoding: "gzip" }), errorCode("unsupported_content"));
  await assert.rejects(fixture({ body: new Uint8Array(SECURE_HTML_FETCH_LIMITS.maximumRawBodyBytes + 1) }), errorCode("response_too_large"));
  await assert.rejects(fixture({ contentType: "application/pdf" }), errorCode("unsupported_content"));
  await assert.rejects(fixture({ contentType: "application/xhtml+xml" }), errorCode("unsupported_content"));
  await assert.rejects(fixture({ status: 503, body: new Uint8Array() }), errorCode("remote_status"));
});

test("one absolute deadline bounds DNS, response headers, and body work without retrying", async (t) => {
  await t.test("DNS", async () => {
    let calls = 0;
    await assert.rejects(fetchAndAuditPublicHtml("https://example.com/", {
      absoluteTimeoutMilliseconds: 5,
      resolveHost: async () => {
        calls += 1;
        return new Promise(() => {});
      },
      requestPinned: async () => response(),
    }), errorCode("timeout"));
    assert.equal(calls, 1);
  });
  for (const phase of ["headers", "body"]) {
    await t.test(phase, async () => {
      let calls = 0;
      await assert.rejects(fetchAndAuditPublicHtml("https://example.com/", {
        absoluteTimeoutMilliseconds: 5,
        resolveHost: async () => [PUBLIC_V4],
        requestPinned: async () => {
          calls += 1;
          return new Promise(() => {});
        },
      }), errorCode("timeout"));
      assert.equal(calls, 1);
    });
  }
});

const builtWorkerUrl = new URL("../dist/server/index.js", import.meta.url);

async function dispatchBuilt(path, init = {}) {
  const { default: worker } = await import(`${builtWorkerUrl.href}?seo=${Date.now()}-${Math.random()}`);
  const headers = new Headers(init.headers);
  const request = new Request(`http://webtaskkit.test${path}`, { ...init, headers });
  return worker.fetch(
    request,
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

const apiHeaders = {
  "content-type": "application/json",
  origin: "http://webtaskkit.test",
  "sec-fetch-site": "same-origin",
};

test("the built API fails closed before network access and emits no submitted URL", async () => {
  const cases = [
    [{ url: "file:///etc/passwd" }, 400, "invalid_url"],
    [{ url: "http://127.0.0.1/private-canary" }, 400, "blocked_destination"],
    [{ url: "https://example.com:8443/" }, 400, "invalid_url"],
    [{ url: "https://example.com/", extra: "value" }, 400, "invalid_request"],
  ];
  for (const [payload, status, code] of cases) {
    const result = await dispatchBuilt("/api/seo-audit", {
      method: "POST",
      headers: apiHeaders,
      body: JSON.stringify(payload),
    });
    assert.equal(result.status, status);
    const text = await result.text();
    assert.equal(JSON.parse(text).error, code);
    assert.doesNotMatch(text, /127\.0\.0\.1|private-canary|example\.com/);
    assert.equal(result.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(result.headers.get("x-robots-tag") ?? "", /noindex/);
  }
});

test("the built API requires same-origin bounded JSON and only POST", async () => {
  const forbidden = await dispatchBuilt("/api/seo-audit", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ url: "https://example.com/" }),
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await dispatchBuilt("/api/seo-audit", { method: "GET" })).status, 405);
  assert.equal((await dispatchBuilt("/api/seo-audit", {
    method: "POST",
    headers: { ...apiHeaders, "content-type": "text/plain" },
    body: "{}",
  })).status, 415);
  assert.equal((await dispatchBuilt("/api/seo-audit", {
    method: "POST",
    headers: apiHeaders,
    body: "x".repeat(2_201),
  })).status, 413);
});

test("the minimal Node runtime contains the complete bundled audit dependency closure", async () => {
  const [externalsText, runtimeImage, entries] = await Promise.all([
    readFile(new URL("../dist/server/vinext-externals.json", import.meta.url), "utf8"),
    readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
    readdir(new URL("../dist/server/_next/static/", import.meta.url)),
  ]);
  assert.deepEqual(JSON.parse(externalsText), []);

  let auditChunk = null;
  for (const entry of entries.filter((name) => /^route-.*\.js$/.test(name))) {
    const source = await readFile(new URL(`../dist/server/_next/static/${entry}`, import.meta.url), "utf8");
    if (source.includes("Pinned lookup hostname mismatch")) {
      auditChunk = source;
      break;
    }
  }
  assert.ok(auditChunk, "expected the compiled secure audit API route chunk");
  assert.match(auditChunk, /from["']node:dns\/promises["']/);
  assert.match(auditChunk, /from["']node:http["']/);
  assert.match(auditChunk, /from["']node:https["']/);
  assert.match(auditChunk, /missing-doctype/);
  assert.match(auditChunk, /maximumRawBodyBytes/);
  assert.doesNotMatch(auditChunk, /from["'](?:parse5|entities)(?:\/[^"']*)?["']/);

  assert.match(runtimeImage, /COPY --from=build --chown=node:node \/app\/dist \.\/dist/);
  assert.doesNotMatch(runtimeImage, /node_modules\/(?:parse5|entities)/);
});

test("the Nginx and application contracts never forward or log audit inputs", async () => {
  const [nginx, fetcher, route] = await Promise.all([
    readFile(new URL("../deploy/nginx/webtaskkit-https.conf", import.meta.url), "utf8"),
    readFile(new URL("../lib/secureHtmlFetch.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/seo-audit/route.ts", import.meta.url), "utf8"),
  ]);
  const location = /location = \/api\/seo-audit \{([\s\S]*?)\n[ ]{4}\}/.exec(nginx)?.[1] ?? "";
  const logFormats = [...nginx.matchAll(/log_format\s+webtaskkit_privacy_(?:access|event)[\s\S]*?;\n/g)]
    .map((match) => match[0]).join("\n");
  assert.match(location, /proxy_pass_request_headers off;/);
  assert.match(nginx, /limit_conn_zone \$server_name zone=webtaskkit_audit_concurrency:1m;/);
  assert.match(location, /limit_conn webtaskkit_audit_concurrency 2;/);
  assert.match(location, /limit_conn_status 429;/);
  assert.doesNotMatch(location, /proxy_set_header (?:Authorization|Cookie|Referer|User-Agent|Proxy-Authorization)/i);
  assert.match(nginx, /^\s*\/api\/seo-audit \/api\/seo-audit;\s*$/m);
  assert.doesNotMatch(logFormats, /\$request_uri|\$args|\$remote_addr|\$http_referer|\$http_user_agent|\$http_cookie/);
  assert.match(fetcher, /"Accept-Encoding": "identity"/);
  assert.match(fetcher, /maxHeaderSize: SECURE_HTML_FETCH_LIMITS\.maximumHeaderBytes/);
  assert.match(fetcher, /response\.socket\.remoteAddress/);
  assert.doesNotMatch(fetcher, /console\.|process\.stdout|process\.stderr/);
  assert.doesNotMatch(route, /console\.|process\.stdout|process\.stderr/);
});
