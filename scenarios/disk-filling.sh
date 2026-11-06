#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.19: a filling disk is told once with the three biggest places and one
# deadline, the deadline closes by itself when space is back, and the cleanup routine takes only what is old
# and nobody's.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.19-looks-after-itself/tickets/05-scenarios.md,
# scenario 2), on the Docker server install (the /server line of the stage, as the docker-server job runs it):
#   86%    the daily connection check, run by hand, says one message naming the three biggest folders or
#          files of the server's data folder, and the install holds one new deadline about the disk
#   again  a second run says nothing and opens nothing
#   75%    the next run closes that deadline
#   clean  the cleanup routine, run by hand, on files 40 days old: the old request dumps, session
#          transcripts and run logs go; a note, an archived chat, an unarchived chat, a backup and a file
#          of a session sessions.json still lists, all as old, stay
#
# THE DISK IS A SMALL FILE SYSTEM, NOT A STUB: the server is stopped, its data volume is copied onto an
# ext4 image sized so the volume's present contents are a little under half of it, the image is mounted
# over the volume's folder on the host, and the server is started again. 86% and 75% are then made with
# three files (scenario-big-1 to 3) the scenario writes and shrinks, so the disk reading the check takes is
# the file system's own, whatever call the check makes for it. The three biggest places are measured by
# the scenario itself (du, one level under the data folder) at 86%, and the message has to name those.
# The machine needs sudo, Docker and a loop device; without them this FAILs, it never skips.
#
# WHERE THE OLD FILES LIVE is the assistant's own layout (sessions/, cron/output/, backups/ of its home) and
# the notebook's (Notes/, Chats/ of the mission control); a file the install does not look at stays, so a
# fixture that guesses wrong shows as a PASS for the files that "stay" and a FAIL for the ones that should
# "go". The pull request says so.
#
# No AI is connected: nothing in this scenario talks to a model.
#
#   bash scenarios/disk-filling.sh candidate/2.0.0-beta.19
#   bash scenarios/disk-filling.sh --check <folder>
#
# What it keeps for its checking part:
#   biggest.txt                     the three biggest places at 86%, one name a line
#   df-86.txt / df-75.txt           what the file system said (used and size, in bytes)
#   due-before.json, due-<label>.json   the deadlines before, and after each run: first, second, low
#   <label>-said / -log / -exit     what each run of the connection check said, said to the log, and how it ended
#   planted.txt, after-clean.txt    "<label> present|gone" for each old file, before and after the cleanup
#   clean-said / -log / -exit       the cleanup routine's run
SCENARIO=disk-filling
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

HOME_IN=/opt/data
WORKSPACE_IN=/opt/data/godspeed
KIT_IN=/opt/godspeed/kit
CHECK_ROUTINE='Daily connection check'
CLEAN_PATTERN='clean'

dx() { sudo docker exec -u hermes -e HOME="$HOME_IN" godspeed "$@"; }
# shellcheck disable=SC2329
container_is_healthy() { [ "$(sudo docker inspect -f '{{.State.Health.Status}}' godspeed 2>/dev/null)" = healthy ]; }

# The old files: <label>|<path>|go or stay. Every one is dated 40 days back.
OLD_FILES=(
  "request-dump|$HOME_IN/sessions/request_dump_scenario-old.json|go"
  "session-transcript|$HOME_IN/sessions/session_scenario-old.json|go"
  "run-log|$HOME_IN/cron/output/scenario-job/scenario-old-run.md|go"
  "note|$WORKSPACE_IN/notebook/Notes/scenario-old-note.md|stay"
  "archived-chat|$WORKSPACE_IN/notebook/Chats/Archive/scenario-old-chat.md|stay"
  "unarchived-chat|$WORKSPACE_IN/notebook/Chats/scenario-open-chat.md|stay"
  "backup|$HOME_IN/backups/scenario-old-backup.tar.gz|stay"
  "listed-session-file|$HOME_IN/sessions/session_scenario-listed.json|stay"
)
LISTED_SESSION='
import json, os, sys
path = sys.argv[1]
try:
    data = json.load(open(path, encoding="utf-8"))
except Exception:
    data = {}
data["agent:main:scenario:listed"] = {"session_id": "scenario-listed", "session_key": "agent:main:scenario:listed"}
json.dump(data, open(path, "w", encoding="utf-8"), indent=2)
'

# A small file system over the data volume, as the header says.
small_disk_over_the_volume() {
  local volume baseline size image mnt owner
  volume=$(sudo docker inspect -f '{{range .Mounts}}{{if eq .Destination "/opt/data"}}{{.Source}}{{end}}{{end}}' godspeed)
  [ -n "$volume" ] && sudo test -d "$volume" || fail "the server's data volume ($HOME_IN) has no folder on this machine to put a small disk over"
  VOLUME=$volume
  baseline=$(sudo du -sxB1 "$volume" | cut -f1)
  size=$(( (baseline + 400 * 1048576) * 100 / 86 ))
  size=$(( (size / 1048576 + 1) * 1048576 ))
  [ "$size" -le $((12 * 1073741824)) ] ||
    fail "the server's data already holds $((baseline / 1048576)) MB, so a small disk for it would need $((size / 1048576)) MB, more than this machine is asked for"
  image=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}/disk-filling.img
  mnt=$(mktemp -d)
  say "A $((size / 1048576)) MB disk over $volume (the data holds $((baseline / 1048576)) MB)"
  sudo docker stop godspeed >/dev/null || fail "the server would not stop to get a small disk"
  owner=$(sudo stat -c '%u:%g' "$volume")
  rm -f "$image"
  truncate -s "$size" "$image" &&
    sudo mkfs.ext4 -q -F -m 0 "$image" &&
    sudo mount -o loop "$image" "$mnt" &&
    sudo cp -a "$volume/." "$mnt/" &&
    sudo chown "$owner" "$mnt" &&
    sudo umount "$mnt" &&
    sudo mount -o loop "$image" "$volume" ||
    fail "a small file system could not be made and mounted over the server's data (sudo, mkfs.ext4 and a loop device are needed)"
  rmdir "$mnt"
  sudo docker start godspeed >/dev/null || fail "the server would not start again on its small disk"
  wait_for 300 "the server to be healthy on its small disk" container_is_healthy ||
    fail "the server is not healthy on its small disk"
}

# The disk made to read <percent>% used, by the three files only.
disk_reads() { # <percent> <label>
  local size used ours base add n weight
  size=$(df -B1 --output=size "$VOLUME" | tail -n 1 | tr -d ' ')
  ours=0
  for n in 1 2 3; do
    ours=$(( ours + $(sudo stat -c %s "$VOLUME/scenario-big-$n/blob" 2>/dev/null || echo 0) ))
  done
  used=$(df -B1 --output=used "$VOLUME" | tail -n 1 | tr -d ' ')
  base=$(( used - ours ))
  add=$(( size * $1 / 100 - base ))
  [ "$add" -ge 30000000 ] || fail "the data on the small disk leaves no room to make it read $1%"
  for n in 1 2 3; do
    case $n in 1) weight=50 ;; 2) weight=30 ;; *) weight=20 ;; esac
    sudo mkdir -p "$VOLUME/scenario-big-$n"
    sudo rm -f "$VOLUME/scenario-big-$n/blob"
    sudo fallocate -l $(( add * weight / 100 )) "$VOLUME/scenario-big-$n/blob" ||
      fail "the disk could not be filled to $1%"
  done
  sync
  printf 'used=%s size=%s\n' "$(df -B1 --output=used "$VOLUME" | tail -n 1 | tr -d ' ')" "$size" >"$EVIDENCE/df-$2.txt"
  say "The disk reads: $(cat "$EVIDENCE/df-$2.txt") (wanted $1%)"
}

# A routine's script of the server, run by hand the way the routine runs it, with the assistant's Python.
run_in_the_server() { # <script> <name for the evidence>
  local python code
  python=$(dx cat "$HOME_IN/scripts/godspeed-routines.json" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).hermes_python||""))}catch{}})')
  [ -n "$python" ] || fail "the server's routines name no Python of the assistant's own, so no routine could be run by hand"
  dx test -f "$HOME_IN/scripts/$1" || fail "the server has no routine script $1 in $HOME_IN/scripts"
  say "Running $1 ($2)"
  dx sh -c "cd '$HOME_IN/scripts' && '$python' '$HOME_IN/scripts/$1'" >"$EVIDENCE/$2-said" 2>"$EVIDENCE/$2-log"
  code=$?
  printf '%s\n' "$code" >"$EVIDENCE/$2-exit"
  sed 's/^/  | /' "$EVIDENCE/$2-log" >&2
}
deadlines_now() { # <label>
  dx env GODSPEED_WORKSPACE="$WORKSPACE_IN" node "$KIT_IN/notebook/bin/personal-command.mjs" due state --json >"$EVIDENCE/due-$1.json" ||
    fail "the server's deadlines could not be read ($1)"
}

plant_the_old_files() {
  local entry label path kind python
  : >"$EVIDENCE/planted.txt"
  for entry in "${OLD_FILES[@]}"; do
    IFS='|' read -r label path kind <<<"$entry"
    dx sh -c "mkdir -p \"\$(dirname '$path')\" && printf 'scenario: an old file\n' >'$path' && touch -d '40 days ago' '$path'" ||
      fail "the old file $label could not be made in the server ($path)"
  done
  dx sh -c "touch -d '40 days ago' '$HOME_IN/sessions/session_scenario-listed.json'"
  python=$(dx cat "$HOME_IN/scripts/godspeed-routines.json" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).hermes_python||""))}catch{}})')
  dx "$python" -c "$LISTED_SESSION" "$HOME_IN/sessions/sessions.json" ||
    fail "the session the server's sessions.json is to list could not be written"
  record_files planted.txt
  grep -q ' gone$' "$EVIDENCE/planted.txt" && fail "an old file was gone before the cleanup routine ran: $(grep ' gone$' "$EVIDENCE/planted.txt" | head -n 1)"
}
record_files() { # <file in the evidence>
  local entry label path kind
  : >"$EVIDENCE/$1"
  for entry in "${OLD_FILES[@]}"; do
    IFS='|' read -r label path kind <<<"$entry"
    if dx test -e "$path"; then printf '%s present\n' "$label" >>"$EVIDENCE/$1"; else printf '%s gone\n' "$label" >>"$EVIDENCE/$1"; fi
  done
}

# The routine that cleans, by its name in the server's list of routines.
cleanup_script() {
  dx cat "$HOME_IN/cron/jobs.json" | "$NODE" -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 try{const d=JSON.parse(s);const jobs=Array.isArray(d)?d:d.jobs||[];
  const job=jobs.find(j=>j&&new RegExp(process.argv[1],"i").test(String(j.name||""))&&j.script);
  if(job)process.stdout.write(String(job.script));}catch{}
});' "$CLEAN_PATTERN"
}

routine_script() { # <routine name>
  dx cat "$HOME_IN/cron/jobs.json" | "$NODE" -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
 try{const d=JSON.parse(s);const jobs=Array.isArray(d)?d:d.jobs||[];
  const job=jobs.find(j=>j&&j.name===process.argv[1]&&j.script);
  if(job)process.stdout.write(String(job.script));}catch{}
});' "$1"
}

act() {
  fresh_evidence
  need_node
  command -v sudo >/dev/null 2>&1 || fail "this machine has no sudo, which the server line, the small disk and Docker need"
  say "The server line, from the stage's own address: $STAGE_REF"
  curl -fsSL "$RAW/$STAGE_REF/docker/server/install.sh" |
    sudo env GODSPEED_STAGE_REF="$STAGE_REF" GODSPEED_STAGE_RAW="$RAW" GODSPEED_HOST=localhost bash >&2 ||
    fail "the server line for $STAGE_REF failed before this scenario could do anything (its words are in the step log)"
  wait_for 300 "the server to be healthy" container_is_healthy || fail "the server is not healthy after its install"
  dx test -f "$KIT_IN/notebook/bin/personal-command.mjs" || fail "the server image carries no notebook ($KIT_IN/notebook/bin/personal-command.mjs), so it has no connection check"
  local check_script
  check_script=$(routine_script "$CHECK_ROUTINE")
  [ -n "$check_script" ] || fail "the server has no installed routine named \"$CHECK_ROUTINE\" with a script"
  dx test -f "$HOME_IN/scripts/$check_script" || fail "the installed $CHECK_ROUTINE script is not in $HOME_IN/scripts ($check_script)"
  small_disk_over_the_volume

  deadlines_now before
  disk_reads 86 86
  sudo du -xB1 --max-depth=1 "$VOLUME" | sort -rn | sed '1d;4q' | cut -f2 | xargs -n1 basename >"$EVIDENCE/biggest.txt"
  run_in_the_server "$check_script" first
  deadlines_now first
  run_in_the_server "$check_script" second
  deadlines_now second
  disk_reads 75 75
  run_in_the_server "$check_script" low
  deadlines_now low

  plant_the_old_files
  local script
  script=$(cleanup_script)
  [ -n "$script" ] || fail "the server has no cleanup routine (no routine in $HOME_IN/cron/jobs.json has a name with \"$CLEAN_PATTERN\" and a script)"
  run_in_the_server "$script" clean
  record_files after-clean.txt
}

# ------------------------------------------------------------------------------ what it judges
# The percent a disk-reading file says the disk was at, within two points of the one wanted.
disk_was_at() { # <file> <wanted percent>
  local used size percent
  used=$(sed -n 's/^used=\([0-9]*\) size=.*/\1/p' "$1")
  size=$(sed -n 's/^used=[0-9]* size=\([0-9]*\)$/\1/p' "$1")
  case $used$size in
    '' | *[!0-9]*) fail "$1 does not say how much of the disk was used and how big it was: $(cat "$1")" ;;
  esac
  [ -n "$used" ] && [ -n "$size" ] || fail "$1 does not say how much of the disk was used and how big it was: $(cat "$1")"
  [ "$size" -gt 0 ] || fail "$1 says the disk was 0 bytes big: $(cat "$1")"
  percent=$(( used * 100 / size ))
  [ "$percent" -ge $(( $2 - 2 )) ] && [ "$percent" -le $(( $2 + 2 )) ] ||
    fail "the disk read $percent% ($(cat "$1")) when the connection check ran, not the $2% this part of the scenario is about"
}

check() { # <evidence folder>
  local folder=$1 label name text opened slug title state entry kind before
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a disk"
  need_node
  kept_all "$folder" 'what the check said and opened' biggest.txt df-86.txt df-75.txt due-before.json planted.txt after-clean.txt
  for label in first second low; do
    kept "$folder" "due-$label.json" "the deadlines after the run $label"
    [ -f "$folder/$label-said" ] || fail "$label-said is not in what the scenario kept, so what the check said is unknown"
    [ "$(cat "$folder/$label-exit" 2>/dev/null)" = 0 ] ||
      fail "the connection check ended $(cat "$folder/$label-exit" 2>/dev/null || echo '(never)') in the run $label: $(head -1 "$folder/$label-log" 2>/dev/null)"
  done

  disk_was_at "$folder/df-86.txt" 86
  disk_was_at "$folder/df-75.txt" 75

  # 86%: one message naming the three biggest places, one deadline.
  [ "$(grep -c . "$folder/biggest.txt")" = 3 ] || fail "biggest.txt does not name three places, so the scenario could not tell which are the biggest"
  text=$(tr '\n' ' ' <"$folder/first-said")
  [ -n "${text// /}" ] || fail "the connection check said nothing with the disk at 86%"
  while IFS= read -r name; do
    grep -qF -- "$name" "$folder/first-said" || fail "the message at 86% does not name $name, one of the three biggest places: $text"
  done <"$folder/biggest.txt"
  grep -qi 'disk\|space\|full' "$folder/first-said" ||
    fail "the message at 86% does not say the disk is filling: $text"
  opened=$("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-first.json" "$folder/due-before.json" |
    awk -F'\t' '$1=="open" && tolower($2 $3) ~ /disk|space|storage|full/')
  [ "$(grep -c . <<<"$opened" || true)" = 1 ] ||
    fail "a disk at 86% opened $(grep -c . <<<"$opened" || true) deadlines about the disk, not one"
  title=$(cut -f2 <<<"$opened")
  slug=$(cut -f3 <<<"$opened")

  # The second run says nothing and opens nothing.
  [ -z "$(tr -d '[:space:]' <"$folder/second-said")" ] ||
    fail "the second run of the connection check at 86% said something again: $(tr '\n' ' ' <"$folder/second-said" | cut -c1-200)"
  [ "$("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-second.json" "$folder/due-first.json" | grep -c . || true)" = 0 ] ||
    fail "the second run of the connection check at 86% opened another deadline"

  # 75%: the deadline closes.
  state=$("$NODE" "$HERE/telegram-judge.mjs" state "$folder/due-low.json" "$slug")
  [ "$state" = closed ] || fail "the deadline about the disk (\"$title\") is $state, not closed, with the disk at 75%"

  # The cleanup routine: what was old and nobody's went, the rest stayed.
  [ "$(cat "$folder/clean-exit" 2>/dev/null)" = 0 ] ||
    fail "the cleanup routine ended $(cat "$folder/clean-exit" 2>/dev/null || echo '(never)'): $(head -1 "$folder/clean-log" 2>/dev/null)"
  for entry in "${OLD_FILES[@]}"; do
    IFS='|' read -r label _ kind <<<"$entry"
    state=$(sed -n "s/^$label \\(present\\|gone\\)\$/\\1/p" "$folder/after-clean.txt")
    before=$(sed -n "s/^$label \\(present\\|gone\\)\$/\\1/p" "$folder/planted.txt")
    [ "$before" = present ] || fail "the old file $label was not there before the cleanup routine ran"
    if [ "$kind" = go ]; then
      [ "$state" = gone ] || fail "the cleanup routine left the 40-day-old $label, which it should take"
    else
      [ "$state" = present ] || fail "the cleanup routine took the 40-day-old $label, which it should leave"
    fi
  done

  pass "at 86% the connection check said one message naming the three biggest places ($(tr '\n' ' ' <"$folder/biggest.txt" | sed 's/ $//')) and opened one deadline (\"$title\"); the second run said and opened nothing; at 75% the deadline closed; the cleanup routine took the old request dump, session transcript and run log and left the note, both chats, the backup and the listed session's file"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
