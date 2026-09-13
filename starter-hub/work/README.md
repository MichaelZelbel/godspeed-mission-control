# work - what your hub is doing, from planned to verified

**This room starts empty, and an empty one costs you nothing.** It fills the first time your hub
decides to do something and wants to be held to it.

## Why this is not a to-do list either

An assistant that works while you are asleep has one characteristic failure, and it is not that
it does the wrong thing. It is this:

> It produces something. It writes down that it produced something. It stops. Nobody checks.

"Posted." "Sent." "Fixed." Those are the runner's own words about its own work, which is the one
source you cannot use to find out whether the work happened. Every time you read one of them in
a log and believe it, you have taken a machine's word for a machine's behaviour.

So this register keeps three states apart that every to-do list treats as one:

    DISPATCHED  a runner has taken it and holds a lease on it
    ATTEMPTED   the runner says it did the thing
    VERIFIED    something that is not the runner checked, or a person looked and said where

**Only VERIFIED closes an item.** That one distinction is most of what this folder is for.

## An item

```
work/W-20260913-01.md

ID: W-20260913-01
STATUS: planned       planned, dispatched, attempted, verified, failed, blocked, stale, cancelled
KEY: redraft-lines    the same open key files nothing twice
GOAL: lead            CARD: M017
WHAT: Redraft the three lines
DONE WHEN: a new draft exists with the three lines in it
CHECK: test -f drafts/lines-v2.md      one shell line that exits 0 when it is done
OWNER: hub            hub, person, or company:<slug>
NEEDS: none           none, person, authorization, or capability:<what is missing>
OUTWARD: no           a send, a spend, a post, a listing: never on its own
ATTEMPTS: 1   MAX ATTEMPTS: 3   LEASE: claude-laptop until 2026-09-13T12:00:00Z
NEXT TRY: 2026-09-14  STALE AFTER: 7

## Log
- 2026-09-13 FILED by next-action for lead under card M017
- 2026-09-13 DISPATCHED claude-laptop, lease until 2026-09-13T12:00:00.000Z
- 2026-09-13 ATTEMPTED attempt 1 by claude-laptop: wrote drafts/lines-v2.md
- 2026-09-13 VERIFIED check passed (test -f drafts/lines-v2.md)
```

## DONE WHEN is written for somebody who was not there

That is the whole test for it. "Redraft the lines" is not a done-when. "A new draft exists with
the three lines in it" is, because a person who did not do the work can open the folder and say
yes or no. If you cannot write that sentence, you do not yet know what you are asking for.

`CHECK` is the same sentence as one line of shell. When there is one, verification needs nobody.

## The rules the program holds

- **A duplicate trigger files nothing.** A schedule that fires twice, a session that is retried,
  a conversation that repeats itself: the same open KEY returns what is already there. This is
  the difference between a system you can run every hour and one you have to supervise.
- **A lease keeps two runners off one job.** `take` holds it for two hours. Another runner is
  refused. `tick` gives back a lease that ran out with nothing reported.
- **`attempt --ok` makes it attempted, never verified.** `verify` runs the CHECK and accepts only
  exit 0, or takes evidence a person observed: a link, a file they opened, a screenshot. For work
  the hub owns, the word "done" is not evidence and is refused in those words.
- **A failure gets a gap, not a hammer.** Retry after one day, then two, then four, up to MAX
  ATTEMPTS. After that a person decides. An assistant retrying a broken thing every ten minutes
  all night is how you end up with three hundred of something.
- **Outward work never moves on its own.** Anything that reaches somebody else - a send, a
  payment, a post, a listing, a sign-up - is filed blocked, is never retried, and is taken or
  unblocked only with your own words quoted on it. Those words are kept on the card.
- **Your answer reaches the work.** Answering a card cancels the work filed under it. Changing a
  goal marks the work under it stale, so it is re-planned rather than carried on with.
- **Time passes even when nothing runs.** `hub-work tick` releases dead leases, names what is due
  for a retry, marks plans stale after their STALE AFTER days, and names anything that has been
  waiting on **you** for more than two weeks. That last one is a signal to reassess whether it is
  still wanted, never to ask you again the same way.

## Blocked is a real answer

`NEEDS` has four values and three of them are honest dead ends: `person` (only you can do it),
`authorization` (it needs your word before it goes out), and `capability:<what is missing>` (the
hub cannot do it at all from this machine). A hub that says "I cannot read that page from here"
is worth more than one that quietly does something adjacent and reports success.

## The commands

```
hub-work file --what "..." --done-when "..." [--check "..."] [--goal G] [--key K]
hub-work take <id> --runner <name> [--approved-by "<your words>"]
hub-work attempt <id> --runner <name> --ok --result "..." | --failed "why"
hub-work verify <id> [--evidence "what was observed, where"]
hub-work block <id> --needs ... | unblock <id> --why ... | cancel <id> --why ...
hub-work tick | next | list | show <id> | check
```

Chapter 23 of the book is the idea behind this folder: progress written down, and the difference
between saying a thing is done and showing it. The rooms next door are `goals/` and `forecasts/`.
