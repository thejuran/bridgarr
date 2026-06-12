FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
# yt-dlp from PyPI (Alpine's package lags; the YouTube extractor needs
# freshness — see docker-entrypoint.sh for the on-start refresh).
RUN apk add --no-cache python3 py3-pip ffmpeg su-exec \
 && pip install --no-cache-dir --break-system-packages yt-dlp
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8485 \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
VOLUME /data
EXPOSE 8485
HEALTHCHECK --interval=60s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8485/healthz || exit 1
CMD ["./docker-entrypoint.sh"]
