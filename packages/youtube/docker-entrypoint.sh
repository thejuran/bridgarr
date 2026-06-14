#!/bin/sh
# YouTube breaks extractors regularly; refresh yt-dlp on every start unless
# disabled (YTDLP_AUTOUPDATE=0). Runs before the privilege drop so it can
# write site-packages. Failure is tolerated — the baked version runs.
if [ "${YTDLP_AUTOUPDATE:-1}" = "1" ]; then
  pip install --no-cache-dir --break-system-packages -U yt-dlp \
    || echo "yt-dlp self-update failed; continuing with the baked version" >&2
fi

# Files land on storage shared with Sonarr/Radarr, which must be able to move
# them — so run as the same user (PUID/PGID, linuxserver convention).
# HOME points at the config volume so yt-dlp's cache has a writable spot.
export HOME="${DATA_DIR:-/data}"
if [ "${PUID:-0}" != "0" ]; then
  chown -R "${PUID}:${PGID:-${PUID}}" "${DATA_DIR:-/data}"
  exec su-exec "${PUID}:${PGID:-${PUID}}" node dist/index.js
fi
exec node dist/index.js
