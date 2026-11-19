# Official multi-platform Node 24.22.3 security-release index, verified against Docker Hub on 2026-11-15.
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build

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

FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

WORKDIR /app

COPY package.json package-lock.json ./
# The base image's zlib predates the CVE-2026-4738 fix in Alpine 3.24's 1.4-r0.
# A minimum-version constraint upgrades it, keeps resolving after Alpine replaces
# that revision, and fails the build when no fixed zlib is available.
# Package managers are installation tools, not part of the runtime interface.
# Container maintenance invokes the packaged Node CLIs directly. The runtime
# never loads ssh2's test suite (third-party test private keys that secret
# scanners flag) or the compile cache npm leaves in /tmp; prune them in this
# layer so their bytes never ship.
RUN apk add --no-cache 'zlib>=1.4-r0' && \
    npm install --global npm@11.19.0 && \
    npm ci --omit=dev && \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
        /usr/local/bin/corepack /usr/local/bin/pnpm /usr/local/bin/pnpx && \
    rm -rf /root/.npm /root/.cache/node/corepack /usr/local/share/.cache/yarn \
        node_modules/ssh2/test /tmp/node-compile-cache

COPY --from=build /app/dist ./dist

# Create file storage directory and non-root user. The application code stays
# root-owned and read-only to that user; only file storage is writable.
RUN mkdir -p /data/files && \
    addgroup -S app && adduser -S app -G app && \
    chown -R app:app /data/files

USER app

ENV NODE_ENV=production

EXPOSE 3001 3002

# Reports database and file-storage readiness through the API listener. Docker
# only marks the container unhealthy; it does not restart a running process.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health', { signal: AbortSignal.timeout(8000) }).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "dist/index.js"]
