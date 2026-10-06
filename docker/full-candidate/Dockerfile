FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS frontend
ARG REVISION=unknown
ARG USE_VERIFIED_FRONTEND=0
WORKDIR /build
COPY notebook/ui/package*.json ./
RUN npm ci --no-audit --no-fund
COPY notebook/ui/ ./
COPY notebook/scripts/verify-prebuilt-frontend.mjs /verify-prebuilt-frontend.mjs
RUN if [ "$USE_VERIFIED_FRONTEND" = 1 ]; then node /verify-prebuilt-frontend.mjs /build "$REVISION"; else npm run build; fi

# Includes the approved computer-use layer. The digest is immutable.
FROM ghcr.io/michaelzelbel/godspeed-mission-control@sha256:358bf1b87b22898c0bd1a173226004558e41a3d16fc39214ecedab7fb550de20
USER root
RUN uv pip install --python /opt/hermes/.venv/bin/python3 --no-cache faster-whisper==1.2.1
COPY --from=frontend /usr/local/bin/node /usr/local/bin/node
COPY . /opt/godspeed/kit/
COPY --from=frontend /build/dist /opt/godspeed/kit/notebook/ui/dist
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
ENTRYPOINT ["/opt/godspeed/kit/docker/full-candidate/entrypoint.sh"]
CMD []
