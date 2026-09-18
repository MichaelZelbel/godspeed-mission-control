#!/bin/bash
# Give your assistant a phone number.
#
# Chapter 28 put your assistant on a machine that never sleeps, and it can send
# you a brief every morning. What it cannot do is hear you. This script fixes
# that. It installs Hermes, an agent that reads the same folder your assistant
# already uses and answers you on Telegram, so you can hand it a job while you
# are waiting at a bus stop.
#
# YOU PROBABLY DO NOT NEED TO RUN THIS ON ITS OWN. The one-line installer in
# this folder covers Chapters 28 and 29 together, and does everything below as
# part of it:
#
#     curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install.sh | bash
#
# This script stays for two cases: you already built the server by hand and only
# want the Hermes half, or something broke and you want to run just this part
# again. It is the same steps, in the same order.
#
# Run it as the `ai` user you made in Chapter 28, never as root:
#
#     bash install-hermes.sh
#
# It is safe to run twice. Nothing here is destructive, and every step says what
# it is doing before it does it.

set -uo pipefail

HUB="${HUB:-$HOME/hub}"
BRAIN="$HUB/AGENTS.md"

# Hermes reads a profile file up to this many characters and no further.
CEILING=20000
SAFE=19000

# --- The shared install code, pinned -----------------------------------------
# The same primitives the hub installer uses, fetched from an immutable
# tag. They carry the behaviour this script must not re-learn the hard way:
# terminal.cwd is the only lever that moves the agent, a failed one-shot still
# exits 0, and `hermes config set` replaces a list.
LIB_URL="https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/e317893ce2d56efbde2f59f7eeff69d74e429a1e/lib.sh"
KB_TOOLS_REF="${KB_TOOLS_REF:-e5e26ee540628764c6bfefe2d5cfaaa8deae0490}"
export KB_TOOLS_REF
if ! LIB="$(curl -fsSL "$LIB_URL")" || [ -z "$LIB" ]; then
  printf '\n   STOPPED: could not download the shared install code from\n   %s\n   Check the machine has internet, then run this again.\n\n' "$LIB_URL" >&2
  exit 1
fi
eval "$LIB"
unset LIB

# This script's own voice wins over the library's, so these are defined AFTER
# the library loads and the kb_* functions pick them up when they speak.
say()  { printf '\n== %s\n' "$1"; }
ok()   { printf '   ok: %s\n' "$1"; }
warn() { printf '   ATTENTION: %s\n' "$1"; }
die()  { printf '\n   STOPPED: %s\n\n' "$1" >&2; exit 1; }

# --------------------------------------------------------------------------
say "Checking where you are running this"

[ "$(id -u)" -eq 0 ] && die "You are root. Chapter 28 gave your assistant its own
   account for a reason: the account you log in with can destroy the machine, and
   your assistant does not need that. Log in as that user and run this again."

[ -d "$HUB" ] || die "No folder at $HUB. That folder is your assistant's memory,
   the one Chapter 28 put on this machine. Set HUB=/path/to/it and run this again."

ok "running as $(whoami), folder found at $HUB"

# --------------------------------------------------------------------------
# THE CEILING NOBODY TELLS YOU ABOUT.
#
# Hermes puts your AGENTS.md into every single conversation. It reads at least
# 20,000 characters of it (more with a large-context model; the number moves with
# the model), and past its limit it keeps the beginning and the end and drops the
# MIDDLE. Older builds did that silently; 0.20.6 leaves a note in the gap and a
# warning. Either way your assistant runs with a hole in its own instructions
# that nobody chose. 20,000 is the floor every build honours, so that is the wall.
#
# This is checked first, before anything is installed, because it is the single
# most expensive thing on this page to learn the hard way.
say "Checking your instructions still fit"

if [ -f "$BRAIN" ]; then
  N=$(wc -m < "$BRAIN" | tr -d ' ')
  if [ "$N" -ge "$CEILING" ]; then
    die "AGENTS.md is $N characters, over the 20,000 that every Hermes build reads.
   Past its limit Hermes keeps the beginning and the end of the file and drops the
   middle, so your assistant would run with a hole in its instructions. Move
   reference material into its own file, leave a pointer to it, and get this under
   $SAFE characters."
  elif [ "$N" -ge "$SAFE" ]; then
    warn "AGENTS.md is $N characters. It still fits, but it is only $((CEILING - N))
   from the point where Hermes starts dropping the middle of it without telling
   anyone. Move something out before you add anything."
  else
    ok "AGENTS.md is $N characters, $((SAFE - N)) below the line"
  fi
else
  warn "no AGENTS.md in $HUB yet. Hermes will still run; it just will not know
   anything about you until you write one."
fi

# --------------------------------------------------------------------------
# WHAT THE MACHINE NEEDS BEFORE HERMES WILL GO ON.
#
# Hermes brings almost everything with it: it downloads its own Python and its
# own package tool. Two things it cannot bring are curl and git, because they
# have to be installed by the administrator of the machine.
#
# And here is the part that catches people. Chapter 28 gave your assistant its
# own account ON PURPOSE, with no power to install software. That is the whole
# point of that account. So when the Hermes installer notices git is missing and
# tries `sudo apt install git`, it is refused, exactly as it should be. Nothing
# is broken. It just means the one apt command belongs to you, in your own
# admin account, before you run this.
say "Checking what the machine already has"

# On a normal Ubuntu server all three of these are already there, so this check
# usually just passes and you never think about it again. It exists because when
# one of them IS missing the failure is unreadable: the Hermes installer gets
# most of the way in and then prints "tar (child): xz: Cannot exec", which tells
# you nothing about what to do. One clear sentence now beats that later.
MISSING=""
for tool in curl git xz; do
  command -v "$tool" >/dev/null 2>&1 || MISSING="$MISSING $tool"
done
# xz lives in a package with a different name, which is its own small trap.
PACKAGES="$(printf '%s' "$MISSING" | sed 's/\bxz\b/xz-utils/')"

if [ -n "$MISSING" ]; then
  die "this machine is missing:$MISSING

   Your assistant's account is not allowed to install software, which is correct
   and is why Chapter 28 made it that way. Log out, log back in as the admin
   account you were given with the machine, and run this one line:

       sudo apt update && sudo apt install -y$PACKAGES

   Then log back in as $(whoami) and run this script again."
fi
ok "curl, git and xz are all here"

# --------------------------------------------------------------------------
say "Installing Hermes"

if command -v hermes >/dev/null 2>&1; then
  ok "already installed: $(hermes --version 2>&1 | head -1)"
else
  curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash -s -- --commit db64ddb58eef6aebd0874bcdaad266ca8f6205a0 \
    || die "the installer did not finish. Read what it printed above; it is
   usually a missing build tool, and it names the one it wants."
fi

# Find it by its real path. On a fresh machine Hermes installs into
# ~/.local/bin, which your own shell adds to PATH but cron and systemd do NOT.
# A script that just says `hermes` works when you test it by hand and fails
# every time at three in the morning. So the full path is resolved once, here,
# and written into the service below.
HERMES="$(command -v hermes 2>/dev/null || echo "$HOME/.local/bin/hermes")"
[ -x "$HERMES" ] || die "Hermes is installed but I cannot find the program.
   Look for it with:  ls -l ~/.local/bin/hermes"
ok "found at $HERMES"

say "Installing the tested conversation tools"
command -v node >/dev/null 2>&1 || die "Node.js is missing. Run the server installer as the administrator to install the prerequisites."
kb_install_hub_tools "$HUB" "https://github.com/MichaelZelbel/teach-it-once-kit.git" \
  || die "The tested conversation tools could not be installed. The update is incomplete."
[ -f "$HOME/.local/bin/chat-gateway.js" ] && [ -f "$HOME/.hub/chat/current.json" ] \
  || die "The shared conversation package is missing. The update is incomplete."

# --------------------------------------------------------------------------
say "Pointing Hermes at your folder"

# terminal.cwd is the ONLY setting the agent's tools obey for their working
# folder, measured on this kit's own test server. This step used to set
# `workspace`, which is not a recognised Hermes key: the command succeeded,
# Hermes warned, the warning went to /dev/null, and the reader was told it
# worked while Hermes ignored it entirely. kb_point_hermes_at_hub sets the
# real key and then PROVES the folder is readable with a file read once a
# provider is connected; before the sign-in it says plainly it could not
# check yet.
KB_HERMES_BIN="$HERMES"
export KB_HERMES_BIN
kb_point_hermes_at_hub "$HUB" \
  || warn "read what it said just above. Do not rely on scheduled jobs finding
   your files until this is sorted."

# --------------------------------------------------------------------------
say "Making it start again after a reboot"

# Hermes generates its own service unit, and it is better than the one this
# script used to write by hand, measured on the test server: it carries
# HERMES_HOME, PATH and its self-update coordination flag, it pins
# WorkingDirectory to its own home because a movable folder crash-loops the
# unit before Python even loads, and it detects and reports lingering itself.
# The hub is reached through terminal.cwd, set above, never through the unit.
# ONE GATEWAY PER MACHINE. The one-line installer's root phase installs the
# gateway as a SYSTEM service, and a user service beside it is the dual-unit
# trap: newer Hermes warns "Both user and system gateway services are installed"
# and `hermes gateway status` reports the user unit, so a stopped user unit hides a
# running system one. When the system unit is there, this step leaves it alone.
if [ -f /etc/systemd/system/hermes-gateway.service ]; then
  ok "a system service is already in charge of the gateway (installed as root); not adding a user service beside it"
elif "$HERMES" gateway install --start-on-login --no-start-now; then
  ok "service installed and enabled; it starts with the machine from now on"
else
  warn "could not install the service. Run it by hand and read what it says:
   $HERMES gateway install --start-on-login"
fi

# --------------------------------------------------------------------------
# The one-line installer asks first and hands the answer over in KB_MORNING_BRIEF;
# run by hand, this script keeps its old behaviour and schedules the job.
if [ "${KB_MORNING_BRIEF:-yes}" = "no" ]; then
  say "The morning brief"
  ok "clock: not scheduled, as you asked. When you want the morning brief on this clock, run the one-line installer again and answer yes."
else
say "Scheduling the morning brief"

# This replaces the old brief.sh and its crontab line. The job runs inside
# your folder, because --workdir is the one thing that injects AGENTS.md into
# a scheduled run; Hermes delivers the reply to Telegram itself, chunking
# included; and a morning that fails lands in `hermes cron incidents` instead
# of looking like a quiet one. The job is created now and starts firing the
# moment the gateway below is on; a slot the gateway was down for runs once, late.
brief_status=0
node -e 'try {const fs=require("fs"),p=process.argv[1]; if(!fs.existsSync(p))process.exit(1); const d=JSON.parse(fs.readFileSync(p,"utf8")); process.exit((Array.isArray(d)?d:d.jobs||[]).some(j=>j.name==="morning-brief")?0:1)} catch(e) {process.exit(2)}' \
  "${HERMES_HOME:-$HOME/.hermes}/cron/jobs.json" || brief_status=$?
if [ "$brief_status" -eq 0 ]; then
  ok "your existing morning-brief schedule is unchanged"
elif [ "$brief_status" -eq 1 ]; then
kb_cron_job "$HUB" "morning-brief" "0 6 * * *" \
  "Run the recipe in skills/morning-brief/SKILL.md; on an older hub it lives at .claude/skills/morning-brief/SKILL.md. It writes today's brief into brief/. When it is written, commit and push this folder, then reply with the brief's full text. If the recipe is missing or the brief cannot be written, say exactly that instead of staying quiet: a broken morning must never look like a quiet one." \
  "telegram" || die "The morning brief could not be scheduled."
else
  die "The saved schedule could not be read. It has not been replaced."
fi
fi

# Register the existing or newly created report only after the schedule exists.
node "$HOME/.local/bin/chat-gateway.js" "$HUB" --human \
  || die "Telegram protection could not be configured. Run hub-chat doctor before restarting the gateway."

# --------------------------------------------------------------------------
# The one-line installer prints its own closing block, with the system-service
# restart the by-hand path does not need. Called from there, this script stops here.
[ -n "${KB_CALLED_FROM_INSTALLER:-}" ] && exit 0

say "What is left, and only you can do it"

cat <<NEXT
   Two things need answers that are yours, so this script does not guess them.

   1. Sign Hermes in to your ChatGPT subscription with a code (hermes login is
      deprecated and must not be used), or pick another AI with: $HERMES model

        $HERMES auth add openai-codex --type oauth --no-browser

   2. Connect Telegram, so it can hear you:

        $HERMES gateway setup

      Pick Telegram from the list. It offers two roads: scan a QR code with
      Telegram on your phone, or make the bot yourself with the account called
      BotFather (/newbot, two questions, paste the long token it hands you).
      Then send your new bot any message so it is allowed to answer you.

   After connecting Telegram, run this script again to configure protection.
   Then restart the existing gateway and verify what it loaded:

        $HERMES gateway restart
        hub-chat doctor --require-live

      Read the status from Hermes itself, not from systemctl: a cleanly
      stopped gateway shows as "failed" to systemd, so systemctl cannot tell
      an operator's stop from a crash.

   Then message your bot "what is in my folder?" from your phone. If it
   answers, your assistant has a phone number, and from the next morning the
   brief arrives on it by itself.

NEXT
