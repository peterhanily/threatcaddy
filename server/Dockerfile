FROM node:22-alpine AS build

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY drizzle.config.ts ./
COPY src/ ./src/

RUN npx tsc && find dist -name '*.map' -delete

FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./dist/db/migrations

# Create file storage directory and non-root user
RUN mkdir -p /data/files && \
    addgroup -S app && adduser -S app -G app && \
    chown -R app:app /app /data/files

USER app

EXPOSE 3001

CMD ["node", "dist/index.js"]
