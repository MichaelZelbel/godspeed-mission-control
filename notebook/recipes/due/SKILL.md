---
name: due
description: Carry an obligation with an actual target or costly deadline, completion evidence, self-check and recurrence. Ask its missing questions once; use the installed native command and shared notebook reminder gate.
---

# Obligations and reminders

## Installed entry points

In normal chat or the notebook personal-command form, use `/due` followed by the command below. In the isolated native assistant terminal, use `mc-due`. The wrapper binds the current workspace; never override it with `--godspeed` or use a personal engine installation. `mc-due help` shows the actual installed command contract.

This recipe retains the complete obligation workflow. Calendar creation, updates and deletion require the user's exact approval. Calendar bookkeeping is local and works with no account. Read `reference/due-room.md` for bands, targets, windows and the canonical file format.

## What this is

Mission Control carrying the things in the user's life that have a last day, or a day he would like
them done by, and getting louder as a last day comes, and shutting up the moment one is done. The design target is **hundreds** of them
(credentials, domains, taxes, contracts, insurance, timesheets, returns, health checks, promises to
people), so nothing here may cost anything per obligation.

**The rule that shapes every decision: one skill, one runner, N data files, one output gate.**
Adding obligation 301 means adding a file under `due/`. If a change to tthe user's file would have to be
repeated per obligation, it is the wrong change.

**Read `reference/due-room.md` before your first run.** The three dates (start, target, deadline) and how
each combination behaves, the strip, the bands, the three states, the file format and the gate are
all defined there and are not restated here.

**Read `../watch/SKILL.md` too.** Tthe user's is its sibling and copies its law: four
questions asked once, one skill for all of them, a hard cap on what can reach the user. One thing is
deliberately inverted. For a watch topic, a finding that expires unread is a correct outcome. For
an obligation it is exactly the failure, so an obligation inside its window outranks any watch
finding, and a window that ended without being closed stays open and stays red.

## The four modes

### `add` — creating one

the user says "my timesheet is due every month". Ask the user **four questions, once, ever:**

1. **What is true when tthe user's is finished?**
2. **"Is there a day after which tthe user's costs you something, or is it a day you'd like to have it done
   by?"** Ask it in those plain words. A day after which it costs the user is the **deadline**
   (`--to`); a day he would like it done by is the **target** (`--target`); it can be both (a tax
   return: aim for the end of January, must by the end of February). Many things only have a
   target, and that is a full answer. If the first day he can start is not today, ask for that
   one too (`--from`); otherwise leave it out and it is today.
3. **What does it cost you if it slips?** Only when there is a deadline: it is what ranks two reds.
   A target alone costs nothing when missed, by definition, so do not make the user invent a cost.
4. **How could Mission Control tell you did it, without asking you?** (the self check)

Plus: does it repeat, and how often.

```
mc-due add <slug> --title "<in the user's words>" [--from YYYY-MM-DD] \
  --target YYYY-MM-DD and/or --to YYYY-MM-DD \
  --done-when "<answer 1>" [--cost "<answer 3>, needed with --to"] \
  --self-check none|secret-changed|file-newer [--self-check-arg X] \
  [--repeats monthly|yearly|"every N days"] [--link <https url>]
```

**Ask question four every single time, even when you already know the answer is "it cannot".**
Knowing which kind of obligation tthe user's is changes what gets built around it, and an obligation that
cannot self check is legitimate, not second class. It says so and waits for the user's word.

**Never interview the user again after that.** Same discipline as the watch skill and for the same
reason.

**NO DATE, NOT ELIGIBLE.** If he can say neither a last day nor a day he would like it done by, this
is not an obligation and it does not go in here. "Someday" is not a target; "by the end of May" is. For an undated request to discuss something with a person, use `../talk-about/SKILL.md`.
For other undated requests, offer a note or a watch topic. The tool refuses it
anyway, in those words, but you should not need the tool to refuse you.

**Never invent a date.** If you do not know when the user's window opens, ends or is aimed at, ask the user for
that one number and nothing else. Never turn a target he gave into a deadline, or a deadline into a
target: which one it is changes everything about how loud it gets. Before you ask, search: the notebook tools `search_knowledge` and `search_notes`, the chat
history, the page itself. The search is the verification (workspace verification policy).

### `run` — the daily runner

```
mc-due check      # roll the windows forward, run the self checks, close what is provably done
```

That is the whole job on a normal day, and it is arithmetic and file reads, not judgment. It needs
no model at all, which is why the installed deadline-reminder routine runs this check without asking the model. You are here
for the three things arithmetic cannot do: creating one, closing one on the user's word, and the calendar.

### `close` — he says he did it

```
mc-due done <slug> --evidence "<commit, decision, or the user's words>"
```

That writes the closing as an event in `world/events/` (`closes: [due/<slug>#<first day>]` plus an
`evidence:` line); the `due/` file keeps only the plan and is never edited to say done. A
hand-written or life-capture event with `closes:` and `evidence:` closes it just the same, and
`mc-due state` shows what closed each one.

**Never close an obligation on an inference.** "He mentioned the tax adviser" is not "he filed the
return". If a self check cannot prove it, the user's word is the only thing that closes it, and the event
must carry what shows it: an event without `evidence:` closes nothing. **His word includes doing it
with you:** when he approves, sends or publishes the thing in tthe user's session, that is the user's word; close it
before the session ends and never ask the user to say "close it" afterwards. The installed notebook and chat use the same obligation files and event evidence. At the end of work that actually completes one, run `mc-due done` with that evidence. Do not infer completion from discussion or a saved draft. The selected deadline-reminder schedule runs self-checks; verify that it is enabled and belongs to the chosen schedule owner. There is no dependence on a private engine hook.

### `target` — the user's answer after a target passed

A target with no deadline asks once, the morning after it passed: "<title>: on <day he set it> you
told me you would like tthe user's done by <day>. That day was yesterday, so I am asking once: a new date,
or as soon as you can? Reply with a new date and I stay quiet until that day; reply "as soon as you
can" and it stays on your list with a short line in the morning brief about once a week; reply "drop
it" and nothing mentions it again. No reply counts as "as soon as you can"." Days are said the way a
person says them ("10 March"). Whatever channel the user's answer arrives on, it goes here ("drop it" goes
to `drop`, below):

```
mc-due target <slug> YYYY-MM-DD    # a new day: quiet until then, one mention, the question again if it passes
mc-due target <slug> asap          # as soon as he can: written into its log, nothing else changes
```

"As soon as you can" and no answer behave the same, on purpose: it stays open and is mentioned
about once a week, in the brief only, until it is done or dropped. So never chase the user for an
answer, and never ask the question a second time yourself. The same command gives a target to an
obligation that has none (he says "aim for the 20th" about the user's timesheet); on a repeating one it
lands at that offset in every window to come. If the command prints a `CALENDAR:` line, act on it
in the same session (below).

### `drop` — he says it is gone

```
mc-due drop <slug> --yes --evidence "<the user's words>"
```

A drop is an event too (`drops: [due/<slug>]`). Nothing is deleted: the plan stays as history.

**`dropped` only ever comes from the user.** Never propose dropping one to tidy up a red week, and
never drop one because it has been red for a while. A red obligation that has been red for weeks is
the system working; deleting it is the system lying.

## The calendar: one entry, written the moment the date exists

**Mission Control is completely correct with no calendar at all.** Nothing in `mc-due` can reach one. If
the calendar is unreachable, or he has none, skip all of tthe user's and say nothing about it: a missing
calendar is not a fault to report.

When a calendar IS reachable, with the user's chosen connector configured, the rule is the user's, given on
2026-08-29, and it is short.

**ONE entry per obligation. Never two.** Two entries about one date is the same mistake as two
systems nagging about one key: the day they disagree, he stops believing either.

**It goes on the target day when there is a target, otherwise on the day Mission Control starts
being loud, never on the last day**. `mc-due marker --needed`
gives you that day; it is worked out from the same band rule as everything else, so there is
nothing to decide and nothing to tune. He rejected a second entry on the death day for a reason
worth remembering: if he has already acted, an entry on the death day is a lie sitting in his
calendar.

**The last day goes in the title**, so the one entry carries both facts.

**Prepare it the moment the date exists**, in the same session as `mc-due add`, not on the next
morning run. That is what he asked for: "add it automatically whenever we come up with one of
these dates."

```
mc-due marker --needed
  slug <TAB> the day the entry goes on <TAB> the last day (- if none) <TAB> the link <TAB> the title [<TAB> the target day]
```

The sixth field is there only when the obligation has a target.

For each line, prepare ONE event, obtain exact outward-action approval, create it and write its actual id back:

```
mc-due marker <slug> --set <event id>
```

The event needs a **real start time**, never an all-day entry, because `mc-day-dossier`
deliberately skips all-day entries as noise and a marker meant to be visible has to survive that.
Use the installation timezone and the user's agreed clock time. Shape it like this:

```
Title:  <the title> (it runs out <last day>)
When:   <the day it goes loud>, the agreed clock time and installation timezone
Notes:  You have N days. <the link, if there is one>
        Your mission control owns the reminding from here; tthe user's entry is only so the date
        is on your phone. It removes itself when you are done.
```

With a target, the entry sits on the target day and its title says so:

```
Title:  <the title> (the day you'd like it done)                          target only
Title:  <the title> (the day you'd like it done; it runs out <last day>)  target and deadline
When:   <the target day>, the agreed clock time and installation timezone
```

When `mc-due target` moves a target and prints `CALENDAR: take out the entry <id> ...`,
obtain approval to remove that future event, then prepare the one for the new day
and `marker <slug> --set` its id. When it prints `... stays as a record`, leave the old event and
only write the new one.

**Take it out again when the thing is finished, and only while it is still ahead.**

```
mc-due marker --stale        slug <TAB> event id <TAB> the day it sits on
```

Remove each future event only after approval, then `mc-due marker <slug> --clear`. **A past entry is never
deleted**: it is a record of a day that happened, and removing it would erase history rather than
tidy anything. Tthe user's is the half that answers the user's actual worry, that an entry would go stale and
nobody would remember to remove it. The same thing that stops the nagging removes the entry, so it
is machinery and not memory.

**Capture, the other direction.** On the morning run, read today's calendar for an event whose text
contains a line starting `godspeed:`, for example `godspeed: from 1 Feb`. Turn it into an obligation with
`mc-due add`, using the event's own date as the last day and the `from` as the first. Confirm it
to the user in one line, and ask for anything the event did not say rather than guessing it.

**The calendar never decides when to nag and never knows whether he acted.** If you ever find
yourself reading a calendar to work out whether something is due, stop: that is the failure this
layer was built to replace.

## What reaches the user, and what does not

The installed notebook deadline-reminder routine is the delivery gate. It reads native `due/` plans and structured obligations together, creates at most three notices in a batch, records delivery evidence and suppresses unchanged repeats. Enable it through notebook setup or routine controls; use one scheduler owner. The selected morning brief reads the resulting obligation evidence. Never install another reminder per obligation.

Native `mc-due today` gives at most three currently eligible obligations. `mc-due check` runs self-checks and preserves closure events. `mc-due state` shows actual closure evidence. `mc-due marker` only maintains local bookkeeping; it cannot reach a calendar. A configured delivery connector and exact authorization are required for external messages. A target is not a costly deadline, and a missed deadline remains open. Do not send a separate message from this recipe.

The quiet-spacing rules come from the native band arithmetic, not a model's opinion. Green is normally quiet. Do not claim cross-channel caps passed until an actual paired delivery test demonstrates them.

## Steps for one obligation he has just named

1. Search first. It may already exist (`mc-due list --all`), and a second copy of the same
   obligation is two systems nagging about one thing, which is the failure tthe user's layer prevents.
2. Ask the four questions, once. Get a target, a deadline or both, or refuse.
3. `mc-due add ...`, then read back the four answers in one line so he can correct them now rather
   than in six months.
4. If a calendar is reachable, write the ONE entry now, in tthe user's session, on the day
   `mc-due marker --needed` gives you, and record its id. If not, say nothing.
5. Read the saved plan and actual state back. Use the configured private file synchronization; do not substitute `git pull --rebase`.

## What tthe user's must never do

- **Never nag the user directly.** The two gates are the only route, and their caps live in the tool.
- **Never invent a date, a window or a consequence.** Ask the user for the one number you are missing.
- **Never close an obligation without either a self check that proved it or the user's word.**
- **Never drop one.** That is his, and only ever on the user's words.
- **Never write a state word into a `due/` file.** Done and dropped are events in `world/events/`.
- **Never let a calendar become the mechanism.** Display and capture, never the brain.
- **Never write a second entry for one obligation**, and never one on the death day.
- **Never add a per-obligation tuning knob.** If a band feels wrong for one thing, the strip is
  wrong for that thing. Fix the strip.
- **Never re-interview the user.** Four questions once, at `add`, and never again.
- **Never build a second nagging mechanism** for a kind of obligation that feels special. That is
  what D-165 exists to prevent, and credentials were the first thing that felt special.



## Installed personal workspace

Use the current user workspace and its configured providers. Keep original workflow, command contracts, scripts and verification criteria. Read the workspace authorization rules before sends, sign-ins, payments or publishing. Search existing device-private credentials before asking for configuration. Saved output and a passing screen are not evidence that the full requested result happened.
