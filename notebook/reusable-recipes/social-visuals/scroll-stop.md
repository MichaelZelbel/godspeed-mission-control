# Scroll-stop: four pictures for a post, filtered by looking

The default way to make the picture when the user has not described the frame.

The idea behind it: ideas are cheap, and your own opinion of an idea is weak evidence. A rendered
picture, seen at feed size, is the only real test. So pictures get made early and cheaply, and
are thrown out by looking at them, not by arguing about them.

**After the exact paid budget is approved, do not ask further preference questions along the way.** No shortlist in words, no sketches to choose from.
Render, filter, then show him four finished pictures on one page.

The mechanical steps are one command each: `skills/social-visuals/scripts/round.mjs`
(called `round.mjs` below).

## 0. Before starting

Read the post, the style profile (`brand/visual-style/selected.json`) and
[recipe-v1.md](recipe-v1.md). Write the core metaphor in one line, for example: "something that
already knows you, so you never have to say it twice". Work in `work/visuals/<date>-<slug>/`.

## 1. Twenty ideas in forced slots

One model writing a long free list repeats itself; constraints produce variety. Write exactly
twenty, at least two per slot, to `ideas.md`:

1. It contains a living thing (a real animal or plant; a person's trace does not count).
2. No object at all: only a surface, a space or a landscape.
3. Absurd scale: far too big, far too many, or far too small.
4. Caught in the act: something mid-destruction or mid-accident.
5. Genuinely funny: a stranger smiles before understanding why.
6. Frozen motion: something obviously moving, stopped.
7. The words are the only object: the sentence itself is the physical thing.
8. Free, as long as it is not a cousin of one above.

Each idea is three lines. An idea with no concrete `frame` is a word, not an idea; replace it.

    object  the thing, nameable by a twelve year old in one word
    frame   the exact photograph in one sentence: what is in frame, from where, in what light
    words   the sentence made out of the object (five to ten words), or "none"

## 2. Six concepts, two frames each

Keep six, from at least five slots. Write down in `ideas.md` why each cut died. Kill on sight:

- **Objects nobody knows**: a whetstone, a caddisfly, a bowerbird, a record run-out groove.
- **Tasteful still lifes with nothing happening and no joke**: a worn stone step, a desire path.
- **Pictures that read as another subject**: a detective board reads as a murder case, a ball of
  rubber bands as hoarding, pencil marks on a door frame as a prison cell, an elephant in a
  living room as "the elephant in the room" (the thing nobody mentions, the opposite message),
  a rope tied round a hand as being tied up.
- **Cousins**: two handwritten "we know you" notes are one idea. Keep the stronger.

For each of the six write three frames (close or wide, side-lit or backlit, whole or cropped
hard), keep the best two in `frames.md`, and write each as a recipe `<nn><a|b>-<slug>.json`.
That is twelve candidates. List them best first.

For a picture with no words, override `the_one_rule` in the recipe ("There are NO words anywhere
in this picture...") and ban all lettering in `strict_negatives` in capitals. Ban brand names,
logos and readable company names in every recipe.

## 3. Sketch at 1K, inside the budget

Use the current cited 1K and 2K prices to approve the exact thirteen-task maximum and total credits. Nine sketches and four finals are the default; stop before spending beyond the approved cap.
    node round.mjs sketch work/visuals/<dir> <recipe1.json> <recipe2.json> ...

It forces 1K, renders in parallel, writes a 400 px copy beside each sketch, and prints what each
task really charged. **Count spend from those per-task figures, never from the balance**: the
balance may include other activity on the same account.

A task timeout does not prove whether it charged. Retain its actual task ID and read the provider record; do not purchase an automatic replacement.
coins). Thin the repetition ("the coins are one soft heap, do NOT draw them individually") and
render again as a new recipe. Many repeated marks on a surface come back as ruled columns that
read as prison tallies: ask for scattered marks with bare space between them, and ban tallies.

## 4. Judge at feed size

Read every `.400.jpg` with the Read tool. One question each:

**Is there ONE thing in this frame that reads at 400 pixels, in under a second?**

Kill anything busy when small, flat mid-tone overall, words that cannot be read small (including
words whose first letters fade into the frame edge or into fog), or anything that reads as
another subject. Only then open the survivors full size to check spelling, printed-looking
lettering, brand names and anything unpleasant. Rank the survivors.

## 5. One blind judge

    node round.mjs blind work/visuals/<dir> <survivor1.jpg> <survivor2.jpg> ...

It copies the feed-size survivors under letters (so filenames give nothing away), writes the key,
and prints the prompt. Spawn exactly ONE agent with that prompt and the post text, and nothing
else: no recipes, no reasoning, no ranking of yours.

Combine the rankings. A picture both of you picked beats one only one of you picked. Of two
cousins (the same cup twice, the same dog twice), keep one. When the last place is a toss-up,
prefer the picture that adds a different idea to the set over a second version of an idea
already in it.

## 6. Final renders at 2K

    node round.mjs final work/visuals/<dir> <recipe.json> <sketch.jpg> final-<n>-<slug>

It puts the sketch into `image_input` with an instruction to reproduce that exact photograph,
renders at 2K, and stamps it twice: `.stamped.jpg` (the selected standard mark) and `.stamped-instagram.jpg`
(the selected alternate-platform mark). Look at every actual result and check its fidelity to the chosen sketch. If one drifts in a way that loses what made it work, render once more as a plain
re-roll and judge it again at 400 px.

## 7. What reaches the user

One readable preview page and a short result message. Use an available local preview by default; an external publication requires explicit approval. Include:

- one sentence per picture saying what it is, in the final ranking order;
- in one line each: what the blind judge picked that you did not, and what you picked that it
  did not;
- a one-line receipt: the price per picture, how many sketches, how many died at feed size,
  credits spent.

Then commit the recipes and `ideas.md` / `frames.md` and push. The JPEGs are git-ignored.

When the user selects a picture and explicitly authorizes the outward Planino preparation, the Planino side is: a new project with `content_type: image` and
`sibling_of` the text post, the stamped picture uploaded and attached to the project, one post per
platform for the user-selected platforms, Instagram's `media_url` set to the Instagram-stamped copy, and nothing scheduled
until he gives dates.
