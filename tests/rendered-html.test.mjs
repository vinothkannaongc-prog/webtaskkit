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
  assert.doesNotMatch(xml, /webtaskkit\.test/);
});

test("server-renders the privacy page", async () => {
  const response = await render("/privacy/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Privacy at WebTaskKit/);
  assert.match(html, /Tool inputs/);
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

test("all eight tools use the minimal best-effort first-party event client", async () => {
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
  ];

  for (const [file, path] of integrations) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.match(source, new RegExp(`useToolEvents\\("${path}"\\)`), file);
    assert.match(source, /trackStart\(\)/, file);
    assert.match(source, /trackComplete\(\)/, file);
    assert.match(source, /trackOutput\(\)/, file);
    assert.match(source, /trackValidationError\(\)/, file);
  }
});

test("production privacy logging maps both file converters only to canonical paths", async () => {
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
  assert.match(loggableMap, /converters\/\(txt-to-pdf\|image-to-pdf\|pdf-to-jpg\)/);
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
