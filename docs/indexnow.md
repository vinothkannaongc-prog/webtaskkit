# IndexNow operations

WebTaskKit uses a site-specific IndexNow key. The verification file is intentionally public at:

`https://webtaskkit.com/f18459e3755ff46c2215f3d8ce96f916.txt`

The key proves control of this host to participating search engines. It is not a password and must remain reachable as a UTF-8 text file after deployment.

## Safe workflow

The helper is a dry run unless both `--submit` and an exact host confirmation are supplied. It accepts only HTTPS canonical URLs on `webtaskkit.com`, rejects query strings, fragments, credentials, redirects to another sitemap host, duplicate URLs, and local sitemap files outside this repository. Its IndexNow request contains only the host, public key location, and validated canonical URLs; it never includes tool inputs or sitemap metadata.

From this repository:

```powershell
# Read the production sitemap and preview what would change. No submission.
node scripts/indexnow.mjs

# Preview one explicitly changed page. Use this for a changed page whose sitemap entry has no <lastmod>.
node scripts/indexnow.mjs --url https://webtaskkit.com/generators/qr-code

# Submit detected additions, deletions, and changed <lastmod> values.
node scripts/indexnow.mjs --submit --confirm-host webtaskkit.com
```

The first successful submission includes all sitemap URLs. Later runs compare the sitemap against `outputs/indexnow-state.json`, which is ignored by Git. Preserve that state on the operator machine. Removed sitemap URLs are submitted once so search engines can recrawl the deletion. A successful HTTP 200 or 202 response updates state; dry runs and failures do not.

WebTaskKit provides `<lastmod>` only for pages that received a substantive, dated update; unchanged entries deliberately retain no timestamp. The helper compares those selective values with its prior state. For an updated existing page without `<lastmod>`, pass one or more explicit `--url` values. New and removed URLs are still detected automatically. `--all` is available for a deliberate full refresh but should not be used routinely.

For offline validation, pass a sitemap file inside the repository or pipe XML over stdin with `--sitemap -`. Actual submission is never enabled implicitly.

Protocol reference: https://www.indexnow.org/documentation
