---
name: tracker
description: Track anything the person names. Use for every message that starts with "track" (any case, typed or dictated, "Track:" too, also inside a German sentence), the habits, headaches, the period and food included, since this recipe hands those on; when they answer yes to "Start a new tracker called ...?"; when they ask to set up a tracker ("I want to track my sleep: hours and quality"); when they correct or delete a tracked entry ("that was 91, not 92", "delete the last belly", "delete the last walk to work"); and when they ask about something they track ("how has my belly changed this month?").
---

# Tracker

Every tracker is a collection in the notebook, and every habit the coach keeps is listed as a
tracker too. You never create a tracker without the person's yes.

## Who gets "track"

Read the trackers first: `personal_operation {"type":"tracker-list"}`. Then, in this order:

1. **An active habit**, by its name or other name (a tracker with `"specialist":"habit"`: "track
   walk to work"): `{"type":"track","tracker":"<its id>","words":"<their message>"}`, with `"answer":"no"` or
   `"answer":"skip"` when they say so and `"on":"YYYY-MM-DD"` for another day. The coach's own
   record gets the day and their words. "It was a no": `{"type":"tracker-correct","tracker":"<its id>","answer":"no","words":"<their message>"}`.
   "Delete the last walk to work": `{"type":"tracker-correct","tracker":"<its id>","remove":true}`.
   Reply with the operation's `reply` and nothing else.
2. **A headache, a pill or a pain level** ("track headache since 6:30, right side", "track a pill",
   "track pain 5"): load the headache-tracker recipe and do what it says; its `godspeed-headache`
   command keeps the Headaches tracker. Never `track` on the Headaches tracker
   (`"specialist":"headache"`).
3. **The period or the cycle** ("track period", "track Periode", "track period over", or a cycle
   symptom such as "track cramps"): load the cycle-tracker recipe and do what it says; its `cycle`
   operation keeps her cycle tracker. Never `track` on the cycle tracker (`"specialist":"cycle"`).
4. **Food, a meal or something they ate or drank** ("track food, tofu with rice", "track lunch, two
   eggs", "track usual breakfast"): load the food-tracker recipe and do what it says; its `food`
   operation keeps their food tracker. Never `track` on the food tracker (`"specialist":"food"`).
5. **One of the trackers' names or other names**: yours, below.
6. **Anything else**: a new tracker, asked about once, below.

The journal no longer takes "track".

## What to do

1. The trackers you read above list every tracker with its other names, its columns and current
   hashes, and every open question.
2. The name is a tracker's name or other name: `{"type":"track","tracker":"<id>","value":<number>}`.
   It clearly means one tracker under a word not yet listed ("waist" for Belly): add
   `"new_name":"Waist"` and the tracker's hash, `"expected":{"collections/<id>":"<hash>"}`.
   Two trackers could fit: ask which, write nothing.
3. No tracker fits: `{"type":"tracker-hold","name":"<Name>","unit":"<unit or omit>","value":<number>}`.
   Something that happened, with no number ("track sauna"): only `{"type":"tracker-hold","name":"Sauna"}`;
   it becomes a tracker that counts each time. Name the talk only when it obviously fits, as the coach area is called (a body measurement:
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
