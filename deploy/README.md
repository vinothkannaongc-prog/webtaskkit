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

## Safe update sequence

1. Extract the tracked source into a new immutable release directory.
2. Build the Docker image from that directory. The lockfile is mandatory.
3. Start a temporary container and verify `/` before replacing production.
4. Replace only `webtaskkit_app`, then wait for its Docker health check.
5. Test Nginx with `docker exec offshorefocus_nginx nginx -t` before a graceful
   `nginx -s reload`.
6. Verify the apex, `www` redirect, robots, sitemap, and all six tool routes.

The application has no database, uploaded files, runtime secrets, or writable
state. Rollback is therefore a container replacement using the prior tagged
image.

