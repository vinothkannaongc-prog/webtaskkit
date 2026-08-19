# WebTaskKit

WebTaskKit is a fast, privacy-minded collection of web utilities. The site includes QR and barcode generators, local PDF conversion, SVG and plain-text editors, a Web Audio tone generator, a guarded public-page SEO audit, and a robots.txt or XML sitemap validator.

File and content creation inputs are processed on the visitor's device. Each SEO action sends one explicit public document URL to a bounded server fetch and retains neither submitted values nor fetched content. The robots and sitemap tool never automatically fetches declared sitemaps, child sitemaps or listed pages. The site does not require an account or database.

## Development

Requires Node.js 22.13 or newer.

```powershell
npm install
$env:WRANGLER_LOG_PATH='.wrangler/wrangler.log'
npx vinext dev
```

## Validation

```powershell
$env:WRANGLER_LOG_PATH='.wrangler/wrangler.log'
npx vinext build
node --test tests/rendered-html.test.mjs
npx eslint app components lib
```

The project uses vinext and is configured for OpenAI Sites hosting through `.openai/hosting.json`.
