# WebTaskKit VPS deployment

WebTaskKit runs as the private `webtaskkit_app` container on the existing
`offshorefocus_network`. The shared `offshorefocus_nginx` container is the only
public ingress and proxies `webtaskkit.com` to port 3000 inside that network.

## Release layout

- Source releases: `/opt/webtaskkit/releases/<git-sha>`
- Current release link: `/opt/webtaskkit/current`
- Docker image: `webtaskkit:<git-sha>` and `webtaskkit:latest`
- Nginx include: `/home/ubuntu/offshorefocus_site/docker/nginx/webtaskkit.conf`
- Certificate: `/home/ubuntu/offshorefocus_site/ssl/certbot/conf/live/webtaskkit.com`
- Renewal wrapper: `/usr/local/sbin/renew-webtaskkit-cert`
- Renewal schedule: `/etc/cron.d/webtaskkit-certbot`

## Safe update sequence

1. Extract the tracked source into a new immutable release directory.
2. Build the Docker image from that directory. The lockfile is mandatory.
3. Start a temporary container and verify `/` before replacing production.
4. Back up the active WebTaskKit Nginx include, install the candidate include,
   test it with `docker exec offshorefocus_nginx nginx -t`, then reload Nginx
   gracefully. At this point the old application safely returns 404 from the
   newly protected exact audit location.
5. Replace only `webtaskkit_app`, then wait for its Docker health check.
6. Verify the apex, `www` redirect, robots, sitemap, all nine tool routes, and
   the versioned `/pdfjs/6.2.108/` worker, CMap, standard-font and WASM assets.

The application has no database, uploaded files, runtime secrets, or writable
state. Rollback is therefore a container replacement using the prior tagged
image. Keep the backed-up Nginx include until public verification completes;
on a verified release failure, restore and syntax-check that include before a
graceful reload, then restore the prior application image if it was replaced.

The SEO audit endpoint is limited to two concurrent upstream requests in the
Nginx include, in addition to its per-client and global request rates. This
keeps aggregate parser memory bounded; preserve and syntax-check the
`webtaskkit_audit_concurrency` zone when promoting the include.

## Privacy-minimized measurement logs

The HTTPS include writes canonical request aggregates and accepted interaction
events under
`/home/ubuntu/offshorefocus_site/docker/nginx/event-logs/webtaskkit/`. The log
formats omit IP addresses, arbitrary URL paths, query strings, referrers,
cookies, user agents and tool contents. The application validates the exact
event and page allowlists before Nginx records a canonical value.

Before enabling the include, confirm the shared Nginx worker UID and GID with
`docker exec offshorefocus_nginx id nginx` (currently `101:101`). Give the
`event-logs` parent and WebTaskKit subdirectory ownership `root:101` with mode
`0750`, and give empty `access.jsonl` and `events.jsonl` files ownership
`101:101` with mode `0640`. The worker group needs directory traversal and the
worker owner needs to reopen rotated files. Install
`deploy/logrotate/webtaskkit` as `/etc/logrotate.d/webtaskkit` with root
ownership and mode `0644`. Validate with `logrotate --debug`, then run
`docker exec offshorefocus_nginx nginx -t` before reloading Nginx. Logs rotate
daily, are compressed and expire after 14 days.

## Privacy-safe aggregate report

`scripts/privacy-log-report.mjs` turns the privacy logs into deterministic
aggregate JSON without printing file names or raw records. Give it an explicit
half-open reporting window and list every active or rotated input exactly once.
Plain JSONL and gzip-compressed rotated files are supported.

```sh
node scripts/privacy-log-report.mjs \
  --since 2026-08-14T09:48:22Z \
  --until 2026-08-15T09:48:22Z \
  --access /home/ubuntu/offshorefocus_site/docker/nginx/event-logs/webtaskkit/access.jsonl \
  --events /home/ubuntu/offshorefocus_site/docker/nginx/event-logs/webtaskkit/events.jsonl
```

Repeat `--access` and `--events` for each rotated file that overlaps the
window. The reporter accepts only the exact deployed site, method, path, status
and event schemas. An unknown or expanded record makes the run fail without
echoing the rejected record. Successful output contains counts, status classes,
5xx rate, request/upstream-latency percentiles and unpaired completed-to-started
event-count ratios. Those ratios are not user- or session-level conversions,
and request counts must not be interpreted as users, visitors or visits.

Each run is limited to 32 files per log type, 64 MiB per compressed input and
64 MiB after decompression, one million combined records, and a reporting
window of at most 31 days. Inputs must be distinct regular files; aliases to the
same physical file are refused. Timestamps require valid calendar dates and
explicit timezones, and records must be strict UTF-8. For Nginx multi-upstream
timings, numeric comma/colon-separated attempts are summed per request; an
empty value or a value containing only dashes is treated as missing.

The event log uses a five-second write buffer. Wait at least five seconds after
the end of the reporting window before reading the active file. The reporter
captures each input's size before reading and excludes later appends, so do not
start a run across daily rotation. If a window crosses a completed rotation,
wait for the Nginx reopen and pass both the rotated file and the active file
exactly once.

The VPS's generic Certbot systemd timer is masked and its package cron entry
intentionally skips systemd hosts. WebTaskKit therefore uses its own twice-daily
renewal entry and reloads the shared Nginx container only after a successful
renewal.

## Once-daily external health evidence

Run `node scripts/public-site-health-report.mjs` from the external desktop
automation once per day. The reporter has no command-line options: its hosts,
URLs, redirects, sitemap URL set, limits and TLS policy are fixed for
`webtaskkit.com`. It sends one request to each HTTP/HTTPS apex and `www`
redirect, plus the HTTPS homepage, robots policy and sitemap. Redirects are not
followed, each request has an eight-second timeout and a bounded response body,
and failures are not retried. It sends no cookies, query strings, referrer,
custom body or operator-supplied headers.

The six HTTP probes and two TLS handshakes run sequentially, so their fixed
eight-second per-probe limits bound one run to 64 seconds plus timer scheduling;
there is no retry loop that can extend the run indefinitely.

The same run performs two TLS handshakes, one for the apex and one for `www`,
using SNI and Node's normal CA and hostname validation. TLS 1.2 or newer is
required, and fewer than 21 days to certificate expiry fails the report. Each
handshake has an absolute eight-second deadline, and its socket is destroyed
immediately after the certificate expiry and negotiated protocol are captured.
The homepage must retain the exact WebTaskKit title, application identity and
one canonical link to `https://webtaskkit.com`. The robots policy must continue
to allow public crawling and name the exact canonical sitemap. The sitemap must
match the current application serializer exactly: all 16 HTTPS URLs in order,
with their current `changefreq` and lexical `priority` values. Invalid XML
characters, comments, CDATA, DTDs, entities, extensions, foreign or unknown
elements, reordered fields and URL query strings or fragments fail closed.

Successful or failed runs emit only aggregate JSON: fixed-site status counts,
bounded timings, minimum certificate lifetime, URL count and fixed failure
codes. IP addresses, DNS answers, certificate serials, headers and response
content are never emitted. A failed contract or probe exits nonzero.

This is once-daily external point-in-time evidence, not continuous monitoring,
an uptime SLA or a replacement for an authorized independent monitor. Each run
deliberately makes six synthetic HTTP requests and two TLS handshakes. A healthy
run contributes three known GETs (homepage, robots and sitemap) to the apex
privacy access aggregate; do not interpret those requests as visits or users.
The Node probe does not execute the Cloudflare Web Analytics browser beacon or
send first-party tool events.

This is not a general-purpose or user-directed URL fetcher. DNS/IP pinning is
therefore deliberately out of scope: every hostname, path and request field is
compiled into the script, HTTPS requires a normally trusted certificate for
that exact SNI hostname, and the three plain-HTTP checks send only an anonymous
`GET /` with no cookies, credentials, query, referrer or body and never follow
the response. A poisoned DNS answer could receive only that fixed empty probe;
it cannot select a target, inherit operator secrets or redirect the reporter to
another address. Response reads remain bounded and raw content is discarded.
