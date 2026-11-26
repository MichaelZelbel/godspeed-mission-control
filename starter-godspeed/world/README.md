# world - moved into your notebook

Your people, the things in your life, the facts about them and what happened are records in your
notebook: its People, World, My Profile and Timeline pages. Your assistant writes them there with
the notebook's tools (`AGENTS.md`, "My notebook"), and your notebook carries them to your other
computers on its own. This folder is not their home and keeps no second copy.

An older version of this kit kept one small file per person or thing (`entities/`), per event
(`events/`) and per fact (`claims/`) here. When your notebook starts, and whenever a program of
this kit reads your facts, it takes any such file into its records, keeping every file whole, and
then moves the files to `archives/<day>-world-moved-to-the-notebook/`. Where your mission control
is a Git repository of its own, nothing is moved: the files stay as they are and a note,
`MOVED-TO-THE-NOTEBOOK.txt`, is left beside them. A file it cannot take in (it has no `---` front
matter, a fact with no subject or value, an event with no date) stays where it is, and your
assistant tells you in your brief or your chat which one and what to fix.

Do not write new files here. An assistant on a computer where the notebook's tools are not
connected saves nothing and says so, instead of leaving a file that no other computer would see.

## What is still a file here

`fields.json` (your own list of the kinds of fact that have one answer at a time, and the names
they go by) is configuration, not a record. It stays in this folder.

## A fact that holds a step back

When you decline or postpone something your mission control proposed, it files a claim with
`stance: declined` or `stance: postponed` (`mc-holds hold`). `steps: [interview]` names the kinds
of step it holds (without it, every step about the subject), and `until` makes a postponement last
only while another claim is current. A proposal that names the subject among the people and things
it touches (TOUCHES) stays off your card until the claim gets a `valid_to`, or the claim it waits
on ends. `mc-holds list` shows what is held.

Finishing one of your deadlines is not written here either: closing one is a moment on your
notebook's timeline, and `mc-due done` writes it.

## When a fact changes

A fact that stops being true gets a `valid_to` date and stays. That is half the job. The other
half is asking what you wrote while it still held. `mc-check-built-on` reads every claim with an
end date, searches `profile/`, `rules/`, `procedures.md` and `AGENTS.md` for the old value, and
names each line it finds. It changes nothing; you decide whether a line is stale or is history.
Two rules make it useful:

- **To keep an old value on purpose, put the date it stopped being true on the same line.**
  "We lived in Krefeld until 2026-03-01" is history and is never reported.
- **A file can say what it depends on.** A `rests_on: [peter-mueller/employer]` line at the
  top of a rule or a note means the file is listed when that fact changes, even when the old
  value is not written in it. Your assistant can add the line when it writes the file.

```
mc-check-built-on                        every fact that changed
mc-check-built-on --claim me/city        one fact
```
