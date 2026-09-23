# What I remember, and where it goes

Your assistant loads this page every session, so it is short on purpose and it
does not grow.

**The rules are not here.** They live in `rules/`, one file per rule with the
whole story, and the short version of every one of them is compiled into
`AGENTS.md`, which your assistant reads before anything else.

**What it works out about you goes here**, one file per fact, and it opens one
only when the subject comes up. That is why this page stays small while the
folder behind it can grow as large as it likes. It starts empty and fills up on
its own as you work.

**Why it lives here and not inside the AI tool.** Every AI assistant keeps notes
about you in a folder that belongs to the tool, on one machine. So the notes
never leave that machine, and your other assistants cannot see them. This folder
is inside your mission control instead, which means it travels with everything else in the
folder, and every assistant on every machine you own reads the same one.

## The four folders, and the only thing that separates them is WHEN they are read

    profile/       what it knows because you told it ...... every session
    rules/         how it should behave .................... compiled into AGENTS.md
    observations/  what it worked out on its own ........... when the subject comes up
    prompts/       what you typed to an AI ................. never, unless you ask

That is the whole design, and the reason for it is one sentence: **you cannot
search for a rule you do not know exists.** A rule has to be in front of your
assistant at all times or it will break it without ever knowing it was there. A
fact is the opposite. There will be hundreds of them and one matters today, so
putting all of them in front of your assistant every morning is how it stops
noticing the one that matters.

## How a memory is written

One file per fact, in this folder, with a short header:

```markdown
---
name: the-file-name-without-md
description: one line, so a session can tell whether to open it
---

The fact itself. Link a related one with [[its-name]].
```

That is all. The `description` line is the part that earns its keep: it is what
your assistant reads to decide whether this file is worth opening today.

## When something here turns out to be a rule

Move it to `rules/` and let it be compiled into `AGENTS.md`. A rule sitting in
here is a rule your assistant will only find by accident.
