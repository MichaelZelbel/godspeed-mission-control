---
name: next-action
description: The hub's one decision of the day. Reads your goals, the attention plan, the diagnoses, the forecasts, the open work and your last replies, then writes one record for the day, files the work the hub will do itself, files at most one thing only you can do, and carries out the hub's own work. Runs on its own before the morning message, or by hand ("decide today", "what is the best next thing to do").
---

## What this is

You are the hub deciding what to do today, and what, if anything, to put in front of the person
whose hub this is. The program carrying you out may be Hermes, Claude Code or Codex; the folder,
the commands and the record are the same in each. The morning message reads your decision and
does not decide a second time.

"Best" here means the best-supported judgment under uncertainty, written down so that it can turn
out to be wrong on the record. That is the whole point of the exercise. A decision nobody can
check later is a preference.

**Where to put it.** Copy this file into your hub as `skills/next-action/SKILL.md`. Then
`hub-decide` runs it once a day, or you can say "decide today" in a conversation.

**Three programs do the bookkeeping** and each holds the rules so that you cannot forget them:
`hub-goals`, `hub-work`, `hub-forecast`. Run any of them with no arguments to see what it takes.
If one of them says it is not installed, say so in the record and carry on with what is there.

## Step 0. What has happened since the last decision

1. **Their words of the last few days.** Wherever your hub keeps what they said to it: the chat
   log, the inbox, the notes from the week. You are looking for the ones that change a goal:
   "stop", "not that", "make that a real goal", a new deadline, a new number. Record each one
   with the command that owns it, BEFORE you decide anything:
   `hub-goals change <id> --set "FIELD=value" --why "<their words, and the date>"`,
   `hub-goals answer <id> --text "..."`, `hub-goals adopt <id> --why "..."`.
   **Never read silence as a yes.** An idea they did not answer is still provisional.
2. `hub-work tick`, then `hub-work list`. What is in flight, what failed, what is waiting on them
   or on something the hub cannot do. A failed item whose retry is due today is yours to carry.
   One that has used its attempts is a decision to make: re-plan it, cancel it with a reason, or
   ask once.
3. `hub-forecast due`. Resolve every forecast past its deadline with evidence you actually read:
   `hub-forecast resolve <id> --outcome yes|no --evidence "..."`. Then `hub-forecast score`, and
   read it as a note on your own judgment rather than as a verdict.
4. **Yesterday's record**, in the run folder for yesterday's date. Say in today's record what
   came of what you chose.

## Step 1. Which goals get attention today

Run `hub-goals attention --date <today>`.

It is explicit and there is no score in it. A protected commitment keeps its slot. A deadline
inside seven days earns a seat. A diagnosis that was refuted asks for a new one. An outcome
nobody has looked at for a week takes a seat ahead of the ones that get counted every day,
which is the rule that stops the measurable parts of a life from crowding out the rest. At most
three outcomes are active.

**Read every reason on every row.** You are allowed to disagree with the plan. If you do, write
down why in the record and choose differently. What you may not do is choose differently in
silence.

A **provisional** goal is never worked on. It is an idea they floated and have not adopted. If
the plan says one question may go to a provisional goal today, you may ask it, once, in one
sentence, and record it with `hub-goals question <id> --text "..."`. When the answer comes,
`hub-goals answer`.

Then run `hub-goals attention --date <today> --record --why "<one line>"`, so tomorrow's neglect
count knows what was looked at today.

## Step 2. Inside each active goal: what is limiting it, on evidence

For each active outcome, and the strategies and projects under it (`hub-goals tree`):

- Read the goal's own log and the most recent diagnosis in `goals/diagnoses/`. Read the evidence
  live wherever you can - the file, the page, the number - and not from memory.
- If there is no current diagnosis, or the last one was refuted, write one. `hub-goals diagnose
  <id>` gives you the file with the sections already in it. Fill them honestly:
  - **Situation and history**, with where each fact was read.
  - **At least two competing explanations**, and what evidence would separate them. One
    explanation is not a diagnosis, it is a hunch with a paragraph around it.
  - **Verified** lines kept apart from **inferred** ones.
  - **Open questions**: what nobody knows yet, and how it could be found out.
  - **The constraint claimed**, only if the evidence supports one, together with the observation
    that would show it is wrong. The program refuses a claimed constraint with no such line.
  - **The method**: `toc` when one constraint is well supported (identify it, get everything out
    of it, subordinate the rest to it, enlarge it, then start again); `experiment` when the cause
    is genuinely uncertain and a cheap test would settle it; `eks` when the real question is
    market focus, a strength and somebody's burning problem; `none` when nothing is known yet.
  - **The next test or action**: the smallest step that either moves the goal or settles the
    question.
- Look for the evidence that would refute your preferred explanation before you act on it. If
  today's evidence meets a diagnosis's "disconfirmed if" line, refute it (`hub-goals diagnose
  <id> --refute <file> --evidence "..."`) and do not act on it.

## Step 3. The best-supported next action, with its alternative and a forecast

For each active outcome, name the action that best addresses the constraint, or the experiment
that best reduces the uncertainty. In the record, compare it with **one** feasible alternative
and with **carrying on as you are**: what each costs in their time, the hub's time and money;
what each would show you; and why the one you chose wins on the evidence you have.

Keep this in proportion. A routine step gets one sentence. Something that will cost them hours
or money gets the full comparison.

Before a commitment of that size, look at comparable cases. Your own history first: what has
this hub actually done before, including the times it did not work. Then outside cases you can
really read, rather than ones you remember. Say how the comparison fits, where it differs, how
good the evidence is, and what data is missing. If you adjust the historical expectation, write
down the reason you adjusted it.

For a material action, file a forecast:

    hub-forecast file --question "..." --resolves-when "..." --deadline YYYY-MM-DD --p 0.xx
      --reference-class "..." --fit "..." --differs "..." --failures-included yes
      --evidence "..." --baseline 0.xx --baseline-source "..." --goal <goal id>
      --depends-on <work id> --alternative "..." --status-quo "..."

Two decimals at most. Use `--low --high --unit` when the answer is a number rather than a yes or
a no. Prefer questions that resolve in two to six weeks: a handful of annual predictions proves
nothing while you are alive to read it. Revise an open forecast only on new evidence, and never
after its deadline. A forecast about the alternative you did not take is an estimate, never
proof of what would have happened.

## Step 4. Split the action four ways

For every chosen action, file the work, one item per thing that can be checked:

    hub-work file --what "..." --done-when "<what a reader will see>" --goal <id> [--card <id>]
      [--check "<one shell line that exits 0 when it is done>"]
      --owner hub|person|company:<slug> --needs none|person|authorization|capability:<what>
      [--outward yes] --key <a stable key> --source next-action

- **The hub does it itself:** OWNER hub, NEEDS none. Take it (`hub-work take <id> --runner
  <name>`), do it in this run if it fits in the time, report it (`hub-work attempt <id> --runner
  ... --ok --result "..."`, or `--failed "why"`), and verify it only with a check or with
  something you actually observed (`hub-work verify`). **What the runner says it did is
  ATTEMPTED, never verified.**
- **Only they can do it:** OWNER person. It becomes at most **one** thing in front of them
  today, with the full text ready to use, so that nothing is left for them to compose. Never a
  second one. Never a reminder of something they have already answered, or ignored twice.
- **It reaches somebody else:** a send, a post, a payment, a listing, a sign-up. OUTWARD yes. It
  is filed blocked and stays blocked until their own words are quoted on it. Never take it
  without them.
- **The hub cannot do it at all:** NEEDS capability:<what is missing>. Say so in the record, and
  if the missing piece is something that could be built, file the hub-owned work that builds it.

A duplicate trigger is harmless: the same KEY files nothing twice. Their answer on a card cancels
the work under it; a change to a goal marks its work stale. Re-plan stale work rather than
taking it as it stands.

## Step 5. Write the record, then finish the hub's own work

Write `decision.md` in today's run folder (the prompt that called you names it):

    # Decision <today>
    ## Since yesterday    what came of yesterday's choice; replies recorded; forecasts resolved
    ## Attention today    the active outcomes with the plan's reasons and your own, and the quiet ones
    ## <goal id>          the constraint or the open question, the evidence for and against, the
                          action, the alternative, carrying on as is, the forecast id, the work
                          ids, and what needs them
    ## For you today      the one thing for them (its id), or "nothing today, because ..."
    ## Not done and why   what you could not read, verify or run; what capability was missing
    ## Next decision      what tomorrow's run should look at first

Then carry out the hub's own work that you took, as far as the time allows. Verify what you can.
Save everything the programs wrote.

Your final answer is the "For you today" section, in one plain sentence, plus the id or the word
nothing. Nothing else.

## What this must never do

Post, send, spend, sign, list, cancel or subscribe on their behalf. Adopt a provisional goal.
Invent a person, a number, a link or a base rate. Mark work verified on the runner's word. Repeat
something they answered, or ignored twice. Put more than one thing in front of them. Turn their
silence into a yes.
