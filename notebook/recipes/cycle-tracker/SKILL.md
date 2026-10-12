---
name: cycle-tracker
description: The person's own cycle tracker, for her period. Use when she says "track period", "track Periode", "track period, heavy, cramps 2", "track period over", "Periode vorbei", or a cycle symptom with "track" ("track cramps", "track Krämpfe"); when she asks "when is my next period?" or "wann kommt meine nächste Periode?"; when she answers "Start a cycle tracker?" or "Leave this one out of the forecast?"; when she says a cycle was affected by pregnancy, breastfeeding or starting or stopping the pill; when she says "tell me two days before my period" or stops it; when she says "my health talk may read my cycle"; when she says "delete my cycle tracker"; and when she asks about a fertile window, ovulation, safe days or getting pregnant, which you decline.
---

# Cycle tracker

Her cycle tracker is a collection in her own notebook. It keeps the days of her period and a few
symptoms, and forecasts her next period once it has seen two whole cycles. Every number comes from
the notebook's `cycle` operation, never from you.

## What to do

Read where she is first: `personal_operation {"type":"cycle","action":"status"}`. It gives her
cycle tracker (or `null`) with its hash, today's entry and the last one with their hashes, the open
period, her cycles and what counts, and any open question. Pass `"language":"de"` in every call when
she writes German, `"language":"en"` when she writes English.

1. **A day** ("track period", "track period, heavy, cramps 2", "track cramps"):
   `{"type":"cycle","action":"track"}` with only what she said: `"flow"` (`spotting`, `light`,
   `medium`, `heavy`; `unspecified` when she has her period and did not say how much; left out for a
   day of symptoms only), `"pain"` (0 to 3, only a number she gave), `"pain_where"` (`belly`, `back`,
   `head`), `"symptoms"` (`cramps`, `headache`, `bloating`, `breast tenderness`, `acne`, `low mood`,
   `irritable`, `low energy`, `poor sleep`, `cravings`, `digestion`, `discharge`), `"note"`, and for
   another day her own day words, `"on":"yesterday"` or `"on":"Friday"` (the operation works out the
   date; a weekday is the most recent one), or `"on":"YYYY-MM-DD"` for a date she said. A second entry on a day she already tracked needs that entry's
   hash: `"expected":{"collection_items/<today.id>":"<today.hash>"}`.
   With no cycle tracker yet, the same call asks her the setup question and creates nothing. Her yes
   to it: `{"type":"tracker-create","proposal_id":"<the question's id from status.proposals>"}`.
2. **Over** ("track period over"): `{"type":"cycle","action":"over"}`, with today's hash when she
   already tracked today.
3. **When is my next period?**: `{"type":"cycle","action":"forecast"}`.
4. **"Leave this one out of the forecast?"**: yes is `{"type":"cycle","action":"leave-out"}`, no is
   `{"type":"cycle","action":"count"}`. A cycle affected by pregnancy, breastfeeding or starting or
   stopping hormonal contraception: `{"type":"cycle","action":"leave-out","why":"pregnancy"}`
   (`breastfeeding`, `contraception`), with `"start":"YYYY-MM-DD"` (the day it began, from
   `status.cycles`) when it is not the cycle she is in now.
5. **The heads-up** ("tell me two days before my period"): `{"type":"cycle","action":"heads-up","enabled":true}`;
   stopping it: `"enabled":false`. It is one line in her own morning brief, never a message.
6. **Her talk** ("my health talk may read my cycle"): `{"type":"cycle","action":"talk","talk":"health"}`.
7. **Delete** ("delete my cycle tracker"): `{"type":"cycle","action":"delete"}` asks her once and
   gives a `request_id` and an `expected` map. Only her yes to that question deletes:
   `{"type":"cycle","action":"delete","confirm":"<request_id>","expected":<that map>}`.

Steps 4, 5 and 6 change her tracker: pass `"expected":{"collections/<tracker.id>":"<tracker.hash>"}`
from status with them.

Reply with the operation's `reply`, word for word and whole, and nothing else. Never shorten,
summarise or reword it, or retype its quotes and punctuation in your own style: the setup question and every forecast carry sentences she must read (what the
tracker is not for, where her entries go, and that what she types and what you answer pass through
Telegram and her AI service). The rehearsal of 12 October 2026 showed a reply cut down to
"Start a cycle tracker? I've kept today as day 1."; that must never happen again.

## Never

- A fertile window, an ovulation day, "safe days", advice about conceiving or avoiding pregnancy, or
  a diagnosis. Asked for any of them: `{"type":"cycle","action":"decline"}` and reply with its line.
  Do not answer from your own knowledge either.
- Tell anyone else about her cycle, or send anything about it on your own. The heads-up is a line in
  her own morning brief, and only when she switched it on.
- Guess a flow, a pain number or a symptom she did not say, or do date sums yourself.
- Create her cycle tracker without her yes.
- Say "logged". Say "tracked". Use long dashes.
