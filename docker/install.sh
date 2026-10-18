#!/bin/bash
# =============================================================================
# Godspeed Mission Control in Docker, in one line.
#
# On the server you rented, logged in as root (or as a user who may run docker):
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main/docker/install.sh | bash
#
# What it does: installs Docker if the machine has none, puts compose.yaml in
# /opt/godspeed-mission-control (or ~/godspeed-mission-control without root), starts the
# container, and runs setup inside it, which asks for your Telegram bot and shows two
# sign-in codes. Safe to run again: it updates the image and re-runs setup, which keeps
# what is done.
#
# The container is the whole difference from server/install.sh: your assistant runs
# inside it, as a non-root account, with a CPU and memory limit, and cannot reach the
# rest of the server. docker/README.md has the details.
# =============================================================================
set -euo pipefail

RAW="${GODSPEED_RAW:-https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main}"
if [ "$(id -u)" -eq 0 ]; then DIR="${GODSPEED_DIR:-/opt/godspeed-mission-control}"; else DIR="${GODSPEED_DIR:-$HOME/godspeed-mission-control}"; fi

say()  { printf '\n== %s\n' "$1"; }
ok()   { printf '   ok: %s\n' "$1"; }
die()  { printf '\n   STOPPED: %s\n\n' "$1" >&2; exit 1; }

say "Docker"
if ! command -v docker >/dev/null 2>&1; then
  [ "$(id -u)" -eq 0 ] || die "Docker is not on this machine, and installing it needs the administrator.
   Log in as root and run this same line again."
  echo "   Installing Docker with Docker's own installer (get.docker.com)..."
  curl -fsSL https://get.docker.com | sh >/tmp/godspeed-docker-install.log 2>&1 \
    || die "Docker's installer did not finish. What it said is in /tmp/godspeed-docker-install.log."
  systemctl enable --now docker >/dev/null 2>&1 || true
fi
docker info >/dev/null 2>&1 || die "Docker is installed but does not answer. As root: systemctl start docker
   Without root, your account needs to be in the docker group: usermod -aG docker $(id -un)"
docker compose version >/dev/null 2>&1 || die "Docker is here but its compose plugin is not. As root: apt install docker-compose-plugin"
ok "$(docker --version)"

say "The container"
mkdir -p "$DIR"
cd "$DIR"
if [ -f compose.yaml ] && ! curl -fsSL "$RAW/docker/compose.yaml" | cmp -s - compose.yaml; then
  cp compose.yaml "compose.yaml.$(date +%Y%m%d-%H%M%S)"
  ok "your earlier compose.yaml is kept beside the new one"
fi
curl -fsSL "$RAW/docker/compose.yaml" -o compose.yaml || die "could not download compose.yaml from $RAW"
ok "compose.yaml is in $DIR"
docker compose pull -q
docker compose up -d
printf '   waiting for your assistant to start'
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' godspeed 2>/dev/null)" = healthy ] && break
  printf '.'; sleep 3
done
echo
[ "$(docker inspect -f '{{.State.Health.Status}}' godspeed 2>/dev/null)" = healthy ] \
  || die "the container did not come up. Read: cd $DIR && docker compose logs"
ok "running"

say "Setting it up"
# Setup asks questions, so it needs the keyboard even though this script came through a pipe.
if { : < /dev/tty; } 2>/dev/null; then
  docker compose exec godspeed godspeed-setup < /dev/tty
else
  echo "   There is no keyboard here to answer setup's questions. Run this, in $DIR:"
  echo "     docker compose exec godspeed godspeed-setup"
fi
