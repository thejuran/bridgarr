# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app

# Root workspace files first (layer cached unless lockfile changes)
COPY package.json package-lock.json tsconfig.base.json ./

# Package manifest only — preserves cache when src changes
COPY packages/youtube/package.json packages/youtube/

# Install hoisted deps for the youtube workspace
RUN npm ci --workspace=@bridgarr/youtube

# Source files
COPY packages/youtube/tsconfig.json packages/youtube/
COPY packages/youtube/src packages/youtube/src

# Build and prune devDeps from root node_modules (runs from /app — prunes hoisted node_modules)
RUN npm run build -w @bridgarr/youtube && npm prune --omit=dev

# ── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine
# yt-dlp from PyPI (Alpine's package lags; the YouTube extractor needs
# freshness — see docker-entrypoint.sh for the on-start refresh).
RUN apk add --no-cache python3 py3-pip ffmpeg su-exec \
 && pip install --no-cache-dir --break-system-packages yt-dlp
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8485 \
    PYTHONUNBUFFERED=1

# WORKDIR matches what docker-entrypoint.sh expects: `node dist/index.js`
WORKDIR /app/packages/youtube

# Hoisted node_modules at /app — Node walks up from /app/packages/youtube to find them
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/youtube/dist ./dist
COPY packages/youtube/package.json packages/youtube/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

VOLUME /data
EXPOSE 8485
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8485/healthz || exit 1
CMD ["./docker-entrypoint.sh"]
