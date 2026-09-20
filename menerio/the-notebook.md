# The notebook (Chapter 28)

The folder is what you teach: context, skills, rules, edited at your desk, one home on your
disk. The notebook is what you live: notes born out in the world, written from whatever device
is in your hand. You never copy anything between the two by hand. A program can do the one
copy that is useful, if you want it, and it keeps that copy current.

## What the mirror does, and whether you want it

Connecting Menerio gives you a notebook. It does not copy your hub. That is a separate
choice. The installer asks `Copy your hub's files to Menerio for search?` and the default
answer is no. Your answer is kept per computer, as one line in `~/.hub/device.env`:
`HUB_NOTEBOOK_MIRROR=1` for yes, `HUB_NOTEBOOK_MIRROR=0` for no. No line means no. To change
it, run the Menerio step of the installer again. It asks again.

Say yes if your hub holds nothing you would mind having in an online account. Your assistant
can then search your files by meaning. Say no if your hub holds other people's private
details, such as clients or patients. You still have the notebook, and search still works on
the files on your computer.

When the answer is yes, your hub folder is mirrored into the notebook. Every Markdown file
goes, except the `dev/` folder. The copies live under one folder called `hub`, laid out like
your hub: `profile/about-me.md` becomes a note in `hub/profile`. Each decision in
`decisions.md` becomes its own note.

- **The file stays the truth.** Every copy says in its first line which file it came from.
  Change the file in your hub, never the note. The copy follows by itself, within the hour.
- **Your own notes come first.** Menerio ranks mirrored copies below the notes you wrote
  yourself. It never mines the copies for facts, and it never exports them as files.
- **Only `observations/` is called a guess.** Those files are what a machine worked out about
  you. Their copies say so. Copies of `profile/` and `rules/` say that you wrote or decided
  them.
- **What stays home.** `dev/`, anything your hub's `.gitignore` keeps out, generated index
  files, any file over 300 KB, and the records in `world/` that came down from Menerio in
  the first place.

Your assistant finds things through one command, `hub-search`. With the mirror on, it asks
Menerio first, which searches by meaning and by words together. When Menerio cannot be
reached, it searches the files in your hub and says so. With the mirror off, it searches the
files on your computer, and its last line says
`source: local files (your hub is not copied to Menerio, so there was nothing to ask it)`.
Either way it names files in your hub, never notes.

The same yes switches on one more thing. Every hour, a job brings the people, events and facts
Menerio holds down into `world/` in your hub, as a safety copy. With a no, nothing moves in
either direction, and nothing about Menerio runs in the background.

## The two rules

1. **Secrets stay out.** Chapter 19's piles decide: only "may travel" facts go in. For personal
   notes worth keeping anyway, every note has an **AI** switch; flipped to **Hidden**, the note
   is excluded from People, from the pages, and from every connected AI tool. A file that must
   never leave your computer belongs in `dev/` or in your hub's `.gitignore`.
2. **One fact, one home.** A fact born at your desk lives in the folder. A fact born out in the
   world lives in the notebook. Do not retype one into the other. The moment you keep two
   copies matching by hand, you are the sync program, and that person always quits. The mirror
   is not a second home: it is a copy a program keeps, and it says so.

## First notes

Sign up at https://menerio.com/auth?tab=signup (free account, **500 AI credits**, refills
monthly; a note costs about two). Press **New Note**: a title line, a page, saves itself while
you type. Write what happened, one note per thing, plain sentences:

```
Nadia budget news

Nadia said today the budget for next year's book has doubled. She
hinted there could be a second illustrated title in it for me.
```

On a phone, menerio.com is the same app in a narrower coat: search box on top, plus button for
a new note.

You can also tell your assistant "make a note about the call with Nadia". It picks the folder
that fits, links the note to related ones, and tells you the title, the folder and the links.
It never files your notes under `hub`, because that folder belongs to the mirror.

## The machine files, you review

Within a minute, the **Review Queue** fills with cards: people it noticed, projects, facts.
**Keep** what is right, **Roll Back** what is not, **Never Again** for things it should stop
proposing. Keep a person card and the **People** page gets a page for them, with every note
that mentions them attached. You review the filing; you never do the filing.

## Search

The search box takes questions ("what did the reprint cost") and bare names ("Nadia"). It
searches by meaning, not by magic: a query far from your own words can miss. Ask roughly the
way you wrote it.

## What happened to the folder import

Older printings imported the profile folder into Menerio by hand and asked you to import it
again every quarter. That made you the sync program between two copies, and it is retired. A
later printing copied nothing at all, then three folders only, and then the whole hub without
asking. Today a program mirrors the whole hub only when you said yes. You do nothing after
that, and the copies know they are copies.
