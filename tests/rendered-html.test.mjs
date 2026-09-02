import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function dispatch(path = "/", init = {}) {
  const importedUrl = new URL(workerUrl);
  importedUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${init.method ?? "GET"}-${path}`);
  const { default: worker } = await import(importedUrl.href);
  const environment = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "text/html");
  const request = new Request(`http://webtaskkit.test${path}`, { ...init, headers });
  return worker.fetch(request, environment, context);
}

async function render(path = "/") {
  let response = await dispatch(path);
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    response = await dispatch(new URL(response.headers.get("location"), `http://webtaskkit.test${path}`).pathname);
  }
  return response;
}

test("server-renders the WebTaskKit home page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /WebTaskKit/);
  assert.match(html, /A practical toolkit/);
  assert.match(html, /QR Code Generator/);
  assert.match(html, /Image to PDF Converter/);
  assert.match(html, /PDF to JPG Converter/);
  assert.match(html, /On-Page SEO Audit/);
  assert.match(html, /Robots\.txt &amp; Sitemap Validator/);
  assert.match(html, /https:\/\/webtaskkit\.com\/webtaskkit-og\.png/);
  assert.match(html, /https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js/);
  assert.match(html, /data-cf-beacon="[^"]*a23077944fb94f7dacc69f53f208f2e9/);
  assert.doesNotMatch(html, /webtaskkit\.test\/webtaskkit-og\.png/);
  assert.doesNotMatch(html, /Building your site|react-loading-skeleton|codex-preview/);
});

test("server-renders a tool page with product content", async () => {
  const response = await render("/generators/qr-code/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Free QR Code Generator/);
  assert.match(html, /How to use/);
  assert.match(html, /QR code/);
  assert.match(html, /runs locally in your browser/i);
  assert.match(html, /FAQPage/);
  assert.match(html, /BreadcrumbList/);
  assert.match(html, /isAccessibleForFree/);
  assert.match(html, /https:\/\/webtaskkit\.com\/generators\/qr-code/);
});

test("server-renders category hubs with index and breadcrumb data", async () => {
  const response = await render("/generators/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /ItemList/);
  assert.match(html, /BreadcrumbList/);
  assert.match(html, /https:\/\/webtaskkit\.com\/generators\/tone/);
});

test("SEO content candidate preserves distinct metadata, heading structure, and navigation", async () => {
  const pages = [
    ["/about/", "About: Free Browser Tools With No Signup | WebTaskKit"],
    ["/privacy/", "Privacy Policy: What We Store and What We Don't | WebTaskKit"],
    ["/seo-tools/", "Free SEO Tools: On-Page Audit and Robots Checker | WebTaskKit"],
  ];
  const decodeText = (value) => value
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/(?:&#x27;|&#39;|&apos;)/g, "'")
    .replace(/&quot;/g, '"');

  for (const [path, expectedTitle] of pages) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    const title = decodeText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
    assert.equal(title, expectedTitle, `${path} should render its final title`);
    assert.ok(title.length >= 50 && title.length <= 65, `${path} title should remain descriptive without being excessive`);

    const canonicalLinks = [...html.matchAll(/<link\b[^>]*>/gi)]
      .map((match) => match[0])
      .filter((tag) => {
        const rel = /\brel=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
        return rel.split(/\s+/).some((value) => value.toLowerCase() === "canonical");
      });
    assert.equal(canonicalLinks.length, 1, `${path} should render exactly one canonical link`);
    const canonicalPath = path === "/" ? "" : path.slice(0, -1);
    assert.match(canonicalLinks[0], new RegExp(`href=["']https://webtaskkit\\.com${canonicalPath}["']`), `${path} should keep its canonical URL`);

    const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
      .map((match) => ({ level: Number(match[1]), text: decodeText(match[2]).trim() }));
    assert.equal(headings.filter(({ level }) => level === 1).length, 1, `${path} should have one h1`);
    for (let index = 1; index < headings.length; index += 1) {
      assert.ok(headings[index].level <= headings[index - 1].level + 1, `${path} should not skip heading levels`);
    }
  }

  const aboutHtml = await (await render("/about/")).text();
  const aboutHeadings = [...aboutHtml.matchAll(/<h([12])\b[^>]*>([\s\S]*?)<\/h\1>/gi)]
    .map((match) => [Number(match[1]), decodeText(match[2]).trim()]);
  assert.deepEqual(aboutHeadings, [
    [1, "Everyday web tasks should be straightforward."],
    [2, "Our product promise"],
    [2, "The problem with most free online tools"],
    [2, "What runs where, exactly"],
    [2, "Built for useful outcomes"],
    [2, "No account required"],
    [2, "What comes next"],
  ]);
  assert.match(aboutHtml, /Eight of the ten tools process their working inputs entirely in your browser/);
  assert.match(aboutHtml, /Some tool code and PDF support assets load on demand/);
  assert.match(aboutHtml, /browsers restrict those cross-origin reads/);
  assert.match(aboutHtml, /Tool inputs are not attached to an account/);
  assert.match(aboutHtml, /<a\b[^>]*href=["']\/privacy["'][^>]*>privacy policy<\/a>/i);

  const seoHubHtml = await (await render("/seo-tools/")).text();
  assert.match(seoHubHtml, /"@type":"ItemList"/);
  assert.match(seoHubHtml, /"@type":"BreadcrumbList"/);
  assert.match(seoHubHtml, /https:\/\/webtaskkit\.com\/seo-tools\/on-page-seo-audit/);
  assert.match(seoHubHtml, /https:\/\/webtaskkit\.com\/seo-tools\/robots-sitemap-validator/);
});

test("server-renders the SEO audit with guarded-fetch copy, sources, and route metadata", async () => {
  const response = await render("/seo-tools/on-page-seo-audit/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /On-Page SEO Audit and Meta Tag Checker/);
  assert.match(html, /does not store the submitted URL or page body/i);
  assert.match(html, /512 KiB uncompressed body limit/);
  assert.match(html, /OWASP SSRF prevention/);
  assert.match(html, /Google title-link guidance/);
  assert.match(html, /https:\/\/webtaskkit\.com\/seo-tools\/on-page-seo-audit/);
  assert.match(html, /FAQPage/);
  assert.match(html, /BreadcrumbList/);
  assert.doesNotMatch(html, /webtaskkit-og\.png/);
});

test("server-renders the robots and sitemap validator with bounded-fetch copy and primary sources", async () => {
  const response = await render("/seo-tools/robots-sitemap-validator/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Robots\.txt Checker &amp; XML Sitemap Validator/);
  assert.match(html, /Choose what to validate/);
  assert.match(html, /Each run fetches exactly one selected public file/);
  assert.match(html, /RFC 9309: Robots Exclusion Protocol/);
  assert.match(html, /Google sitemap guidance/);
  assert.match(html, /up to 100,000 entries/);
  assert.match(html, /more than 50,000 entries is reported as a protocol error/);
  assert.match(html, /https:\/\/webtaskkit\.com\/seo-tools\/robots-sitemap-validator/);
  assert.match(html, /FAQPage/);
  assert.match(html, /BreadcrumbList/);
  assert.doesNotMatch(html, /webtaskkit-og\.png/);
});

test("tool pages explain real workflows, boundaries and contextual next steps", async () => {
  const expectations = [
    ["/generators/qr-code/", "Printed menus and instructions", "A static QR code cannot be redirected", "/editors/text"],
    ["/generators/barcode/", "Internal stock labels", "does not issue, license or register", "/editors/svg"],
    ["/generators/tone/", "Compare a musical pitch", "does not measure acoustic output", "/converters/txt-to-pdf"],
    ["/converters/txt-to-pdf/", "Meeting notes and handoffs", "Markdown symbols are treated as ordinary text", "/converters/image-to-pdf"],
    ["/converters/image-to-pdf/", "Scan a signed packet", "Only still JPEG and PNG files are accepted", "/converters/txt-to-pdf"],
    ["/converters/pdf-to-jpg/", "Share one slide as an image", "Interactive form fields", "/converters/image-to-pdf"],
    ["/editors/svg/", "Repair scaling behavior", "not a substitute for your application", "/generators/barcode"],
    ["/editors/text/", "Clean copied notes", "Nothing is autosaved", "/converters/txt-to-pdf"],
    ["/seo-tools/on-page-seo-audit/", "Review a page before publishing", "does not execute client JavaScript", "/editors/text"],
    ["/seo-tools/robots-sitemap-validator/", "robots.txt", "never fetched or crawled", "/seo-tools/on-page-seo-audit"],
  ];

  for (const [path, example, limitation, linkedPath] of expectations) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, new RegExp(example), `${path} should include a practical example`);
    assert.match(html, new RegExp(limitation, "i"), `${path} should state a meaningful limitation`);
    assert.match(html, new RegExp(`href=["']${linkedPath}["']`), `${path} should include a contextual internal link`);
    assert.match(html, /Useful next steps/);
  }
});

test("category hubs provide selection guidance and cross-category workflows", async () => {
  const expectations = [
    ["/generators/", "Choose a generator by what must read the result", "Define the receiver", "/editors"],
    ["/converters/", "Choose the right path into PDF", "Inspect before sending", "/converters/image-to-pdf"],
    ["/editors/", "Choose the editor that understands the source", "Keep an original", "/converters/txt-to-pdf"],
    ["/seo-tools/", "Choose the SEO check that matches the document", "Check discovery controls", "/seo-tools/robots-sitemap-validator"],
  ];

  for (const [path, guidance, workflow, linkedPath] of expectations) {
    const response = await render(path);
    assert.equal(response.status, 200, path);
    const html = await response.text();
    assert.match(html, new RegExp(guidance));
    assert.match(html, new RegExp(workflow));
    assert.match(html, /Privacy and limits/);
    assert.match(html, new RegExp(`href=["']${linkedPath}["']`));
  }
});

test("sitemap always uses the production origin", async () => {
  const response = await render("/sitemap.xml");
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.match(xml, /https:\/\/webtaskkit\.com\/generators\/qr-code/);
  assert.match(xml, /https:\/\/webtaskkit\.com\/converters\/image-to-pdf/);
  assert.match(xml, /https:\/\/webtaskkit\.com\/converters\/pdf-to-jpg/);
  assert.match(xml, /https:\/\/webtaskkit\.com\/seo-tools\/on-page-seo-audit/);
  assert.match(xml, /https:\/\/webtaskkit\.com\/seo-tools\/robots-sitemap-validator/);
  assert.equal((xml.match(/<lastmod>2026-08-19T03:13:47\.894Z<\/lastmod>/g) ?? []).length, 3);
  assert.equal((xml.match(/<lastmod>2026-09-01T06:50:35\.918Z<\/lastmod>/g) ?? []).length, 3);
  assert.doesNotMatch(xml, /webtaskkit\.test/);
});

test("server-renders the privacy page", async () => {
  const response = await render("/privacy/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Privacy at WebTaskKit/);
  assert.match(html, /Local tool inputs/);
  assert.match(html, /Public-document SEO checks/);
  assert.match(html, /Do not submit private dashboards, signed download links or URLs containing access tokens/);
  assert.match(html, /does not automatically fetch declared sitemaps, child sitemaps or listed pages/i);
  assert.match(html, /Cloudflare Web Analytics/);
  assert.match(html, /does not use cookies/i);
  assert.match(html, /Tool usage events/);
  assert.match(html, /only an allowlisted action name and that tool(?:&apos;|')s canonical page path/i);
  assert.match(html, /does not retain IP addresses, cookies, browser or device identifiers/i);
  assert.match(html, /retained for up to 14 days, then deleted/i);
});

const eventHeaders = {
  "content-type": "application/json; charset=utf-8",
  origin: "http://webtaskkit.test",
  "sec-fetch-site": "same-origin",
};

async function postEvent(payload, headers = eventHeaders) {
  return dispatch("/__events", {
    method: "POST",
    headers,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}

test("event endpoint accepts only allowlisted names and canonical tool paths", async () => {
  const eventNames = ["tool_started", "tool_completed", "output_action", "validation_error"];
  const paths = [
    "/generators/qr-code",
    "/generators/barcode",
    "/generators/tone",
    "/converters/txt-to-pdf",
    "/converters/image-to-pdf",
    "/converters/pdf-to-jpg",
    "/editors/svg",
    "/editors/text",
    "/seo-tools/on-page-seo-audit",
    "/seo-tools/robots-sitemap-validator",
  ];

  for (const event of eventNames) {
    const response = await postEvent({ event, path: paths[0] });
    assert.equal(response.status, 204, event);
    assert.equal(response.headers.get("x-event-name"), event);
    assert.equal(response.headers.get("x-event-path"), paths[0]);
    assert.equal(await response.text(), "");
  }

  for (const path of paths) {
    const response = await postEvent({ event: "tool_started", path });
    assert.equal(response.status, 204, path);
    assert.equal(response.headers.get("x-event-path"), path);
  }
});

test("event endpoint rejects malformed, expanded, oversized, or cross-site records", async () => {
  const invalidPayloads = [
    { event: "unknown", path: "/generators/qr-code" },
    { event: "tool_started", path: "/generators/qr-code?value=secret" },
    { event: "tool_started", path: "/generators/qr-code", value: "secret" },
    { event: "tool_started" },
    ["tool_started", "/generators/qr-code"],
    "{not-json",
  ];

  for (const payload of invalidPayloads) {
    const response = await postEvent(payload);
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("x-event-name"), null);
    assert.equal(response.headers.get("x-event-path"), null);
  }

  const wrongType = await postEvent(
    { event: "tool_started", path: "/generators/qr-code" },
    { ...eventHeaders, "content-type": "text/plain" },
  );
  assert.equal(wrongType.status, 415);

  const crossSite = await postEvent(
    { event: "tool_started", path: "/generators/qr-code" },
    { ...eventHeaders, origin: "https://example.com", "sec-fetch-site": "cross-site" },
  );
  assert.equal(crossSite.status, 403);

  const oversized = await postEvent(JSON.stringify({
    event: "tool_started",
    path: "/generators/qr-code",
    padding: "x".repeat(300),
  }));
  assert.equal(oversized.status, 413);
});

test("event endpoint does not collect through GET or OPTIONS", async () => {
  const getResponse = await dispatch("/__events", { method: "GET" });
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get("x-event-name"), null);

  const optionsResponse = await dispatch("/__events", { method: "OPTIONS" });
  assert.equal(optionsResponse.status, 204);
  assert.equal(optionsResponse.headers.get("x-event-name"), null);
  assert.equal(optionsResponse.headers.get("access-control-allow-origin"), null);
});

test("all ten tools use the minimal best-effort first-party event client", async () => {
  const eventClient = await readFile(new URL("../lib/useToolEvents.ts", import.meta.url), "utf8");
  assert.match(eventClient, /fetch\("\/__events"/);
  assert.match(eventClient, /credentials:\s*"omit"/);
  assert.match(eventClient, /referrerPolicy:\s*"no-referrer"/);
  assert.match(eventClient, /mode:\s*"same-origin"/);
  assert.match(eventClient, /keepalive:\s*true/);
  assert.doesNotMatch(eventClient, /localStorage|sessionStorage|document\.cookie|navigator\.userAgent/);

  const integrations = [
    ["../components/tools/QRCodeTool.tsx", "/generators/qr-code"],
    ["../components/tools/BarcodeTool.tsx", "/generators/barcode"],
    ["../components/tools/ToneGeneratorTool.tsx", "/generators/tone"],
    ["../components/tools/TxtToPdfTool.tsx", "/converters/txt-to-pdf"],
    ["../components/tools/ImageToPdfTool.tsx", "/converters/image-to-pdf"],
    ["../components/tools/PdfToImageTool.tsx", "/converters/pdf-to-jpg"],
    ["../components/tools/SvgEditorTool.tsx", "/editors/svg"],
    ["../components/tools/TextEditorTool.tsx", "/editors/text"],
    ["../components/tools/SeoAuditTool.tsx", "/seo-tools/on-page-seo-audit"],
    ["../components/tools/RobotsSitemapValidatorTool.tsx", "/seo-tools/robots-sitemap-validator"],
  ];

  for (const [file, path] of integrations) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, new RegExp(path.replaceAll("/", "\\/")), file);
    assert.match(source, /useToolEvents\(/, file);
    assert.match(source, /trackStart\(\)/, file);
    assert.match(source, /trackComplete\(\)/, file);
    assert.match(source, /trackOutput\(\)/, file);
    assert.match(source, /trackValidationError\(\)/, file);
  }
  const seoAuditSource = await readFile(new URL("../components/tools/SeoAuditTool.tsx", import.meta.url), "utf8");
  assert.match(seoAuditSource, /STATUS_LABELS\[check\.status\]/);
  assert.match(seoAuditSource, /className="sr-only"/);
});

test("production privacy logging maps converters and SEO tools only to canonical paths", async () => {
  const source = await readFile(new URL("../deploy/nginx/webtaskkit-https.conf", import.meta.url), "utf8");
  const accessMap = /map \$uri \$webtaskkit_access_path \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  const eventMap = /map \$upstream_http_x_event_path \$webtaskkit_event_path \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
  const loggableMap = /map "\$status\|\$webtaskkit_event_name\|\$webtaskkit_event_path" \$webtaskkit_event_loggable \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";

  for (const map of [accessMap, eventMap]) {
    assert.match(map, /^\s*\/converters\/image-to-pdf \/converters\/image-to-pdf;\s*$/m);
    assert.match(map, /^\s*\/converters\/pdf-to-jpg \/converters\/pdf-to-jpg;\s*$/m);
    assert.doesNotMatch(map, /image-to-pdf[?#]/);
    assert.doesNotMatch(map, /pdf-to-jpg[?#]/);
  }
  assert.match(accessMap, /^\s*\/api\/seo-audit \/api\/seo-audit;\s*$/m);
  assert.match(accessMap, /^\s*\/api\/robots-sitemap-validator \/api\/robots-sitemap-validator;\s*$/m);
  for (const map of [accessMap, eventMap]) {
    assert.match(map, /^\s*\/seo-tools\/on-page-seo-audit \/seo-tools\/on-page-seo-audit;\s*$/m);
    assert.match(map, /^\s*\/seo-tools\/robots-sitemap-validator \/seo-tools\/robots-sitemap-validator;\s*$/m);
    assert.doesNotMatch(map, /on-page-seo-audit[?#]/);
    assert.doesNotMatch(map, /robots-sitemap-validator[?#]/);
  }
  assert.match(loggableMap, /converters\/\(txt-to-pdf\|image-to-pdf\|pdf-to-jpg\)/);
  assert.match(loggableMap, /seo-tools\/\(on-page-seo-audit\|robots-sitemap-validator\)/);
  assert.match(loggableMap, /robots-sitemap-validator/);
});

test("both public-document API locations share the aggregate Nginx guards", async () => {
  const nginx = await readFile(new URL("../deploy/nginx/webtaskkit-https.conf", import.meta.url), "utf8");
  const locations = ["seo-audit", "robots-sitemap-validator"].map((name) => {
    const block = new RegExp(`location = /api/${name} \\{([\\s\\S]*?)\\n[ ]{4}\\}`).exec(nginx)?.[1] ?? "";
    assert.notEqual(block, "", name);
    return block;
  });

  for (const location of locations) {
    assert.match(location, /limit_except POST \{ deny all; \}/);
    assert.match(location, /limit_req zone=webtaskkit_audit_client burst=3 nodelay;/);
    assert.match(location, /limit_req zone=webtaskkit_audit_global burst=30 nodelay;/);
    assert.match(location, /limit_conn webtaskkit_audit_concurrency 2;/);
    assert.match(location, /proxy_pass_request_headers off;/);
    assert.match(location, /proxy_read_timeout 15s;/);
    assert.match(location, /add_header Cache-Control "no-store, max-age=0" always;/);
    assert.match(location, /add_header X-Robots-Tag "noindex, nofollow, noarchive" always;/);
    assert.doesNotMatch(location, /\$remote_addr|\$proxy_add_x_forwarded_for|\$http_(?:cookie|authorization|referer|user_agent)/);
  }
  assert.match(locations[0], /client_max_body_size 2200;/);
  assert.match(locations[1], /client_max_body_size 2200;/);
});

test("the PDF converter bundles its worker and decoder assets on the site origin", async () => {
  const root = new URL("../dist/client/pdfjs/6.2.108/", import.meta.url);
  const worker = await stat(new URL("pdf.worker.min.mjs", root));
  assert.ok(worker.isFile());
  assert.ok(worker.size > 1_000_000);

  const [cmaps, fonts, wasm] = await Promise.all([
    readdir(new URL("cmaps/", root)),
    readdir(new URL("standard_fonts/", root)),
    readdir(new URL("wasm/", root)),
  ]);
  assert.ok(cmaps.length >= 160, "expected the packed PDF.js CMap set");
  assert.ok(fonts.length >= 16, "expected the PDF.js standard-font set");
  assert.ok(wasm.includes("openjpeg.wasm"));
  assert.ok(wasm.includes("jbig2.wasm"));
  assert.ok(wasm.includes("qcms_bg.wasm"));
});

test("the PDF converter preflights reads, has one absolute deadline, cancellation, and linked range errors", async () => {
  const source = await readFile(new URL("../components/tools/PdfToImageTool.tsx", import.meta.url), "utf8");
  const metadataCheck = source.indexOf("validatePdfFileMetadata({ name: file.name, sizeBytes: file.size })");
  const fileRead = source.indexOf("await file.arrayBuffer()");
  assert.ok(metadataCheck >= 0 && fileRead > metadataCheck, "metadata must be checked before allocating file bytes");
  assert.match(source, /beginOperation\("inspect"\)/);
  assert.match(source, /beginOperation\("convert"\)/);
  assert.match(source, /createPdfOperationDeadline\(performance\.now\(\), timeoutMilliseconds\)/);
  assert.match(source, /stopOperation\(active\.id, "cancelled"\)/);
  assert.match(source, /\.task\.destroy\(\)/);
  assert.match(source, /\.task\.cancel\(\)/);
  assert.match(source, /setCustomValidity\(pageRangeError\)/);
  assert.match(source, /aria-errormessage=\{pageRangeError \? rangeErrorId : undefined\}/);
  assert.match(source, /\{controlsDisabled \? "Cancel" : "Clear PDF"\}/);
  assert.match(source, /\/pdfjs\/\$\{PDFJS_VERSION\}\//);
  const cancelHandler = source.slice(
    source.indexOf("function cancelCurrentOperation"),
    source.indexOf("async function convertPdf"),
  );
  assert.doesNotMatch(cancelHandler, /trackValidationError|trackComplete|trackOutput/);

  const downloadHandler = source.slice(
    source.indexOf("function initiateDownload"),
    source.indexOf("useEffect(() =>", source.indexOf("function initiateDownload")),
  );
  const objectUrlIndex = downloadHandler.indexOf("URL.createObjectURL");
  const finalGuardIndex = downloadHandler.indexOf("operationIsActive(operation)");
  const clickIndex = downloadHandler.indexOf("link.click()");
  const finishIndex = downloadHandler.indexOf("finishOperation(operation)");
  const clearBusyIndex = downloadHandler.indexOf("setBusy(null)");
  assert.ok(
    objectUrlIndex >= 0
      && finalGuardIndex > objectUrlIndex
      && clickIndex > finalGuardIndex
      && finishIndex > clickIndex
      && clearBusyIndex > finishIndex,
    "download ownership must be guarded after object-URL creation and finished synchronously after click",
  );
  assert.match(downloadHandler, /if \(!operationIsActive\(operation\)\) \{[\s\S]*?URL\.revokeObjectURL\(url\);[\s\S]*?return false;/);

  const conversionHandler = source.slice(source.indexOf("async function convertPdf"));
  assert.equal((conversionHandler.match(/if \(!initiateDownload\(/g) ?? []).length, 2);
  assert.ok(conversionHandler.lastIndexOf("if (!initiateDownload(") < conversionHandler.indexOf("trackComplete()"));
});
