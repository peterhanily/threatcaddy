# Official multi-platform Node baseline, verified against Docker Hub on 2026-10-02.
FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build

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

FROM node:24.21.0-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

# Create file storage directory and non-root user
RUN mkdir -p /data/files && \
    addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app /data/files

USER app

EXPOSE 3001 3002

CMD ["node", "dist/index.js"]
