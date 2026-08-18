# WebTaskKit

WebTaskKit is a fast, privacy-minded collection of web utilities. The site includes QR and barcode generators, local PDF conversion, SVG and plain-text editors, a Web Audio tone generator, and a guarded public-page SEO audit.

File and content creation inputs are processed on the visitor's device. The SEO audit sends one public URL to a bounded server fetch and retains neither the submitted URL nor fetched HTML. The site does not require an account or database.

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
