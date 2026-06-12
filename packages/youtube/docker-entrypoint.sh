#!/bin/sh
# YouTube breaks extractors regularly; refresh yt-dlp on every start unless
# disabled (YTDLP_AUTOUPDATE=0). Failure is tolerated — the baked version runs.
if [ "${YTDLP_AUTOUPDATE:-1}" = "1" ]; then
  pip install --no-cache-dir --break-system-packages -U yt-dlp \
    || echo "yt-dlp self-update failed; continuing with the baked version" >&2
fi
exec node dist/index.js
