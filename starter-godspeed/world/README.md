# world - your life as data, when the notebook is not connected

Your people, the facts of your life and what happened live in your notebook: its People,
My Profile, World and Timeline pages. Your assistant writes them there with the notebook's
tools (`AGENTS.md`, "My notebook"), so this folder is not their home and keeps no second copy.

This folder is the plain-file fallback. An assistant on a computer where the notebook's
tools are not connected saves people, events and facts here instead, in the formats below.
They are not lost: the notebook's search, which your assistant uses, reads the facts in
`claims/` and every file here, though the notebook's pages show only what is in the notebook.
Whatever the notebook, this is also where a finished deadline is written down (below).

Everything here is one small text file, so a script can answer questions like "what changed about
Peter this year" without an AI model and without the internet. The AI only steps in when language
is needed.

## The three kinds

1. **Entity**: a thing that exists. A person, a place, an organization, a project, an object.
   One file per entity in `entities/`.
2. **Event**: a thing that happened. It has a date. One file per event in `events/`.
3. **Claim**: a fact believed about an entity. "Peter is my friend", "the flat costs 900 euros".
   One file per claim in `claims/`.

The one useful difference: **an event never changes, and a claim can stop being true.** That is
why a claim can carry a start date and an end date, and an event only carries its day.

## Who owns a file, which is the only rule here

Every file carries an `origin:` line, and it decides who may write to it.

- `origin: mission control` means you or your assistant wrote it locally. The pull never touches it and never
  deletes it.
- `origin: menerio` means an older Menerio connection wrote it and this is a copy. That
  connection rewrote it on every pull, so **fix the fact in the notebook instead.**

A file with no `origin:` line at all counts as `origin: mission control`, so anything you write by hand is
safe by default.

No fact ever has two writers. That is why there is no merge step, nothing to resolve, and no
"last write wins" quietly picking a loser.

## The file formats

Every file starts with a small block between `---` lines, then free text.

`entities/<slug>.md`:

```
---
slug: peter-mueller
origin: mission control
name: Peter Mueller
type: person
aliases: [Peter, Pete]
---
Free-text description.
```

`events/YYYY-MM-DD-<slug>.md` (the date prefix makes the folder sort by time):

```
---
date: 2026-08-11
origin: mission control
participants: [me, peter-mueller]
source: where this came from
---
What happened, in free text.
```

**An event can finish one of your deadlines.** Two more lines do it:

```
closes: [due/car-service]
evidence: the garage's invoice is in my mail, 2027-01-12
```

`closes:` names files in `due/` that this event finished (`due/<name>#<first day>` names one
window of a repeating one); `drops:` works the same for one you called off. `evidence:` is
required: an event that says a thing is done without what shows it closes nothing. This is the
only place "done" is written, so the deadline list, your brief and your assistant all read the
same answer. `mc-due done` writes such an event for you.

`claims/<subject>--<attribute>--<date>.md`:

```
---
subject: peter-mueller
origin: mission control
attribute: relationship-to-me
value: friend
valid_from: 2024-03-01
confidence: certain
source: you said it
---
Optional detail.
```

`type`, `attribute` and `confidence` are open vocabulary. A missing `valid_to` means "believed
true today". A missing `valid_from` means "true since before you started recording".

## Filling it

The assistant writes local records directly. Search first, reuse existing people, and keep
the source of every event or fact. Do not invent dates. When a fact changes, add its replacement
and close the old claim with `valid_to`; keep the old file. Tell the user what you saved.

For example, a confirmed move becomes a dated event and a new current-city claim. The earlier
city claim gets an end date. A guess about why the person moved belongs in `observations/`.

### Moving in from Menerio

Notes, people, facts and timeline entries from Menerio, an older notes app, are brought into
the notebook itself, not into this folder: the notebook's Settings has "Import from Menerio".
Files here marked `origin: menerio` came from an older connection that copied Menerio's
records into this folder; correct those facts in the notebook.

To find a record, your assistant searches the notebook, which reads these files too. Without
the notebook it runs `mc-search <words>`, which searches the files here.

You can also write these files by hand, or let your assistant write them. The formats above are
the whole contract.

## When a fact changes

A claim that stops being true gets a `valid_to` date and stays. That is half the job. The
other half is asking what you wrote while it still held. `mc-check-built-on` reads every
claim with an end date, searches `profile/`, `rules/`, `procedures.md` and `AGENTS.md` for
the old value, and names each line it finds. It changes nothing; you decide whether a line
is stale or is history. Two rules make it useful:

- **To keep an old value on purpose, put the date it stopped being true on the same line.**
  "We lived in Krefeld until 2026-03-01" is history and is never reported.
- **A file can say what it depends on.** A `rests_on: [peter-mueller/employer]` line at the
  top of a rule or a note means the file is listed when that fact changes, even when the old
  value is not written in it. Your assistant can add the line when it writes the file.

```
mc-check-built-on                        every fact that changed
mc-check-built-on --claim me/city        one fact
```
