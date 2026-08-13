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
