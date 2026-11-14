#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.18: a phone's uploads become exact day records.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.18-numbers-come-in, ticket 06 and issue
# #214, ticket 01), on the Docker server install: made-up uploads in Health Auto Export's format
# (never real health data) - overlapping windows, a day re-sent the next morning, a workout sent
# twice, a run and a slow "run" - leave the notebook's day records holding exactly the expected
# totals; a second notebook paired with the server shows the same days after a sync; a wrong token
# answers 404 and stores nothing.
#
# THE DAYS (every number invented; D1 = 2026-11-03, D2 = 2026-11-04):
#   steps   08:00 1000, 09:00 2000, 10:00 3000 and 21:00 500 on D1, 00:09 40 on D2, with the
#           09:00 point in two uploads and all of D1's first three again the next morning: 6500, 40
#   food    4184 kJ: 1000 kcal.   active 300 kcal.   weight 70.0 then 69.5: the last, 69.5
#   sleep   two records on D2, the longer one (7.5 h, 8.0 in bed, 1.5 deep, 1.75 REM, 23:10 to 06:45) wins
#   run     5 km sent twice (the second copy 5.5 km in 33 min wins): run_km 5.5, run_min 33
#   walk    a "Run" of 3 km in 30 min (10:00 min/km): walk_km 3, walk_min 30
#   gym     45 min of strength training: workout_min 45, workout_types naming it
#
#   bash scenarios/phone-health-days.sh candidate/2.0.0-beta.18
#   bash scenarios/phone-health-days.sh --check <folder>
#
# What it keeps for its checking part:
#   uploads.txt            "<name> <HTTP code>" per upload
#   server-days.json       the server's health_observations after the uploads
#   wrong-token.txt        the code a wrong token got, and a missing one
#   before-wrong.json / after-wrong.json   health_observations around the wrong-token upload
#   raw-before.txt / raw-after.txt         the state folder's files holding uploads, around it
#   second-days.json       the second notebook's health_observations after a sync
SCENARIO=phone-health-days
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/numbers-lib.sh
. "$HERE/numbers-lib.sh"
scenario_arguments "$@"

D1=2026-11-03
D2=2026-11-04
SECOND_ROOT=${GODSPEED_SCENARIO_SECOND_ROOT:-$HOME/godspeed-second}
SECOND_PORT=47832

make_uploads() { # the folder the bodies go into
  local f=$1
  # 1: the morning window of D1
  upload_body "$(metric step_count count "$(pt "$D1 08:00:00 +0100" 1000),$(pt "$D1 09:00:00 +0100" 2000)"),$(metric weight_body_mass kg "$(pt "$D1 08:05:00 +0100" 70.0)")" \
    "$(workout w-run Running "$D1 07:00:00 +0100" "$D1 07:30:00 +0100" 1800 5),$(workout w-gym 'Traditional Strength Training' "$D1 18:30:00 +0100" "$D1 19:15:00 +0100" 2700 0)" >"$f/u1.json"
  # 2: an overlapping window: 09:00 again, the new 10:00 point, the last weight; the run changed
  upload_body "$(metric step_count count "$(pt "$D1 09:00:00 +0100" 2000),$(pt "$D1 10:00:00 +0100" 3000)"),$(metric weight_body_mass kg "$(pt "$D1 18:00:00 +0100" 69.5)"),$(metric dietary_energy kJ "$(pt "$D1 12:00:00 +0100" 4184)"),$(metric active_energy kcal "$(pt "$D1 12:00:00 +0100" 300)")" \
    "$(workout w-run Running "$D1 07:00:00 +0100" "$D1 07:33:00 +0100" 1980 5.5),$(workout w-slow Run "$D1 17:00:00 +0100" "$D1 17:30:00 +0100" 1800 3)" >"$f/u2.json"
  # 3: the next morning, D1 re-sent whole with one point more, and D2's first
  upload_body "$(metric step_count count "$(pt "$D1 08:00:00 +0100" 1000),$(pt "$D1 09:00:00 +0100" 2000),$(pt "$D1 10:00:00 +0100" 3000),$(pt "$D1 21:00:00 +0100" 500),$(pt "$D2 00:09:00 +0100" 40)"),$(metric sleep_analysis hr "{\"date\":\"$D2 06:30:00 +0100\",\"asleep\":7.5,\"awake\":0.5,\"core\":4.25,\"deep\":1.5,\"rem\":1.75,\"inBed\":8.0,\"inBedStart\":\"$D1 23:00:00 +0100\",\"inBedEnd\":\"$D2 07:00:00 +0100\",\"sleepStart\":\"$D1 23:10:00 +0100\",\"sleepEnd\":\"$D2 06:45:00 +0100\",\"totalSleep\":7.5,\"source\":\"Scenario phone\"},{\"date\":\"$D2 14:00:00 +0100\",\"asleep\":1.0,\"awake\":0,\"core\":1.0,\"deep\":0,\"rem\":0,\"inBed\":1.0,\"inBedStart\":\"$D2 14:00:00 +0100\",\"inBedEnd\":\"$D2 15:00:00 +0100\",\"sleepStart\":\"$D2 14:00:00 +0100\",\"sleepEnd\":\"$D2 15:00:00 +0100\",\"totalSleep\":1.0,\"source\":\"Scenario phone\"}")" \
    "$(workout w-run Running "$D1 07:00:00 +0100" "$D1 07:33:00 +0100" 1980 5.5)" >"$f/u3.json"
}

act() {
  fresh_evidence
  install_paths
  need_node
  server_install
  local token second_url
  token=$(ingest_token)
  say "The phone's address has a token of ${#token} characters"
  make_uploads "$EVIDENCE"
  : >"$EVIDENCE/uploads.txt"
  for name in u1 u2 u3; do
    printf '%s %s\n' "$name" "$(upload "$token" "$EVIDENCE/$name.json")" >>"$EVIDENCE/uploads.txt"
  done
  # u3 sent again: a phone does that after a failed answer; nothing may count twice
  printf 'u3-again %s\n' "$(upload "$token" "$EVIDENCE/u3.json")" >>"$EVIDENCE/uploads.txt"
  sed 's/^/  | /' "$EVIDENCE/uploads.txt" >&2
  server_table health_observations "$EVIDENCE/server-days.json"

  phase 'a wrong token stores nothing'
  server_table health_observations "$EVIDENCE/before-wrong.json"
  in_server sh -c "find /opt/data -type f \\( -iname '*ingest*' -o -iname '*upload*' \\) -exec sha256sum {} + 2>/dev/null | sort" >"$EVIDENCE/raw-before.txt" || :
  {
    printf 'wrong %s\n' "$(upload "wrong-${token:0:8}" "$EVIDENCE/u1.json")"
    printf 'missing %s\n' "$(upload '' "$EVIDENCE/u1.json")"
  } >"$EVIDENCE/wrong-token.txt"
  server_table health_observations "$EVIDENCE/after-wrong.json"
  in_server sh -c "find /opt/data -type f \\( -iname '*ingest*' -o -iname '*upload*' \\) -exec sha256sum {} + 2>/dev/null | sort" >"$EVIDENCE/raw-after.txt" || :

  phase 'a second notebook paired with the server'
  stand_in_github "$EVIDENCE/github"
  second_url=$STAND_IN_ADDRESS
  pair_the_server "$second_url" "$EVIDENCE/github"
  install_the_stage_line_into "$SECOND_ROOT" "$SECOND_PORT" "$EVIDENCE/second-install.log"
  RUNTIME=$(runtime_of "$SECOND_ROOT")
  need_node
  sync_on "$SECOND_ROOT" configure "$second_url" >"$EVIDENCE/second-configure.json" ||
    fail "the second notebook could not be joined to the repository the server syncs with"
  sync_round "$SECOND_ROOT" second 'brings the server'"'"'s days to the second notebook'
  printf '{"table":"health_observations"}' >"$EVIDENCE/.q.json"
  curl -fsS --max-time 120 -X POST -H 'Content-Type: application/json' --data-binary @"$EVIDENCE/.q.json" \
    "http://127.0.0.1:$SECOND_PORT/api/query" -o "$EVIDENCE/second-days.json" ||
    fail "the second notebook would not answer a query of its health records"
  rm -rf "$EVIDENCE/github" "$EVIDENCE"/.[a-z]*
}

# The server's notebook syncs with the stand-in repository: git reaches it over the docker bridge
# (git daemon on this machine, rewriting the GitHub address inside the container).
pair_the_server() { # <address> <folder of the stand-in repository>
  local base=$2 address=$1 body=$EVIDENCE/.pair.json
  git daemon --base-path="$base" --export-all --enable=receive-pack --reuseaddr --listen=0.0.0.0 --port=9418 "$base" >&2 &
  DAEMON=$!
  trap 'kill "$DAEMON" 2>/dev/null' EXIT
  in_server git config --global "url.git://172.17.0.1:9418/.insteadOf" "https://github.com/godspeed-scenario-stand-in/" ||
    fail "the server could not be told where the stand-in repository is"
  printf '{"url":"%s"}' "$address" >"$EVIDENCE/.pair-ask.json"
  [ "$(server_post /api/sync/configure "$EVIDENCE/.pair-ask.json" "$body")" = 200 ] ||
    fail "the server's notebook would not join the repository it should share with the second notebook: $(tr -d '\n' <"$body" | cut -c1-200)"
  printf '{}' >"$EVIDENCE/.pair-ask.json"
  server_post /api/sync/run "$EVIDENCE/.pair-ask.json" "$body" >/dev/null
}

check() { # <evidence folder>
  local folder=$1 lines
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a phone's uploads"
  need_node
  kept_all "$folder" 'what the uploads and the wrong token did' uploads.txt server-days.json wrong-token.txt before-wrong.json after-wrong.json second-days.json
  [ -f "$folder/raw-before.txt" ] && [ -f "$folder/raw-after.txt" ] || fail "raw-before.txt or raw-after.txt is not in what the scenario kept"

  # Every accepted upload was accepted.
  if grep -v ' 200$' "$folder/uploads.txt" | grep -q .; then
    fail "an upload with the right token was not answered 200: $(grep -v ' 200$' "$folder/uploads.txt" | head -n 1)"
  fi

  lines=$folder/.days.txt
  observation_lines "$folder/server-days.json" >"$lines"
  [ -s "$lines" ] || fail "the server holds no record from Health Auto Export after the uploads"
  # Sums count each point once, however often it was sent.
  want_day "$lines" "$D1" steps 6500
  want_day "$lines" "$D2" steps 40
  want_day "$lines" "$D1" food_kcal 1000
  want_day "$lines" "$D1" active_kcal 300
  want_day "$lines" "$D1" weight_kg 69.5
  # The longest sleep of the day, with its own times.
  want_day "$lines" "$D2" sleep_total_h 7.5
  want_day "$lines" "$D2" sleep_in_bed_h 8
  want_day "$lines" "$D2" sleep_deep_h 1.5
  want_day "$lines" "$D2" sleep_rem_h 1.75
  want_day "$lines" "$D2" sleep_start 23:10
  want_day "$lines" "$D2" sleep_end 06:45
  # A run, a slow "run" and a gym session each land in their own columns, the run as its last copy.
  want_day "$lines" "$D1" run_km 5.5
  want_day "$lines" "$D1" run_min 33
  want_day "$lines" "$D1" walk_km 3
  want_day "$lines" "$D1" walk_min 30
  want_day "$lines" "$D1" workout_min 45
  grep -q "^$D1 workout_types .*[Ss]trength" "$lines" || fail "workout_types on $D1 does not name the strength training"

  # A wrong or missing token answers 404 and stores nothing.
  for word in wrong missing; do
    grep -q "^$word 404$" "$folder/wrong-token.txt" ||
      fail "a $word token was not answered 404: $(grep "^$word " "$folder/wrong-token.txt" | head -n 1)"
  done
  cmp -s <(observation_lines "$folder/before-wrong.json") <(observation_lines "$folder/after-wrong.json") ||
    fail "a wrong token changed the notebook's records"
  cmp -s "$folder/raw-before.txt" "$folder/raw-after.txt" ||
    fail "a wrong token wrote or changed a file under the state folder"

  # The second notebook shows the same days.
  observation_lines "$folder/second-days.json" >"$folder/.second.txt"
  cmp -s "$lines" "$folder/.second.txt" ||
    fail "the second notebook's days differ from the server's after a sync: $(diff "$lines" "$folder/.second.txt" | head -n 4 | tr '\n' ' ')"
  rm -f "$lines" "$folder/.second.txt"
  pass "overlapping windows, a day re-sent and a workout sent twice left exact day records on the server ($D1: 6500 steps, 1000 kcal eaten, 69.5 kg, a 5.5 km run, a 3 km walk, 45 min of gym; $D2: the 7.5 h sleep), the second notebook showed the same days after a sync, and a wrong or missing token answered 404 and stored nothing"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
