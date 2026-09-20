---
name: keep-a-note
description: File a note in the person's Menerio notebook when they say "make a note", "note that", "write this down", "remember this for my notebook" or anything like it. Picks the folder, gives it a title, links it to the notes it belongs with, and reports the title, the folder and the links in three short lines. Needs the `notebook` tools; without them the note goes into the hub's own files and the reply says so.
---

## What this is

The person keeps a notebook in Menerio and does not want to keep it by hand. They say one
sentence, from a desk or from a chat on a phone, and expect what a good assistant would do:
the note filed where such things live, linked to what it belongs with, and a short reply
saying where it went. A note dropped at the top level with no links and the reply "Noted."
is the failure this recipe exists to prevent.

## Steps, in this order

1. **Check the tools.** You need `list_note_folders`, `search_notes` (or `search_brain`) and
   `capture_note` from the connection named `notebook`. If they are missing, skip to
   "Without the notebook" below.
2. **Look at the folders.** Call `list_note_folders`. Pick the folder this note belongs in.
   If none fits, choose ONE new folder with a plain name a person would use, such as
   `Health`, `Work`, `People`, `Ideas`, `Home`, at most two levels deep. Never pick or create
   anything under `hub`: that tree is a program's copy of this folder.
3. **Find what it belongs with.** Search the notebook for the people, things and topics in
   the note, with `source` set to `native` where the tool offers it, so you see notes the
   person wrote and not copies of hub files. Keep at most three notes that are truly related.
   None is a fine answer.
4. **Write the note.** A short title a person would search for, with the name of whoever said
   it when somebody did. The text stays the person's own words, tidied, never padded. Keep
   "she hinted" apart from "she promised". Below the text add one line,
   `Related: [[Exact Title]], [[Exact Title]]`, using the exact titles from step 3. Leave the
   line out when there is nothing to link.
5. **Save it once.** Call `capture_note` with `title`, `folder_path`, `tags` (two to five
   plain words) and `content`. Do not call it twice. If the answer names related notes you
   had not found, you may mention them in your reply; do not save again.
6. **Report.** Exactly this shape, in the language the person used, nothing before it and
   nothing after it:

   ```
   Saved: "<title>" in <folder>.  (say "a new folder, <folder>" when you created it)
   Linked to: "<title>", "<title>", because <half a sentence>.   (with nothing to link, the whole line is: No links yet, nothing related in your notebook.)
   Tags: <tag>, <tag>, <tag>.
   ```

   No ids, no tool names, no "let me know if". If the person's sentence held a thing to do
   or a date, add one fourth line that says so and offers nothing else.

## Moving and fixing

"Move that to Work", "rename it", "add that Priya takes it with food": use `update_note` on
the note you just saved, then answer in one line what changed. If you cannot tell which note
is meant, ask which, with the two most likely titles.

## Without the notebook

The hub works without Menerio. Save the note the way `AGENTS.md` says: a fact or an event
about the person's life goes in `world/` in the format of `world/README.md`; anything else
goes in `inbox/` as one file. Then report in two lines: what you saved and where, and that
the notebook is not connected on this computer.

## Never

- Never put a password, a card number or an access key in a note. Say that you left it out.
- Never invent a detail, a date or a dose the person did not say.
- Never save under `hub/`, and never edit a note whose source is a hub file.
