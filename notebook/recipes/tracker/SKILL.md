---
name: tracker
description: Track anything the person names. Use for every message that starts with "track" (any case, typed or dictated, "Track:" too, also inside a German sentence), the habits, headaches, the period and food included, since this recipe hands those on; when they answer yes to "Start a new tracker called ...?"; when they ask to set up a tracker ("I want to track my sleep: hours, and quality from 1 to 5"); when they correct or delete a tracked entry ("that was 91, not 92", "delete the last belly", "delete the last walk to work"); when they ask about something they track ("how has my belly changed this month?"); and when they say which coaching talk may look at a tracker or no longer needs it ("The health talk may also look at my sleep tracker", "The health talk no longer needs my sleep tracker").
---

# Tracker

Every tracker is a collection in the notebook, and every habit the coach keeps is listed as a
tracker too. You never create a tracker without the person's yes.

Pass their message, exactly as they wrote it, as `"words"` in every `track`, `tracker-hold`,
`tracker-create` and `tracker-correct`. The operation keeps it with the question, checks the day
against it, and refuses a call that needs it and lacks it.

## Who gets "track"

Read the trackers first: `personal_operation {"type":"tracker-list"}`. Then, in this order:

Habit cards include full-history `progress`, `doneMeans`, `days`, `daysText` and `started`.
Recent entry windows do not limit lifetime totals. Pass a habit's hash as
`expected:{"habits/<habit id>":"<hash>"}` when changing it. Its operation result supplies the
verified data for the same Telegram reply's calendar image. Do not invent numbers or send another
message to advertise progress. On request use `habit-progress` with action show, display (calm or
standard), pause, resume, exempt (inclusive from/to dates) or schedule (days and effective on date).
Holidays, illness and outages are exemptions, never scarce protection. Preserve unknown answers.

1. **An active habit**, by its name or other name (a tracker with `"specialist":"habit"`: "track
   walk to work"): `{"type":"track","tracker":"<its id>","words":"<their message>"}`, with `"answer":"no"` or
   `"answer":"skip"` when they say so and `"on"` for another day (below). The coach's own
   record gets the day and their words. "It was a no": `{"type":"tracker-correct","tracker":"<its id>","answer":"no","words":"<their message>"}`.
   "Delete the last walk to work": `{"type":"tracker-correct","tracker":"<its id>","remove":true}`.
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

1. The trackers you read above list every tracker with its other names, its columns (`fields`, each
   with its `key`) and current hashes, and every open question.
2. **The name is a tracker's name or other name**: `{"type":"track","tracker":"<id>","value":<number>,"words":"<their message>"}`.
   A tracker with several columns takes `"data"` with their keys instead of `"value"`: "track sleep,
   7 hours, quality 4" is `{"type":"track","tracker":"<id>","data":{"hours":7,"quality":4},"words":"<their message>"}`.
   It clearly means one tracker under a word not yet listed ("waist" for Belly): add
   `"new_name":"Waist"` and the tracker's hash, `"expected":{"collections/<id>":"<hash>"}`.
   Two trackers could fit: ask which, write nothing.
3. **No tracker fits**: `{"type":"tracker-hold","name":"<Name>","unit":"<unit or omit>","value":<number>,"words":"<their message>"}`.
   Something that happened, with no number ("track sauna"): only `{"type":"tracker-hold","name":"Sauna","words":"<their message>"}`;
   it becomes a tracker that counts each time. Name the talk only when it obviously fits, as the
   coach area is called (a body measurement: `"talk":"health"`); the operation keeps it only when
   that talk exists, and its question and reply say so only then.
4. **Setting one up on purpose** ("I want to track my sleep: hours, and quality from 1 to 5"): one
   tracker with every column they named, in one call, each with its label and type, a number's unit,
   and its range when they gave one:
   `{"type":"tracker-hold","name":"Sleep","fields":[{"label":"Hours","type":"number","unit":"hours"},{"label":"Quality","type":"number","min":1,"max":5}],"words":"<their message>"}`.
   It asks once ("Start a new tracker called Sleep, with hours and quality from 1 to 5, once a
   day?") and holds no entry, because nothing has happened yet. Never split their columns into
   trackers of their own, and never ask a question of your own in place of its reply.
5. **Their yes** to an open question comes in a later message: `{"type":"tracker-create","proposal_id":"<id>","words":"<their answer>"}`,
   with any change they asked for ("call it Waist": `"name":"Waist"`). Nothing else: the question
   already holds the columns. Never create a tracker in the turn that asked; only their answer to
   the question creates it, and the operation refuses the message that asked.
6. **Another day** ("yesterday", "on Friday", "gestern", "am Freitag"): always pass their own day
   words as `"on"`, such as `"on":"Friday"` or `"on":"yesterday"`, or `"on":"YYYY-MM-DD"` for a
   date they said. Never work out a weekday's date yourself: the operation does, and a weekday is
   always the most recent one before today. When their message names a day and `"on"` is missing
   or says another day, the operation refuses and names the day: send the call again as it says.
7. **Changing an existing entry** (same day on a once-a-day tracker, a correction, a delete) needs
   its hash: pass `"expected":{"collection_items/<id>":"<hash>"}` from `tracker-list` (`today` or
   `last`). A correction: `{"type":"tracker-correct","tracker":"<id>","value":<number>,"words":"<their message>"}`;
   a delete adds `"remove":true` instead of a value.
8. **Your reply is the operation's `reply`, exactly as it came**: the same words, the same quotes
   and the same punctuation, character for character, with nothing added and nothing left out.
   Never retype it in your own style. Only when they wrote in another language than the reply's,
   say it in theirs, and keep every number, name and day.
9. **A question about what they track**: `{"type":"tracker-list","days":<days asked about>}` gives
   each tracker's entries of those days under `recent`. Answer from those entries only.
10. **Which talks look at a tracker** ("The health talk may also look at my sleep tracker", "The
   health talk no longer needs my sleep tracker"): a talk reads the trackers whose card names it,
   and any number of talks may read one tracker.
   `{"type":"tracker-talk","tracker":"<id>","talk":"health","words":"<their message>","expected":{"collections/<id>":"<hash>"}}`
   adds that talk and never asks: the talks that read it already keep reading it. Taking one away
   adds `"remove":true`, and the others keep it. Only when their own words say instead ("the
   psychology talk instead of the health talk") add `"instead":true`: then that talk is the only one.
   The reply is your answer, as in 8. Anything else a talk may look at, or must never do, is the
   coach recipe's ("Changing an area").

## Never

- Create a tracker without their yes, or send anything about a tracker on your own.
- Ask them to track something. A reminder is a habit, not a tracker.
- Say "logged". Say "tracked".
- Use em dashes.
