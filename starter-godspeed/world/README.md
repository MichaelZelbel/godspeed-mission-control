# world - your life as data

Your assistant fills this folder as you tell it useful facts and things that happened.
It works without a Menerio account. The instructions in `AGENTS.md` tell the assistant to
save and search these records, using the formats below.

Menerio is an optional online notebook (Chapter 28). You connect it once, through the
installer or with `mc-menerio-connect`. That gives you the notebook and copies nothing.
Copying between your mission control and Menerio is a separate choice. The installer asks, and the
default is no. On a yes, your mission control's text files, this folder included, are copied up so they
can be searched by meaning, and the people, events and facts Menerio knows arrive here as
files marked `origin: menerio`, as a safety copy. The files that came down are not sent back
up. That connection is
specifically for Menerio, not a general connection to Evernote, OneNote or Obsidian.

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
- `origin: menerio` means Menerio wrote it and this is a copy. It is rewritten on every
  pull, so an edit made here is lost at the next one. **Fix the fact in Menerio instead.**

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

### Optional: import from Menerio

Once Menerio is connected, the import runs by itself: when you save a change, and once an
hour. To look at what it would do, or to run it by hand:

```
python3 ~/.local/bin/world-pull.py           # dry run, shows what it would write
python3 ~/.local/bin/world-pull.py --apply   # write the files
```

To find a record, your assistant runs `mc-search <words>`. When your mission control is copied to
Menerio, it asks Menerio first. When it is not, or when Menerio cannot be reached, it
searches these files, so your facts are found either way.

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
