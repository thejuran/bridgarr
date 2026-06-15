# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app

# Root workspace files first (layer cached unless lockfile changes)
COPY package.json package-lock.json tsconfig.base.json ./

# Package manifests only — preserves cache when src changes
COPY packages/core/package.json packages/core/
COPY packages/youtube/package.json packages/youtube/

# Install hoisted deps for all workspaces (workspace symlinks + hoisting)
RUN npm ci

# Source files — core must be built before youtube
COPY packages/core/tsconfig.json packages/core/tsconfig.build.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/youtube/tsconfig.json packages/youtube/
COPY packages/youtube/src packages/youtube/src

# Build core then youtube (workspaces respects dependency order), then prune devDeps
RUN npm run build --workspaces --if-present && npm prune --omit=dev

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
# core package.json + dist so the workspace symlink (@bridgarr/core -> ../../packages/core) resolves
COPY --from=build /app/packages/core/package.json /app/packages/core/
COPY --from=build /app/packages/core/dist /app/packages/core/dist
COPY --from=build /app/packages/youtube/dist ./dist
COPY packages/youtube/package.json packages/youtube/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

VOLUME /data
EXPOSE ${PORT:-8485}
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8485}/healthz" || exit 1
CMD ["./docker-entrypoint.sh"]
