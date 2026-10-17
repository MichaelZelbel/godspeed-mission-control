FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS frontend
ARG REVISION=unknown
ARG USE_VERIFIED_FRONTEND=0
WORKDIR /build/notebook/ui
COPY notebook/ui/package*.json ./
RUN npm ci --no-audit --no-fund
COPY notebook/ui/ ./
# The UI imports shared files from core (habit artwork, the impact scale); prebuilt-frontend.test.mjs checks every import is here.
COPY notebook/core/ ../core/
COPY notebook/scripts/verify-prebuilt-frontend.mjs /verify-prebuilt-frontend.mjs
RUN if [ "$USE_VERIFIED_FRONTEND" = 1 ]; then node /verify-prebuilt-frontend.mjs /build/notebook/ui "$REVISION"; else npm run build; fi

# Includes the approved computer-use layer. The digest is immutable.
FROM ghcr.io/michaelzelbel/godspeed-mission-control@sha256:358bf1b87b22898c0bd1a173226004558e41a3d16fc39214ecedab7fb550de20
USER root
RUN uv pip install --python /opt/hermes/.venv/bin/python3 --no-cache faster-whisper==1.2.1
# A real init as process 1, so every finished program is collected. This image replaces the base's
# own entrypoint (s6-overlay's /init, which collected them), and the base's /usr/bin/tini is a shim
# that only hands on to that /init. With the notebook's supervisor as process 1 nothing collected
# a program whose parent had gone: git 2.47 finishes every fetch by starting its maintenance in the
# background (it detaches), so each sync left one, and on the test server srv1069233 about 6,500 of
# them had piled up by 15 October 2026. Compose's `init: true` did the same, but only where a
# Compose file asked for it, and that server's did not. tini 0.19.0, static, checked by its
# published SHA-256. -s: still collects them when a host init runs in front of it.
RUN curl -fsSLo /usr/local/sbin/tini-static https://github.com/krallin/tini/releases/download/v0.19.0/tini-static-amd64 \
 && echo 'c5b0666b4cb676901f90dfcb37106783c5fe2077b04590973b885950611b30ee  /usr/local/sbin/tini-static' | sha256sum -c - \
 && chmod 755 /usr/local/sbin/tini-static
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
COPY . /opt/godspeed/kit/
COPY --from=frontend /build/notebook/ui/dist /opt/godspeed/kit/notebook/ui/dist
RUN chmod 755 /opt/godspeed/kit/docker/full-candidate/entrypoint.sh && chown -R hermes:hermes /opt/godspeed/kit
ENV GODSPEED_WORKSPACE=/opt/data/full-candidate/workspace \
    GODSPEED_MEDIA_ROOT=/opt/data/full-candidate/media \
    GODSPEED_BIND=0.0.0.0 GODSPEED_PORT=47831 GODSPEED_DEVICE=vps \
    HOME=/opt/data/full-candidate/hermes HERMES_HOME=/opt/data/full-candidate/hermes \
    GODSPEED_FILE_HERMES=0 GODSPEED_NODE=/usr/local/bin/node \
    GODSPEED_ASSISTANT_PUBLISHER=/opt/godspeed/kit/notebook/scripts/save-assistant-state.mjs \
    PYTHONPATH=/opt/godspeed/kit/notebook/assistant-files \
    GODSPEED_COMPUTER=off GODSPEED_ORIGINAL_RUNTIME=on \
    GODSPEED_TELEGRAM=web GODSPEED_TELEGRAM_DIR=/opt/data/full-candidate/telegram
EXPOSE 47831
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:47831/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ARG REVISION=unknown
# The commit this image was built from, so the server can name installers of its own version.
ENV GODSPEED_REVISION=${REVISION}
LABEL org.opencontainers.image.title="Godspeed Mission Control Full Alpha" \
      org.opencontainers.image.revision="${REVISION}" org.opencontainers.image.licenses="MIT AND AGPL-3.0-only"
ENTRYPOINT ["/usr/local/sbin/tini-static", "-s", "--", "/opt/godspeed/kit/docker/full-candidate/entrypoint.sh"]
CMD []
