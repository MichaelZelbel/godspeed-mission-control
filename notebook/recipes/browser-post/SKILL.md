---
name: browser-post
description: Use when a Planino browser posting job is queued or named ("post job 12 now", "post the queued browser jobs", the waker's prompt). Posts ONE claimed job to a platform with no API (Substack, Snapchat) through the person's own logged-in Chrome and the Chrome Agent Bridge, following that platform's playbook, verifies the live post, and reports it to Planino with a screenshot. Never composes text, never changes a schedule, never posts anything that is not a claimed job.
---

# Browser post

Planino's browser posting lane. A post on a platform with no API is posted by the person's own AI
through their own logged-in Chrome. Planino froze what to post into a JOB at the time the person
set; this skill takes one job and finishes it. It needs nothing but this folder, a Chrome Agent
Bridge, and the poster token from Planino (Settings, AI poster).

## The envelope, first

- **The job is the authorization.** It exists only because the person set a time on that post in
  Planino. Nothing else is: no job, no post.
- **Only the frozen payload, exactly.** Post what the claim returns. Do not read the post
  anywhere else, do not improve the text, do not add hashtags, do not change the schedule.
  **Media too:** every file in the payload goes in, and nothing that is not in it. The payload is
  what the post's card in Planino shows the person. Deciding that a file does not suit the
  platform is a taste call the person made in Planino, not yours. A file that will not go in is
  `needs_manual`, never a post without it.
- **One job per run.** Claim one, finish it, report it, stop.
- **Only this platform's site** and the poster API. No other site, no other account.
- **Caps:** 40 tool calls, 10 minutes. When either is near, take the screenshot and report
  `needs_manual` with what you saw. A cap that trips is a visible failure, not a stuck job.
- **Verified live URL is the only path to `posted`.** A dialog closing is not a post. Anything
  unclear after the publish click is `needs_manual`, never a retry, because "maybe posted" must
  not be posted twice.
- **If your harness refuses a click** (a safety hook on buttons named Post or Publish, say),
  report `needs_manual` with that sentence. Never route around it.
- **Read pages through the accessibility snapshot**, never the full page text unless the
  snapshot cannot answer, and one screenshot at the end for the report.

## Where things are

- **This folder** is `poster/skill/` in the Chrome Agent Bridge kit. The playbooks are next to
  it: `poster/playbooks/<platform>.md`. The runner passes the kit's path as `POSTER_DIR`.
- **The browser:** the bridge at `$BRIDGE_URL` (bearer `$BRIDGE_TOKEN` when set). With the
  bridge's MCP server loaded, use the `pc_browser_*` tools. Without it, the same calls are HTTP:
  `POST /goto {url}`, `GET /snapshot`, `POST /click-by-role {role,name,exact}`,
  `POST /click {selector}`, `POST /type {selector,text}`, `POST /type-text {text}`,
  `POST /press {key}`, `POST /eval {js}`, `POST /upload-file {url,click|selector,filename}`,
  `GET /screenshot` (a PNG).
- **Planino:** the poster API at `$PLANINO_POSTER_URL`, `Authorization: Bearer
  $PLANINO_POSTER_TOKEN`, all POST with a JSON body: `/claim {job_id?}` returns the job and its
  frozen `payload` (204 when nothing waits); `/report {job_id, result, post_url?, error?,
  screenshot?, metrics?}`. An AI that also has Planino's MCP tools may use
  `claim_browser_job` and `report_browser_job` instead; the rules are the same. Send the report
  through the API when it carries the screenshot: a base64 PNG is too big for a tool argument.

## The steps

1. **Check the browser.** `GET $BRIDGE_URL/health` (or `pc_browser_health`). No answer: report
   nothing, say so, stop. Planino hands an unclaimed job back after thirty minutes with the
   right sentence.
2. **Claim.** The job id you were given, or none for the oldest queued one. Nothing back means
   nothing to do: say so and stop. Keep the `payload` and the job `id`.
3. **Open the playbook** for `payload.platform` and read it whole. No playbook for the platform:
   report `needs_manual` with "No playbook for <platform> yet" and stop.
4. **Already live?** Follow the playbook's "Already posted?" section. If the same post is live
   from the last hour, report `posted` with its URL and stop: an earlier attempt may have died
   after the publish click.
5. **Follow the playbook** one step at a time, snapshot after each action. When the page differs
   from the playbook, work it out from the snapshot, finish, and remember the difference for
   step 8.
6. **Publish**, then read the live URL back the way the playbook says and open it: check the
   title, the date and the last paragraph. Take one screenshot of the final page. Say what you
   are about to click before the publish step when a person is watching.
7. **Report:** `posted` with `post_url`, the screenshot and `metrics` {tool_calls, seconds,
   model: the model you are, harness}; or `needs_manual` with one sentence on what you saw; or
   `failed` with one sentence when nothing was published (Planino queues another attempt, up to
   three). When no live URL can be verified, report `needs_manual`; never report `posted` without it.
8. **Correct the playbook** if anything differed: fix the step, append a dated line under
   "Corrections", and if you can commit to the kit's repository, commit it with one plain
   sentence. A correction is how the next run avoids rediscovering the page.

## What this skill never does

Compose or rewrite text. Change a schedule or a status by hand. Write the post row directly (the
report does that; two writers would disagree). Post to a platform that has an API route. Retry a
publish click.


## This selected installation

These complete rules, platform playbooks, one-job waker and runner scripts are retained from the MIT-licensed Chrome Agent Bridge posting kit; LICENSE carries attribution. The root workflow and poster/skill/SKILL.md have the same full method. Helpers live in poster/ next to this workflow. The actual bridge, account and API are explicitly chosen by the user; this package contains no account URL or user token. Read the configured publication and exact visible account before any action. Historical control names in playbooks require verification against the current visible page before use.

Set GODSPEED_WORKSPACE to this isolated workspace. Keep poster.env in its .godspeed/connectors/browser-post/ device-private folder, or explicitly select another device-private file through GODSPEED_BROWSER_POST_CONFIG. Never put credentials in synced skills. Hermes additionally requires GODSPEED_ASSISTANT_HOME and its explicitly selected HERMES_PROFILE; no personal profile is assumed. Configure RUNNER and BRIDGE_URL for the actual installed helper. The waker uses Node 18 or newer and no npm dependencies; poster/package.json preserves its CommonJS contract inside this ECMAScript-module product.

Run node skills/browser-post/poster/wake.js --once for one configured peek, --checkin for actual health, or without a flag for the owned optional recurring waker. Its scheduled activation remains an explicit separate user choice. A peek/check-in is not a claim, post or proof of authorization. No queued job means no assistant cost and no notification. Fake API/runner tests validate the helper; an actual approved posted result requires a live URL, screenshot and retained job receipt through the full playbook.

Service installers derive a separate name from this exact helper path and refuse an existing different target. They affect only that selected installation. Windows/Linux installation and real browser posting require their own installed acceptance; the retained macOS helper is unverified and makes no tested Mac-support claim. Never run a historical global waker or use another browser session to work around an approval refusal.


## Installed personal workspace

Use the current user workspace and its configured providers. Keep original workflow, command contracts, scripts and verification criteria. Read the workspace authorization rules before sends, sign-ins, payments or publishing. Search existing device-private credentials before asking for configuration. Saved output and a passing screen are not evidence that the full requested result happened.
