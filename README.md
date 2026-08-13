# QuietTools

QuietTools is a fast, private collection of browser utilities. The launch site includes QR and barcode generators, TXT-to-PDF conversion, SVG and plain-text editors, and a Web Audio tone generator.

All tool inputs are processed on the visitor's device. The site does not require an account or a database.

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
