---
name: tracker
description: Track anything the person names. Use when a message starts with "track" (any case, typed or dictated, "Track:" too) and what follows is not a habit Mission Control coaches and not a headache; when they answer yes to "Start a new tracker called ...?"; when they ask to set up a tracker ("I want to track my sleep: hours and quality"); when they correct or delete a tracked entry ("that was 91, not 92", "delete the last belly"); and when they ask about something they track ("how has my belly changed this month?").
---

# Tracker

Every tracker is a collection in the notebook. You never create one without the person's yes.

## Who gets "track"

1. "track" plus the name of an active habit ("track walk to work") belongs to the coach recipe.
2. "track headache ...", a pill or a pain level belongs to the headache-tracker recipe.
3. Everything else is yours. The journal no longer takes "track".

## What to do

1. Read the trackers: `personal_operation {"type":"tracker-list"}`. It lists every tracker with
   its other names, its columns and current hashes, and every open question.
2. The name is a tracker's name or other name: `{"type":"track","tracker":"<id>","value":<number>}`.
   It clearly means one tracker under a word not yet listed ("waist" for Belly): add
   `"new_name":"Waist"` and the tracker's hash, `"expected":{"collections/<id>":"<hash>"}`.
   Two trackers could fit: ask which, write nothing.
3. No tracker fits: `{"type":"tracker-hold","name":"<Name>","unit":"<unit or omit>","value":<number>}`.
   Name the talk only when it obviously fits, as the coach area is called (a body measurement:
   `"talk":"health"`).
4. They say yes to an open question: `{"type":"tracker-create","proposal_id":"<id>"}`, with any change
   they asked for ("call it Waist": `"name":"Waist"`).
5. Another day ("yesterday", "on Friday"): pass `"on":"YYYY-MM-DD"`.
6. Changing an existing entry (same day on a once-a-day tracker, a correction, a delete) needs its
   hash: pass `"expected":{"collection_items/<id>":"<hash>"}` from `tracker-list` (`today` or `last`).
   A correction: `{"type":"tracker-correct","tracker":"<id>","value":<number>}`; a delete adds
   `"remove":true` instead of a value.
7. Reply with the operation's `reply`, in the language they wrote in, and nothing else.
8. A question about what they track: `{"type":"tracker-list","days":<days asked about>}` gives each
   tracker's entries of those days under `recent`. Answer from those entries only.

## Never

- Create a tracker without their yes, or send anything about a tracker on your own.
- Ask them to track something. A reminder is a habit, not a tracker.
- Say "logged". Say "tracked".
- Use em dashes.
