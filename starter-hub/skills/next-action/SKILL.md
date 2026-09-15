---
name: next-action
description: The hub's one decision of the day. Reads your goals, how each is won, the attention plan, the diagnoses, the forecasts, the open work and your last replies, then writes one record for the day, files the work the hub will do itself (a runner carries it out later the same day), files at most one thing only you can do, and does the two-minute things at once. Runs on its own before the morning message, or by hand ("decide today", "what is the best next thing to do").
---

## What this is

You are the hub deciding what to do today, and what, if anything, to put in front of the person
whose hub this is. The program carrying you out may be Hermes, Claude Code or Codex; the folder,
the commands and the record are the same in each. The morning message reads your decision and
does not decide a second time. A second program, `hub-work-run`, carries out the work you file,
one item at a time, later the same day.

"Best" here means the best-supported judgment under uncertainty, written down so that it can turn
out to be wrong on the record. That is the whole point of the exercise. A decision nobody can
check later is a preference.

**Where it lives.** This file is part of the starter hub, at `skills/next-action/SKILL.md`, so
every hub the installer makes has it from day one. `hub-decide` runs it once a day, or you can say
"decide today" in a conversation.

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
2. `tick.txt` and `work.txt` in the run folder: what time did to the tracker, and every item on
   it. What is in flight, what the runner verified since yesterday, what failed, what is waiting
   on them or on something the hub cannot do. A failed item whose attempts are used up is a
   decision to make: re-plan it, cancel it with a reason, or ask once.
3. `hub-forecast due`. Resolve every forecast past its deadline with evidence you actually read:
   `hub-forecast resolve <id> --outcome yes|no --evidence "..."`. Then `hub-forecast score`, and
   read it as a note on your own judgment rather than as a verdict.
4. **Yesterday's record** is `yesterday.md` in the run folder; the program put it there. Say in
   today's record what came of what you chose. The long decision log a hub may keep is not read
   by this recipe: the run folder is the record you answer to.

## Step 1. Which goals get attention today

Run `hub-goals attention --date <today>`.

It is explicit and there is no score in it. A protected commitment keeps its slot. A deadline
inside seven days earns a seat. A diagnosis that was refuted asks for a new one. **An outcome
whose playbook is missing, refuted or past its review date takes a seat**, because working a
goal without knowing how it is won is guessing. An outcome nobody has looked at for a week takes
a seat ahead of the ones that get counted every day, which is the rule that stops the measurable
parts of a life from crowding out the rest. At most three outcomes are active.

**Read every reason on every row.** You are allowed to disagree with the plan. If you do, write
down why in the record and choose differently. What you may not do is choose differently in
silence, and what you may not do twice is take an active goal's day for the hub's own machinery
(Step 4 says how much of the day that may have).

A **provisional** goal is never worked on. It is an idea they floated and have not adopted. If
the plan says one question may go to a provisional goal today, you may ask it, once, in one
sentence, and record it with `hub-goals question <id> --text "..."`. When the answer comes,
`hub-goals answer`.

Then run `hub-goals attention --date <today> --record --why "<one line>"`, so tomorrow's neglect
count knows what was looked at today.

## Step 2. How this goal is won, then what limits it here

For each active outcome, and the strategies and projects under it (`hub-goals tree`):

**First the playbook**, `goals/playbooks/<id>.md`: who has reached this outcome, what they do,
in what order, what they track, where it fails, and which of those steps a hub can do on its
own. Read it before anything else about the goal.

- **If there is none, or it is refuted or past its review date, the playbook is today's action
  for that goal.** Scaffold it (`hub-goals playbook <id>`) and file the research as a learn
  item for the runner:

      hub-work file --learn "How do people who reached <the outcome, in their words> get there,
        and what do they do first from where <name> is now?" --path goals/playbooks/<id>.md
        --check "hub-check-written goals/playbooks/<id>.md --min-words 500 --sections '## Who we model,## What they do,## In what order,## What they track,## Where it fails,## Hub steps,## Person steps,## Unknown,## Sources'"
        --goal <id> --key playbook-<id> --source next-action

  Then diagnose only what the goal card and its log already show, and move on. Do not invent
  the levers yourself at four in the morning; that is what the research is for.
- **With a playbook**, the diagnosis names WHICH of its levers is the constraint for this
  person, and cites the playbook's evidence. Read the goal's own log and the most recent
  diagnosis in `goals/diagnoses/`. Read the evidence live wherever you can, the file, the page,
  the number, and not from memory. If there is no current diagnosis, or the last one was
  refuted, write one. `hub-goals diagnose <id>` gives you the file with the sections already in
  it. Fill them honestly:
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
  <id> --refute <file> --evidence "..."`) and do not act on it. If the result of the hub's own
  work contradicts the playbook, refute that too (`hub-goals playbook <id> --refute --evidence
  "..."`) and the next run researches it again.

## Step 3. The best-supported next action, with its alternative and a forecast

For each active outcome, name the action that best addresses the constraint, or the experiment
that best reduces the uncertainty. **The action is a lever from the playbook, applied at the
constraint, or an experiment from the playbook's Unknown section.** An action that is in
neither is filed only with a line saying why the playbook missed it, and the playbook gets that
lever added. In the record, compare it with **one** feasible alternative and with **carrying on
as you are**: what each costs in their time, the hub's time and money; what each would show you;
and why the one you chose wins on the evidence you have.

Keep this in proportion. A routine step gets one sentence. Something that will cost them hours
or money gets the full comparison.

Before a commitment of that size, look at comparable cases. Your own history first: what has
this hub actually done before, including the times it did not work. Then outside cases you can
really read, rather than ones you remember. Say how the comparison fits, where it differs, how
good the evidence is, and what data is missing. If you adjust the historical expectation, write
down the reason you adjusted it.

For a material action, and for every experiment, file a forecast:

    hub-forecast file --question "..." --resolves-when "..." --deadline YYYY-MM-DD --p 0.xx
      --reference-class "..." --fit "..." --differs "..." --failures-included yes
      --evidence "..." --baseline 0.xx --baseline-source "..." --goal <goal id>
      --depends-on <work id> --alternative "..." --status-quo "..."

Two decimals at most. Use `--low --high --unit` when the answer is a number rather than a yes or
a no. Prefer questions that resolve in two to six weeks: a handful of annual predictions proves
nothing while you are alive to read it. Revise an open forecast only on new evidence, and never
after its deadline. A forecast about the alternative you did not take is an estimate, never
proof of what would have happened.

## Step 4. Split the action four ways, in this order

For every chosen action, file the work, one item per thing that can be checked:

    hub-work file --what "..." --done-when "<what a reader will see>" --goal <id> [--card <id>]
      [--check "<one shell line that exits 0 when it is done>"]
      --owner hub|person|company:<slug> --needs none|person|authorization|capability:<what>
      [--outward yes] [--kind do|learn] --key <a stable key> --source next-action

**The order is fixed, per active goal, and the record says what was filed under each or why
nothing was:**

1. **What the hub does itself:** OWNER hub, NEEDS none. Everything the playbook's "Hub steps"
   section says a hub can do from a computer with nobody present: research, build the
   measurement, compute the number, find the people or the options, draft the thing, prepare
   what the person will need. Each item's DONE WHEN names the file a reader will open, and its
   CHECK proves the file is there and whole (`hub-check-written <path> --min-words N` is the
   check for anything written). **`hub-work-run` carries these out later today, one at a time,
   in their own runs**; you do not do them here.
2. **What only they can do:** OWNER person. It becomes at most **one** thing in front of them
   today, with everything the hub could prepare already done and the full text ready to use, so
   that nothing is left for them to compose. Never a second one. Never a reminder of something
   they have already answered, or ignored twice.
3. **What nobody knows yet:** `--kind learn` (or `--learn "<question>" --path <file>`). A learn
   item is done when the answer is written where a reader can open it, with the evidence read.
   File one wherever the playbook's levers disagree, the person's case differs, or the
   diagnosis says `experiment`, and file its forecast beside it with `--depends-on`.
4. **The hub's own machinery** (a goal whose AREA is the hub itself): at most **one** item per
   run, filed after every active goal has its items, and never the reason an active goal got
   nothing today. A broken tool that blocks a goal's item is filed under that goal, as the
   capability it needs, and counts against this one seat.

Two more kinds cut across all four: **it reaches somebody else** (a send, a post, a payment, a
listing, a sign-up) is `OUTWARD yes`, filed blocked, and stays blocked until their own words are
quoted on it; never take it without them. **The hub cannot do it at all** is `NEEDS
capability:<what is missing>`; say so in the record, and if the missing piece could be built,
file the hub-owned work that builds it.

A duplicate trigger is harmless: the same KEY files nothing twice. Their answer on a card cancels
the work under it; a change to a goal marks its work stale. Re-plan stale work rather than
taking it as it stands.

## Step 5. Write the record, then do only the two-minute things

Write `decision.md` in today's run folder (the prompt that called you names it):

    # Decision <today>
    ## Since yesterday    what came of yesterday's choice; what the runner verified; replies
                          recorded; forecasts resolved
    ## Attention today    the active outcomes with the plan's reasons and your own, and the quiet ones
    ## <goal id>          the playbook's state, the constraint or the open question, the evidence
                          for and against, the action, the alternative, carrying on as is, the
                          forecast id, the work ids in the four groups above, and what needs them
    ## For you today      the one thing for them (its id), or "nothing today, because ..."
    ## Not done and why   what you could not read, verify or run; what capability was missing
    ## Next decision      what tomorrow's run should look at first

Then take and do only what fits in about two minutes: a reading, a record, a check, a line on a
card. Take nothing you will not finish in this run (`hub-work take <id> --runner <name>`, then
`hub-work attempt ... --ok --result "..."` or `--failed "why"`, then `hub-work verify`). **What
the runner says it did is ATTEMPTED, never verified.** Everything longer stays planned for
`hub-work-run`. Save everything the programs wrote.

## Step 6. What came back

Before you finish, read the items VERIFIED since yesterday (they are in `work.txt` with their
RESULT and LINK) and let each one change something: a PROGRESS line on the goal where a number
moved (`hub-goals progress <id> --evidence "..."`), a refuted diagnosis or playbook where the
result contradicts it, a resolved forecast where one depended on the item. A result nobody reads
back into the plan was work for its own sake.

Your final answer is the "For you today" section, in one plain sentence, plus the id or the word
nothing. Nothing else.

## What this must never do

Post, send, spend, sign, list, cancel or subscribe on their behalf. Adopt a provisional goal.
Invent a person, a number, a link or a base rate. Work a goal without knowing how it is won, or
invent the levers instead of researching them. Let the hub's own machinery take the day from an
active goal. Take work it will not finish in this run. Mark work verified on the runner's word.
Repeat something they answered, or ignored twice. Put more than one thing in front of them. Turn
their silence into a yes.
