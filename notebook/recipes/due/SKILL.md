---
name: due
description: Carry an obligation with an actual target or costly deadline, completion evidence, self-check and recurrence. Ask its missing questions once; use the installed native command and shared notebook reminder gate.
---

# Obligations and reminders

## Installed entry points

In normal chat or the notebook personal-command form, use `/due` followed by the command below. In the isolated native assistant terminal, use `mc-due`. The wrapper binds the current workspace; never override it with `--godspeed` or use a personal engine installation. `mc-due help` shows the actual installed command contract.

This recipe retains the complete obligation workflow. Calendar creation, updates and deletion require the person's exact approval. Calendar bookkeeping is local and works with no account. Read `reference/due-room.md` for bands, targets, windows and what a reminder's page holds.

## What this is

Your mission control keeps track of the things in the person's life that have a last day, or a day
they would like them done by. It gets louder as a last day comes, and goes quiet the moment a thing
is done. The design target is **hundreds** of them (credentials, domains, taxes, contracts,
insurance, timesheets, returns, health checks, promises to people), so nothing here may cost
anything per obligation.

**The rule that shapes every decision: one skill, one runner, N records, one output gate.**
Adding obligation 301 means one more page under `Deadlines/`. If a change to this recipe would have to be
repeated per obligation, it is the wrong change.

**Read `reference/due-room.md` before your first run.** The three dates (start, target, deadline) and how
each combination behaves, the strip, the bands, the three states, the page a reminder is and the gate are
all defined there and are not restated here.

**Read `../watch/SKILL.md` too.** This recipe is its sibling and follows the same law: four
questions asked once, one skill for all of them, a hard cap on what can reach the person. One thing is
deliberately inverted. For a watch topic, a finding that expires unread is a correct outcome. For
an obligation it is exactly the failure, so an obligation inside its window outranks any watch
finding, and a window that ended without being closed stays open and stays red.

## The modes

### `add`: creating one

The person says "my timesheet is due every month". Ask them **four questions, once, ever:**

1. **What is true when this is finished?**
2. **"Is there a day after which this costs you something, or is it a day you'd like to have it done
   by?"** Ask it in those plain words. A day after which it costs them is the **deadline**
   (`--to`); a day they would like it done by is the **target** (`--target`); it can be both (a tax
   return: aim for the end of January, must by the end of February). Many things only have a
   target, and that is a full answer. If the first day they can start is not today, ask for that
   one too (`--from`); otherwise leave it out and it is today.
3. **What does it cost you if it slips?** Only when there is a deadline: it is what ranks two reds.
   A target alone costs nothing when missed, by definition, so do not make them invent a cost.
4. **How could your mission control tell you did it, without asking you?** (the self check)

Plus: does it repeat, and how often.

```
mc-due add <slug> --title "<in their words>" [--from YYYY-MM-DD] \
  --target YYYY-MM-DD and/or --to YYYY-MM-DD \
  --done-when "<answer 1>" [--cost "<answer 3>, needed with --to"] \
  --self-check none|secret-changed|file-newer [--self-check-arg X] \
  [--repeats monthly|yearly|"every N days"] [--link <https url>]
```

**Ask question four every single time, even when you already know the answer is "it cannot".**
Knowing which kind of obligation this is changes what gets built around it, and an obligation that
cannot check itself is legitimate, not second class. It says so and waits for the person's word.

**Never interview them again after that.** Same discipline as the watch skill and for the same
reason.

**NO DATE, NOT ELIGIBLE.** If they can say neither a last day nor a day they would like it done by,
this is not an obligation and it does not go in here. "Someday" is not a target; "by the end of May" is. For an undated request to discuss something with a person, use `../talk-about/SKILL.md`.
For other undated requests, offer a note or a watch topic. The tool refuses it
anyway, in those words, but you should not need the tool to refuse you.

**Never invent a date.** If you do not know when the window opens, ends or is aimed at, ask them for
that one date and nothing else. Never turn a target they gave into a deadline, or a deadline into a
target: which one it is changes everything about how loud it gets. Before you ask, search: the notebook tools `search_knowledge` and `search_notes`, the chat
history, the page itself. The search is the check.

### `run`: the daily runner

```
mc-due check      # roll the windows forward, run the self checks, close what is provably done
```

That is the whole job on a normal day, and it is arithmetic and file reads, not judgment. It needs
no model at all, which is why the installed deadline-reminder routine runs this check without asking the model. You are here
for the three things arithmetic cannot do: creating one, closing one on the person's word, and the calendar.

### `close`: they say they did it

```
mc-due done <slug> --evidence "<what shows it: a receipt, a link, or their own words>"
```

That writes the closing as a moment on the notebook's timeline (`Timeline/<day> Done: <title>`),
which names the reminder, says which window it closes and carries an `evidence:` line; the
reminder's page under `Deadlines/` keeps only the plan and is never edited to say done. A closing
written by hand as a moment, with the reminder named and `evidence:` filled in, closes it just the
same, and `mc-due state` shows what closed each one.

**Never close an obligation on an inference.** "They mentioned the tax adviser" is not "they filed the
return". If a self check cannot prove it, the person's word is the only thing that closes it, and the closing
must carry what shows it: a closing without `evidence:` closes nothing. **Their word includes doing it
with you:** when they approve, send or publish the thing in this session, that is their word; close it
before the session ends and never ask them to say "close it" afterwards. The installed notebook and chat read the same reminders and the same closing moments. At the end of work that actually completes one, run `mc-due done` with that evidence. Do not infer completion from discussion or a saved draft. The deadline reminders routine runs the self checks every morning; Settings > Routines shows whether it is switched on and when it last ran.

### `target`: their answer after a target passed

A target with no deadline asks once, the morning after it passed: "<title>: on <day they set it> you
told me you would like this done by <day>. That day was yesterday, so I am asking once: a new date,
or as soon as you can? Reply with a new date and I stay quiet until that day; reply "as soon as you
can" and it stays on your list with a short line in the morning brief about once a week; reply "drop
it" and nothing mentions it again. No reply counts as "as soon as you can"." Days are said the way a
person says them ("10 March"). Whatever channel their answer arrives on, it goes here ("drop it" goes
to `drop`, below):

```
mc-due target <slug> YYYY-MM-DD    # a new day: quiet until then, one mention, the question again if it passes
mc-due target <slug> asap          # as soon as they can: written into its log, nothing else changes
```

"As soon as you can" and no answer behave the same, on purpose: it stays open and is mentioned
about once a week, in the brief only, until it is done or dropped. So never chase them for an
answer, and never ask the question a second time yourself. The same command gives a target to an
obligation that has none (they say "aim for the 20th" about their timesheet); on a repeating one it
lands at that offset in every window to come. If the command prints a `CALENDAR:` line, act on it
in the same session (below).

### `drop`: they say it is gone

```
mc-due drop <slug> --yes --evidence "<their words>"
```

A drop is a moment too, "Dropped" instead of "Done". Nothing is deleted: the page stays as history.

**`dropped` only ever comes from the person.** Never propose dropping one to tidy up a red week, and
never drop one because it has been red for a while. A red obligation that has been red for weeks is
the system working; deleting it is the system lying.

## The calendar: one entry, written the moment the date exists

**Your mission control is completely correct with no calendar at all.** Nothing in `mc-due` can reach one. If
the calendar is unreachable, or they have none, skip all of this and say nothing about it: a missing
calendar is not a fault to report.

When a calendar IS reachable, through a calendar connection the person set up, the rule is short.

**ONE entry per obligation. Never two.** Two entries about one date is the same mistake as two
systems nagging about one key: the day they disagree, the person stops believing either.

**It goes on the target day when there is a target, otherwise on the day your mission control starts
being loud, never on the last day**. `mc-due marker --needed`
gives you that day; it is worked out from the same band rule as everything else, so there is
nothing to decide and nothing to tune. A second entry on the last day was rejected for a reason
worth remembering: if they have already acted, an entry on the last day is a lie sitting in their
calendar.

**The last day goes in the title**, so the one entry carries both facts.

**Prepare it the moment the date exists**, in the same session as `mc-due add`, not on the next
morning run, so the date is on their phone from the moment it exists.

```
mc-due marker --needed
  slug <TAB> the day the entry goes on <TAB> the last day (- if none) <TAB> the link <TAB> the title [<TAB> the target day]
```

The sixth field is there only when the obligation has a target.

For each line, prepare ONE event, get the person's yes for that exact entry, create it and write its real id back:

```
mc-due marker <slug> --set <event id>
```

The event needs a **real start time**, never an all-day entry: many calendar views and daily
summaries skip all-day entries as noise, and an entry meant to be seen has to survive that.
Use the installation timezone and the clock time the person agreed to. Shape it like this:

```
Title:  <the title> (it runs out <last day>)
When:   <the day it goes loud>, the agreed clock time and installation timezone
Notes:  You have N days. <the link, if there is one>
        Your mission control owns the reminding from here; this entry is only so the date
        is on your phone. It removes itself when you are done.
```

With a target, the entry sits on the target day and its title says so:

```
Title:  <the title> (the day you'd like it done)                          target only
Title:  <the title> (the day you'd like it done; it runs out <last day>)  target and deadline
When:   <the target day>, the agreed clock time and installation timezone
```

When `mc-due target` moves a target and prints `CALENDAR: take out the entry <id> ...`,
get the person's yes to remove that future entry, then prepare the one for the new day
and `marker <slug> --set` its id. When it prints `... stays as a record`, leave the old entry and
only write the new one.

**Take it out again when the thing is finished, and only while it is still ahead.**

```
mc-due marker --stale        slug <TAB> event id <TAB> the day it sits on
```

Remove each future entry only after their yes, then `mc-due marker <slug> --clear`. **A past entry is never
deleted**: it is a record of a day that happened, and removing it would erase history rather than
tidy anything. This is the half that answers the worry that an entry would go stale and
nobody would remember to remove it. The same thing that stops the nagging removes the entry, so it
is machinery and not memory.

**Capture, the other direction.** On the morning run, read today's calendar for an event whose text
contains a line starting `mission control:` (or `godspeed:`), for example `mission control: from 1 Feb`.
Turn it into an obligation with `mc-due add`, using the event's own date as the last day and the
`from` as the first. Confirm it to the person in one line, and ask for anything the event did not
say rather than guessing it.

**The calendar never decides when to nag and never knows whether they acted.** If you ever find
yourself reading a calendar to work out whether something is due, stop: that is the failure this
layer was built to replace.

## What reaches the person, and what does not

The installed notebook deadline-reminder routine is the delivery gate. It reads the reminders in the notebook and structured obligations together, creates at most three notices in a batch, records delivery evidence and suppresses unchanged repeats. Enable it through notebook setup or routine controls; use one scheduler owner. The selected morning brief reads the resulting obligation evidence. Never install another reminder per obligation.

Native `mc-due today` gives at most three currently eligible obligations. `mc-due check` runs self-checks and keeps every closing moment. `mc-due state` shows actual closure evidence. `mc-due marker` only maintains local bookkeeping; it cannot reach a calendar. A configured delivery connector and exact authorization are required for external messages. A target is not a costly deadline, and a missed deadline remains open. Do not send a separate message from this recipe.

The quiet-spacing rules come from the native band arithmetic, not a model's opinion. Green is normally quiet. Do not claim cross-channel caps passed until an actual paired delivery test demonstrates them.

## Steps for one obligation they have just named

1. Search first. It may already exist (`mc-due list`), and a second copy of the same
   obligation is two systems nagging about one thing, which is the failure this recipe prevents.
2. Ask the four questions, once. Get a target, a deadline or both, or refuse.
3. `mc-due add ...`, then read back the four answers in one line so they can correct them now rather
   than in six months.
4. If a calendar is reachable, write the ONE entry now, in this session, on the day
   `mc-due marker --needed` gives you, and record its id. If not, say nothing.
5. Read the saved plan and actual state back. Use the configured private file synchronization; do not substitute `git pull --rebase`.

## What this recipe must never do

- **Never nag the person directly.** The two gates are the only route, and their caps live in the tool.
- **Never invent a date, a window or a consequence.** Ask them for the one date you are missing.
- **Never close an obligation without either a self check that proved it or the person's word.**
- **Never drop one.** That is theirs to decide, and only ever in their own words.
- **Never write a state word onto a reminder's page.** Done and dropped are moments on the timeline.
- **Never let a calendar become the mechanism.** Display and capture, never the brain.
- **Never write a second entry for one obligation**, and never one on the last day.
- **Never add a per-obligation tuning knob.** If a band feels wrong for one thing, the strip is
  wrong for that thing. Fix the strip.
- **Never re-interview them.** Four questions once, at `add`, and never again.
- **Never build a second nagging mechanism** for a kind of obligation that feels special. One
  mechanism carries every kind; credentials were the first thing that felt special, and they go
  through it too.


## Installed personal workspace

Use the current user workspace and its configured providers. Keep original workflow, command contracts, scripts and verification criteria. Read the workspace authorization rules before sends, sign-ins, payments or publishing. Search existing device-private credentials before asking for configuration. Saved output and a passing screen are not evidence that the full requested result happened.
