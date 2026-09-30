# Godspeed Mission Control, as one Docker image.
#
# Built FROM the official Hermes image, which already brings the hard parts: a non-root
# account (hermes, uid 10000), the s6 supervisor that restarts the gateway, Git, Node and
# a browser. This layer adds only what the installer needs and the installer itself, at
# the same pins the one-line server installer uses, so the image and the plain server run
# the same code. Build from the repository root:
#
#   docker build -f docker/Dockerfile -t godspeed-mission-control .
#
# Everything a reader owns lives in one volume, /opt/data. Nothing else in the image is
# writable by the assistant, so an upgrade is: pull the new image, keep the volume.

# Pinned by tag AND digest: a tag can be moved, a digest cannot.
ARG HERMES_IMAGE=nousresearch/hermes-agent:v2026.9.24@sha256:fca358f12efd65bfaaca05884166f15c0e2788375ca30d77061ac1ebc96452b7
FROM ${HERMES_IMAGE}

USER root

# gh signs the machine in to GitHub with a code and creates the private repository; jq
# reads Telegram's answers; age seals the notebook key. The rest is already in the base.
# gh comes from GitHub's own package source (docs/install_linux.md in cli/cli), not Debian's:
# Debian's is 2.46, which does not know `gh auth login --skip-ssh-key`, the flag the shared
# installer (kit-bootstrap ensure_gh_auth) uses. Found on the first real Telegram setup,
# 2026-10-01; the tests stand in for gh, so none of them could see it.
RUN set -eu; \
    mkdir -p -m 755 /etc/apt/keyrings; \
    curl -fsSL -o /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg; \
    chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gh jq age procps; \
    rm -rf /var/lib/apt/lists/*; \
    gh auth login --help | grep -q -- --skip-ssh-key

# supercronic runs the installer's own daily jobs (the prompt archive, the notebook
# sync), which it puts on the clock with `crontab`; a container has no cron daemon.
# Pinned by version and checked against its SHA-256 (the release notes' SHA-1 matched too).
ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.49
RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) sha=a53ae236602c7338aba3fbaff40bda6300eae3b9fedb8261eb06cfe3724430c1 ;; \
      arm64) sha=02aa0cb229ba09050cba6638059dadb9eedc2276632ea43d6a57a2f8c1629dd5 ;; \
      *) echo "no supercronic for ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${TARGETARCH:-amd64}"; \
    echo "$sha  /usr/local/bin/supercronic" | sha256sum -c -; \
    chmod 755 /usr/local/bin/supercronic

# The kit: this repository at the commit being built.
COPY . /opt/godspeed/kit

# kit-bootstrap at the SAME tag server/install.sh pins (its KB_PIN line), read from the
# file rather than written twice, so the two can never disagree.
RUN set -eu; \
    pin="$(sed -n 's/^KB_PIN="\(.*\)"$/\1/p' /opt/godspeed/kit/server/install.sh)"; \
    test -n "$pin"; \
    git clone -q --depth 1 --branch "$pin" https://github.com/MichaelZelbel/kit-bootstrap.git /opt/godspeed/kit-bootstrap; \
    rm -rf /opt/godspeed/kit/.git /opt/godspeed/kit-bootstrap/.git; \
    echo "$pin" > /opt/godspeed/kit-bootstrap/PIN

COPY docker/rootfs/ /
RUN chmod 755 /usr/local/bin/godspeed-setup /usr/local/bin/godspeed-patrol /usr/local/bin/crontab \
              /usr/local/bin/godspeed-telegram-setup \
              /etc/s6-overlay/s6-rc.d/godspeed-patrol/run /etc/s6-overlay/s6-rc.d/godspeed-cron/run \
              /etc/s6-overlay/s6-rc.d/godspeed-upgrade/run /etc/s6-overlay/s6-rc.d/godspeed-telegram-setup/run

# Which image this is, so a new one knows to run the update path once on an old volume.
ARG VERSION=dev
ARG REVISION=unknown
RUN echo "${VERSION}+${REVISION}" > /opt/godspeed/VERSION

# Container mode for the installer, and where it finds what the image carries.
ENV KB_CONTAINER=1 \
    KB_KIT_DIR=/opt/godspeed/kit \
    KB_BOOTSTRAP_DIR=/opt/godspeed/kit-bootstrap \
    GODSPEED=/opt/data/godspeed \
    KB_SYNC_SOURCES=hermes

# Healthy means the supervisor reports the gateway up. Asked through s6 rather than
# through `hermes gateway status`, which starts Python and takes seconds every probe.
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=3 \
  CMD /command/s6-svstat -u /run/service/gateway-default 2>/dev/null | grep -qx true

LABEL org.opencontainers.image.title="Godspeed Mission Control" \
      org.opencontainers.image.description="A personal AI that lives in your own folder and answers on Telegram, confined to one container." \
      org.opencontainers.image.source="https://github.com/MichaelZelbel/godspeed-mission-control" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

CMD ["gateway", "run"]
