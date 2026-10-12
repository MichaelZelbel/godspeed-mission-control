---
name: food-tracker
description: The person's own food tracker. Use when they say "track food, ...", "track breakfast", "track lunch", "track dinner" or "track snack" with what they ate, or anything they ate or drank with "track" ("track two eggs and a slice of rye bread", "track Frühstück, Haferflocken mit Milch"); when they answer "Start a food tracker?" or a question about an amount ("How big was the pack of rice?"); when they say "remember this as my usual lunch" or "track usual lunch"; when they correct or delete something they ate ("the eggs were three", "delete the eggs"); when they ask "what did I eat today?" or how many calories are left; when they say "set my food target"; when they say "stop showing calories" or "show calories again"; when they mention a pregnancy, breastfeeding or an eating disorder about their food; and when they give a barcode or a packaged product to track.
---

# Food tracker

Their food tracker is a collection in their own notebook. Each food they eat is a row. Its numbers come
from the German food table (Bundeslebensmittelschlüssel 4.0) or, for a barcode or a branded product,
from Open Food Facts, and the notebook's `food` operation works out every number, never you.

## What to do

Read where they are first: `personal_operation {"type":"food","action":"status"}`. It gives their food
tracker (or `null`) with its hash, today's rows and the last meal with their hashes, the target, their
saved meals, open questions, and whether the food table is installed. Pass `"language":"de"` in every
call when they write German, `"language":"en"` when they write English.

1. **A meal** ("track lunch, two eggs and a slice of rye bread"): find each food first,
   `{"type":"food","action":"search","queries":["eggs","rye bread"]}`. Each result lists `before` (foods
   they tracked before under that word), `foods` (the table, best first) and `products`. Choose the plain
   food they mean. When none fits, search again the way the table names foods, the food first and then
   what it is ("white rice raw", "chicken egg", "milk 1.5 % fat", "rye bread"); still nothing: ask them.
   Then `{"type":"food","action":"track","meal":"lunch","items":[{"food":"E111100","item":"eggs","count":2,"unit":"egg","grams":120,"assumed":true},{"food":"B271000","item":"rye bread","count":1,"unit":"slice","grams":50,"assumed":true}]}`.
   - `food` is the id the search gave; `item` is their word for it; `meal` is `breakfast`, `lunch`,
     `dinner`, `snack`, or `none` when they named no meal.
   - `grams` only when they said a weight. A piece of a standard size (an egg, a slice of bread, an
     apple) or a food with no amount: your typical weight as `grams` with `"assumed":true`; the reply
     says it was assumed.
   - A pack, bowl, plate, glass or can: `count` and `unit` ("half a pack": `"count":0.5,"unit":"pack"`)
     and no grams. Never guess its size: the operation asks them once and remembers the answer.
   - Another day: their own day words, `"on":"yesterday"` or `"on":"Friday"` (the operation works out
     the date; a weekday is the most recent one), or `"on":"YYYY-MM-DD"` for a date they said; another
     time: `"at":"HH:MM"`.
   With no food tracker yet, the same call asks them the setup question and creates nothing.
2. **Their yes to "Start a food tracker?"**: `{"type":"tracker-create","proposal_id":"<the question's id from status.proposals>"}`,
   with `"answers":[{"grams":250}]` when they gave the asked amount in the same message ("250 g, and
   yes"), and `"eating_disorder":true` when they say they have or had one.
3. **Their answer to an amount question** ("250 g"): `{"type":"food","action":"answer","grams":250,"question":"<status.questions id>"}`:
   the grams of the whole pack, bowl or glass, or of the item.
4. **"Remember this as my usual lunch"**: `{"type":"food","action":"remember","name":"lunch"}`.
   **"Track usual lunch"**: `{"type":"food","action":"track","preset":"lunch"}`.
5. **A correction**: "the eggs were three" is `{"type":"food","action":"correct","item":"eggs","count":3}`;
   "the rice was 150 g" is `"grams":150`; "delete the eggs" is `"remove":true`. Each needs that row's
   hash, `"expected":{"collection_items/<id>":"<hash>"}` from status (`today.rows` or `last_meal`), and
   `"entry_id":"<id>"` when two rows could fit.
6. **"What did I eat today?"**: `{"type":"food","action":"today"}`, with `"totals":true` when they ask for
   calories or totals, and `"on":"YYYY-MM-DD"` for another day.
7. **"Set my food target"**: `{"type":"food","action":"target"}` with only what they said:
   `"sex":"female"` or `"male"`, `"age"`, `"height_cm"`, `"weight_kg"`, `"activity"` (`sedentary`,
   `light`, `moderate`, `very`, `extra`), `"goal"` (`lose`, `keep`, `gain`). The operation asks once for
   whatever is missing and takes their weight from their health data when it is there.
8. **"Stop showing calories"**: `{"type":"food","action":"settings","numbers":false}`; "show calories
   again": `"numbers":true`. A pregnancy, breastfeeding or an eating disorder they tell you about:
   `{"type":"food","action":"settings","pregnant":true}` (or `"breastfeeding":true`, `"eating_disorder":true`).
9. **A barcode** ("track 20 g of 4008400401621"): `{"type":"food","action":"barcode","code":"4008400401621"}`,
   then track it with `"food":"off:4008400401621"`. **A branded product** by name:
   `{"type":"food","action":"product","query":"Haribo Goldbären"}`, then track the one they mean.
10. **Their talk** ("my health talk may read my food"): `{"type":"food","action":"talk","talk":"health"}`.

Steps 4 (remember), 7, 8 and 10 change their tracker: pass
`"expected":{"collections/<tracker.id>":"<tracker.hash>"}` from status. A reply that changed the tracker
gives its new hash as `tracker_hash` for the next change.

Reply with the operation's `reply`, word for word and whole, and nothing else: the same words, quotes and
punctuation, character for character, never retyped in your own style. Every number in it comes from the
food table, and the setup question carries sentences they must read (the numbers are estimates; an eating
disorder means no target).

## Never

- Work out calories, protein or a target yourself, or change a number in a reply.
- Guess the size of a pack, bowl, plate, glass or can, or their age, height, weight, activity or goal.
- Set or talk about a target for anyone under 19, pregnant, breastfeeding, or who has or had an eating
  disorder. With the numbers switched off, say no numbers.
- Create their food tracker without their yes, or send anything about it on your own. It never
  reminds them to track.
- Put a person's name or email into a lookup.
- Say "logged". Say "tracked". Use long dashes.
