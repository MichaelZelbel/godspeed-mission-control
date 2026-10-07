# Planino waker

Let your own AI post to platforms that have no API (Substack, Snapchat) through your own
logged-in Chrome, from [Planino](https://planino.studio).

Planino queues a post at its scheduled time. This waker asks Planino every couple of minutes
whether a job is waiting and, only then, starts your AI once. Your AI claims the job, posts it
through the Chrome Agent Bridge on this machine following a written playbook for the platform,
verifies the live result, and reports back with a screenshot and what it cost. The waker itself
never touches the browser and never runs an AI on a timer, so an idle account costs nothing.

```
Planino ──(every 2 min: "anything queued?")──▶ waker ──▶ your AI (Claude Code or Hermes)
                                                              │  browser-post skill + playbook
                                                              ▼
                                                 Chrome Agent Bridge ──▶ your logged-in Chrome
```

## Selected installation setup

Read the complete parent SKILL.md and select this installation's workspace, assistant and dedicated posting browser. The Chrome Agent Bridge is an optional separately configured connector, not an included browser or proof of a current sign-in. Verify its actual health and the visible target account. Configure the actual poster API, explicit scheduled-job permission, token and bridge URL using the selected device-private poster.env; no API account default is bundled. Never save keys in skills.

GODSPEED_WORKSPACE identifies this workspace. GODSPEED_BROWSER_POST_CONFIG optionally identifies the selected device-private configuration file. RUNNER selects an included Claude or Hermes runner. Claude reads this workspace's authorization and configured browser tools. Hermes requires GODSPEED_ASSISTANT_HOME and an explicit HERMES_PROFILE for this isolated installation. SUBSTACK_PUBLICATION identifies the actual selected publication.

Use node wake.js --checkin to read actual connector health, or --once to peek and handle at most one approved queued job. The frozen job supplies exact text and media; preparing this package authorizes no post. Activate a platform service only when the user has chosen recurring posting for this installation. Service names are derived from the selected helper path and an existing different target is never replaced. Retained macOS helpers are unverified.

## The poster API the AI uses

All on `Authorization: Bearer pln_poster_...`, all POST, all JSON:

| Call | What it does |
|---|---|
| `/checkin` `{harness, version, bridge_ok}` | Says the poster is alive; Planino shows amber after an hour of silence. |
| `/peek` | `{queued, oldest}` for this account. No side effect. |
| `/claim` `{job_id?}` | Takes the named job, or the oldest queued one. Returns the frozen payload: what to post. 204 when nothing waits. |
| `/report` `{job_id, result, post_url?, error?, screenshot?, snapshot?, metrics?}` | `posted` (with the live URL), `needs_manual` (a person must look; never retried) or `failed` (nothing was published; Planino queues another attempt, up to three). |
| `/metrics` `{job_id, metrics}` | Adds cost and counts onto a finished job. |

An AI holding a Planino MCP token can use the same rules through the MCP tools
`list_browser_jobs`, `claim_browser_job` and `report_browser_job` instead.

## The posting rules

`skill/SKILL.md` is what the AI reads first on every run: the job is the only authorization,
post the frozen payload exactly (text and media, nothing added, nothing dropped), one job per
run, verify the live URL before saying `posted`, never retry a publish click. Any AI that can
read a file and make HTTP calls can follow it.

## Playbooks

`playbooks/<platform>.md` is the written procedure an AI follows on each site: the page to open,
the controls by their accessible names, the dialogues in order, how to read the live URL back,
and what "already posted" looks like. When a site changes, the AI adapts, finishes the post,
and appends a dated correction. Improvements are welcome as pull requests.

## Rules the AI keeps

The job row is the authorization: it exists only because you set a time on a post in Planino.
The AI posts the frozen payload and nothing else; it never composes new text, never changes a
schedule, never visits another site, does one job per run, and stops at 40 tool calls or ten
minutes. Before publishing it looks for the same post already live from the last hour, in case
an earlier attempt died after the publish click. Only a verified live URL becomes `posted`;
anything unclear is handed back as `needs_manual`.
