# The three traps (Chapter 28)

All three happened while building this chapter's server from a blank Ubuntu machine on
2026-07-26. They are in the order you will meet them, with what changed when the server
moved to Hermes on 2026-09-02.

## 1. On a server, "ask me first" means "no"

**What happened.** The first scheduled run died after eight seconds. The assistant wanted to run
one harmless command. Its settings said to ask permission. There was nobody there to ask. The
request was auto-rejected and the whole procedure stopped:

```
! permission requested: bash (ls ...); auto-rejecting
Error: The user rejected permission to use this specific tool call.
```

**Why it matters.** This inverts the lesson from Part IV. On your laptop the leash is a question:
it asks, you answer. On a server there is no one to answer, so a question is not a leash, it is
a stop button that presses itself.

**The fix.** The leash has to be the walls instead. Give the assistant its own user account
(`adduser ai`), with its own home directory, holding nothing but the folder and its own keys.
Hermes ships the right half of this already: a scheduled job that reaches for a dangerous
command is refused, not paused (`approvals.cron_mode: deny`), so a job never hangs waiting for a
click, and a brief that only reads the folder and writes into `brief/` never reaches for one.
If a job of yours genuinely needs a dangerous command, grant it on purpose in Hermes' approvals;
the installer never turns the leash off.

## 2. `git add -A` will commit your keys

**What happened.** The first working run did everything right: read the folder, wrote the brief,
sent it to the phone, pushed to GitHub. It also pushed the file holding the API key, because that
file was inside the folder and `git add -A` means everything.

```
 .env.server         |  3 +++
 brief/2026-07-26.md | 19 +++++++++----------
 opencode.json       |  5 +++++
```

The repository was private, so nothing reached the public, and it still meant rewriting the
history and rotating the key.

**The fix, both halves.**

- Keep the key file outside the folder: `~/.mc-env`, not `godspeed/.env`. Hermes keeps its own
  secrets (the Telegram token, its sign-in) in its own home, never in the folder.
- Add a `.gitignore` in the folder containing `.env*` and `.mc-env`, as a second net.

Do this before the first push, not after. The installer does.

## 3. A silent failure looks exactly like a quiet morning

**What happened.** Nothing, which is the point. A procedure that fails quietly and a procedure
that had nothing to say produce the identical experience: no message. You find out weeks later.
The book's own rehearsal server proved it in August: its morning brief had failed every day for
four days (`claude: command not found`, then a Telegram 404) and nobody knew.

**The fix, twice over.** The morning-brief job's own prompt ends with the order to say
so plainly when the recipe is missing or the brief cannot be written, so a broken
morning arrives as a message, not as silence. And `hermes cron incidents` keeps the
record on the server side: a failed run is a listed incident with a first-seen time
and the stored output, not a blank space where a message should have been. A third
guard is free: `hermes cron status` says in one line whether the gateway is up, and a
job with no live gateway simply does not fire until the gateway is back, and then runs once, late.

## A fourth thing, not a trap, just true

The folder on the server is a clone, and clones drift. If you edit the folder on your laptop and
forget to push, the server works from yesterday's facts and will not tell you, because from where
it stands yesterday's facts are the facts. Pull before you work, push when you finish. Same
habit as Chapter 18, now with a second machine depending on it.
