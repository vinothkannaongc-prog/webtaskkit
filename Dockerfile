FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    VINEXT_TRUSTED_HOSTS=webtaskkit.com,www.webtaskkit.com

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server.mjs ./server.mjs
COPY --from=build --chown=node:node /app/node_modules/vinext/package.json ./node_modules/vinext/package.json
COPY --from=build --chown=node:node /app/node_modules/vinext/dist ./node_modules/vinext/dist
COPY --from=build --chown=node:node /app/node_modules/react ./node_modules/react

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/', { headers: { Host: 'webtaskkit.com' } }).then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "server.mjs"]

