#!/usr/bin/env bash
# What the scenarios of 2.0.0-beta.18 ("numbers come in": phone-health-days, incomplete-day,
# phone-goes-quiet, mail-count, talk-on-talk-day) share beyond scenario-lib.sh, which it needs
# sourced first. The first three drive the Docker server install, because the phone receiver
# (POST /ingest/<token>, issue #214) exists only there.
#
# THE INTERFACES THIS READS FROM THE TICKETS and cannot read from the code until they merge are
# each named once, here, so a ticket that chose differently is one edit:
#   INGEST_PORT       the notebook's port inside the container
#   ingest_token()    where the notebook keeps its token: a file whose name holds "ingest" and
#                     "token", anywhere under the container's state folder
#   health_observations rows: metric, value, observed_on, source (the CSV feed's own shape)
# A scenario that cannot find one of them FAILs saying which, as a scenario for a ticket that has
# not merged is meant to.

. "$(dirname "${BASH_SOURCE[0]}")/server-lib.sh"
# The upload address's token, read where the notebook keeps it.
ingest_token() {
  local found
  found=$(in_server sh -c "find /opt/data -type f -iname '*ingest*token*' 2>/dev/null | head -n 1")
  [ -n "$found" ] || fail "the notebook keeps no phone-upload token anywhere under its state folder (no file named *ingest*token*), so there is no address to upload to"
  in_server cat "$found" | tr -d '[:space:]'
}
# One upload: the body of <file> to /ingest/<token>; prints the HTTP code.
upload() { # <token> <file>
  in_server curl -sS -o /dev/null -w '%{http_code}' --max-time 120 -X POST -H 'Content-Type: application/json' \
    --data-binary @- "http://127.0.0.1:$INGEST_PORT/ingest/$1" <"$2"
}
# --------------------------------------------------------------------- the made-up phone uploads
# Health Auto Export's format as ticket 01 describes it. Every number is invented. The phone's day
# is the date in the point's own string, whatever the offset.
# <file> <json>: kept as plain files in the evidence folder so the scenario's checking part can name
# what was sent.
pt() { printf '{"date":"%s","qty":%s,"source":"Scenario phone"}' "$1" "$2"; }
metric() { # <name> <units> <points, comma separated>
  printf '{"name":"%s","units":"%s","data":[%s]}' "$1" "$2" "$3"
}
workout() { # <id> <name> <start> <end> <seconds> <km>
  printf '{"id":"%s","name":"%s","start":"%s","end":"%s","duration":%s,"distance":{"qty":%s,"units":"km"}}' "$@"
}
upload_body() { # <metrics, comma separated> <workouts, comma separated>
  printf '{"data":{"metrics":[%s],"workouts":[%s]}}\n' "$1" "$2"
}

# --------------------------------------------------------------------- reading rows as plain lines
# "<day> <metric> <value>" for every record of health_observations (source: Health Auto Export).
OBSERVATIONS_AS_LINES='
const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
for(const r of Array.isArray(d)?d:(d.data||[])){
 if(!r||r.is_trashed||r.source!=="Health Auto Export")continue;
 process.stdout.write([r.observed_on,r.metric,r.value].join(" ")+"\n");
}
'
observation_lines() { # <file>
  "$NODE" -e "$OBSERVATIONS_AS_LINES" "$1" | sort
}
# FAILs unless the day record holds exactly this value.
want_day() { # <observation lines file> <day> <metric> <value>
  local got
  got=$(awk -v d="$2" -v m="$3" '$1==d && $2==m {print $3}' "$1")
  [ "$(grep -c . <<<"$got")" -le 1 ] || fail "$3 on $2 has more than one record ($(tr '\n' ' ' <<<"$got"))"
  [ -n "$got" ] || fail "no record of $3 on $2 (the notebook holds: $(awk -v d="$2" '$1==d {print $2}' "$1" | tr '\n' ' '))"
  [ "$got" = "$4" ] || fail "$3 on $2 is $got, not $4"
}
# Succeeds when the talk record holds a non-empty "What you said" or "What he said" section: what
# lib/talks.mjs readTalk calls answered (test-scenarios.sh holds the two to the same corpus).
talk_answered() { # <talk record file>
  awk '/^## /{keep = ($0 ~ /^## What (you|he) said[ \t]*$/); next} keep && /[^ \t\r]/{found=1} END{exit !found}' "$1"
}
# FAILs when the day holds a record of this metric at all.
no_day() { # <observation lines file> <day> <metric> <why>
  ! awk -v d="$2" -v m="$3" '$1==d && $2==m {found=1} END{exit !found}' "$1" || fail "$3 on $2 was written although $4"
}

# The briefing note the morning brief saved last, as plain text, for the scenarios that read it.
NEWEST_BRIEFING_NOTE='
const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const notes=(Array.isArray(d)?d:(d.data||[])).filter(n=>n&&n.source_app==="morning-brief"&&!n.is_trashed)
 .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
const n=notes[notes.length-1];if(!n)process.exit(1);process.stdout.write(String(n.content||""));
'
