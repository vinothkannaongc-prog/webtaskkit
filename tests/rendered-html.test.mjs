import assert from "node:assert/strict";
import test from "node:test";

const workerUrl = new URL("../dist/server/index.js", import.meta.url);

async function render(path = "/") {
  const importedUrl = new URL(workerUrl);
  importedUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${path}`);
  const { default: worker } = await import(importedUrl.href);
  const environment = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  const context = { waitUntil() {}, passThroughOnException() {} };
  let request = new Request(`http://webtaskkit.test${path}`, { headers: { accept: "text/html" } });
  let response = await worker.fetch(request, environment, context);
  if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
    request = new Request(new URL(response.headers.get("location"), request.url), { headers: { accept: "text/html" } });
    response = await worker.fetch(request, environment, context);
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
  assert.match(html, /https:\/\/webtaskkit\.com\/webtaskkit-og\.png/);
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
    ["/converters/txt-to-pdf/", "Meeting notes and handoffs", "Markdown symbols are treated as ordinary text", "/editors/text"],
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
    ["/converters/", "Know when TXT to PDF is the right fit", "Inspect before sending", "/editors/text"],
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
  assert.doesNotMatch(xml, /webtaskkit\.test/);
});

test("server-renders the privacy page", async () => {
  const response = await render("/privacy/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Privacy at WebTaskKit/);
  assert.match(html, /Tool inputs/);
});
