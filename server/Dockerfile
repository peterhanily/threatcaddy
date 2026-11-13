# Official multi-platform Node baseline, verified against Docker Hub on 2026-10-30.
FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build

RUN npm install --global npm@11.19.0

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY drizzle.config.ts ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npm run build

FROM node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85

WORKDIR /app

COPY package.json package-lock.json ./
# Alpine 3.24's zlib 1.4-r0 fixes CVE-2026-4738 without changing the Node baseline.
# Package managers are installation tools, not part of the runtime interface.
# Container maintenance invokes the packaged Node CLIs directly.
RUN apk add --no-cache 'zlib=1.4-r0' && \
    npm install --global npm@11.19.0 && \
    npm ci --omit=dev && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
        /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx && \
    rm -rf /root/.npm /root/.cache/node/corepack /usr/local/share/.cache/yarn

COPY --from=build /app/dist ./dist

# Create file storage directory and non-root user
RUN mkdir -p /data/files && \
    addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app /data/files

USER app

EXPOSE 3001 3002

CMD ["node", "dist/index.js"]
