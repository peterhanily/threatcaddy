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

RUN npm install --global npm@11.19.0

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
