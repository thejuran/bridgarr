FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
# yt-dlp from PyPI (Alpine's package lags; the iView extractor needs freshness).
# pycryptodomex: without it yt-dlp delegates AES-128 HLS (all of iView) to
# ffmpeg, which reports no parseable progress — queue percentage sticks at 0.
RUN apk add --no-cache python3 py3-pip ffmpeg \
 && pip install --no-cache-dir --break-system-packages yt-dlp pycryptodomex
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8485 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
VOLUME /data
EXPOSE 8485
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8485/healthz || exit 1
CMD ["node", "dist/index.js"]
