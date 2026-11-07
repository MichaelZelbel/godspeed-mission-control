# How Workouts is built

Node.js 22, no npm packages. `bin/godspeed-workouts.mjs` starts `lib/cli.mjs`.

| File | What it does |
| --- | --- |
| `hevy.mjs` | Hevy's public API: workouts, count, events, user info. Every answer is checked against the shape this add-on knows; a failure is `key`, `changed` or `down`. |
| `rows.mjs` | A workout as the row's cells; the tracker's columns and card. Pure. |
| `tracker.mjs` | The tracker in the notebook, and each row: made, brought level, removed, with the rule for the person's own edits. |
| `notebook.mjs` | The notebook's local door (`/api/query`, and `/mcp` for its web address), as The Clerk uses it. |
| `sync.mjs` | One run: the backfill, the events since the last good run, the daily count check. |
| `notify.mjs` | One message per problem the person can act on. |
| `channels/` | Where messages go: the assistant's own Telegram bot, this computer's notifications. |
| `schedule.mjs` | The hourly run: a systemd timer, a LaunchAgent, a Windows scheduled task. |
| `settings.mjs`, `keys.mjs`, `paths.mjs`, `files.mjs`, `lock.mjs`, `clock.mjs` | The rest. |

## One run

1. One run at a time (`run.lock`).
2. The key from `hevy.json`; none: the run stops and `status` says so.
3. The notebook answers? Not: the run stops quietly; the next hour tries again.
4. Hevy's units (kg or lb, km or mi) are read once and kept, so every row speaks the same.
5. The time zone: the setting, else the notebook's installation, else this machine's.
6. The tracker: the one the state names, else the add-on's own (`source_app`), else one whose card
   names the specialist `workouts`; made when there is none. A column a newer version has is added.
7. Never backfilled: every workout, page by page (10 a page, Hevy's most). Otherwise the events
   since the cursor, oldest first, the last event per workout winning.
8. Once a day: Hevy's count against the live records; different, every workout again, and the rows
   of workouts Hevy no longer has are removed.
9. The cursor becomes the run's start less 15 minutes, only when every row of the run was written.
10. Problems (`notify.mjs`), the state, the log.

## A row and the person's edits

The row's key is the workout's id in the item's `source_id`. The record keeps the item's id, what
the add-on last wrote in each cell (`wrote`), what Hevy last said (`seen`), and the cells that are
the person's (`mine`). A cell whose value is not what was written is the person's from then on;
equal again to what Hevy says (now or at the last run), it is Hevy's again. Every write carries the
row's hash (`expected`): a row the person saves in that moment is refused by the notebook, kept, and
tried again next run, and the cursor waits for it. A row that is gone while the record knows it
was deleted by the person: never made again.

A deletion in Hevy deletes the row through the notebook (its own `removed_at`), unless the row
holds anything of the person's; then the Workout cell gets "(deleted in Hevy)" and the row stays.

## Messages

`state.problems` holds each problem with its first time, last time and the number of runs that saw
it. A problem the person can act on is said once it was seen by two runs, once (`state.told` keeps
`<kind>:<since>`, written before the channels get the message). Hevy or the notebook not answering
is never said.
