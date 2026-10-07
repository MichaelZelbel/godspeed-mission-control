---
name: video-hooks
description: Use when the user wants a hook for a YouTube video or a Short, the first sentence or two he says on camera, from a script, beat sheet or bullet list that already exists. Trigger on "write me hooks", "hook ideas for this video", "how should this video open", "these hooks don't work", or a rejection of an earlier set. Writes wide in forced slots, then a judge that did not write them checks every candidate against the script's facts and against every note he has ever given on this video, and only the survivors reach him. Three good ones, or "none passed and here is why", never eight weak ones. Not for titles, thumbnails or post images.
---

# A hook for a video

**A hook is not an opening.** An opening tells the viewer who is talking. A hook makes the viewer
need the next sentence, because the first one said something about THEIR life that they want
settled. Everything here serves that.

**The asymmetry the whole method rests on:** judging a line against written tests is reliable,
writing one that passes truth, novelty and viewer stake at once is not. So write many, judge all,
show few.

Work in the video's folder (`work/visuals/<date>-<slug>/`). Files: `hooks-brief.md`,
`hooks-candidates.md`, `hooks-verdicts.md`. The survivors go into the script file's hook section.

## 1. The brief, before writing a single hook

Write `hooks-brief.md` from the material, not from memory:

1. **The payoff, one sentence, in the viewer's terms.** What can a stranger do, get or stop
   worrying about after watching? Not what the user did.
2. **The viewer.** Who watches this, and how aware they are of the problem: does not know they
   have it, knows the problem, knows solutions exist, or is comparing them. A viewer who does not
   know they have the problem gets a hook that shows them their own situation, not the solution.
3. **What happens in the video.** Every fact the video shows, one line each, with the beat
   number. This is the list a hook is checked against.
4. **What does NOT happen.** The tempting claims the video cannot back: a how-to it never shows,
   money nobody was owed, a feeling nobody had. Write the obvious ones down, because the
   generator will reach for them.
5. **Every note the user has given on this video's hooks, verbatim where the record has it**,
   and every rejected hook set as its one-line idea. Look in the script file, its git log and
   `observations/`. **A new note is ADDED to this list, never swapped for an older one.** This
   list is where the five-set failure came from; keep it whole.
6. **What the video's end pays off** (the beat that answers the hook), so no hook promises past it.

If the payoff cannot be written in one sentence in the viewer's terms, stop and say so: the
video has no hook yet because it has no promise yet, and more lines will not fix that.

## 2. Twenty candidates in forced slots

One writer making a free list repeats one idea. Write at least twenty to `hooks-candidates.md`,
two or more per slot, each one tagged with its slot and its idea in twelve words or fewer:

1. **Their moment.** A scene from the viewer's own week that this video is about. They should
   recognise it before they know what the video is.
2. **The cost.** What it costs them, right now, not to know this. Concrete: time, money, a thing
   they gave up on.
3. **The wrong belief.** Something they believe that the video shows is not so. This is the
   "you really ought to know this" door.
4. **The flat promise.** The payoff as a plain statement in the first six words.
5. **The turn.** What everyone thinks, a "but", then the thing the video shows instead.
6. **The true surprise.** The most surprising fact in the video, said as what it means for the
   viewer, not as a number they have to interpret.
7. **Their question.** The question they would ask a friend who had just lived through it.
8. **Free,** as long as it is not a cousin of another slot.

**Name the concrete thing, never the abstraction.** "Your support ticket got closed" is a
scene the viewer has lived; "a company fixing its mistake" is an essay topic, and a stranger
fills it with whatever the news says about big companies this week. (the user, 2026-09-27, on the
first survivor: "If I hear that without context, I think you're talking about OpenAI and
Anthropic.")

the user may appear in a hook only AFTER the viewer has a stake, as the proof: "I know because
mine just did" can follow a promise, it cannot replace one.

## 3. The judge, who did not write them

Spawn a subagent with [judge.md](judge.md), the brief, the script, and the candidates shuffled
with their slot tags removed. The writer never grades its own lines. It returns
`hooks-verdicts.md`: for every candidate, every test, pass or fail with the quoted reason, and the
beat that proves any factual claim.

Then run `node notebook/bin/check-voice.mjs --workspace <workspace> --check` on the survivors.
A voice failure is a fail.

## 4. What reaches the user

- **Three to five survivors,** each with its idea in one line and the beat that pays it off. At
  most one per idea. Best first, and say in one sentence why it is first.
- **If fewer than three pass, say so plainly** and show which test killed the rest and what
  would have to change in the video (not in the hook) to pass it. "None passed" is a result.
  Handing over the least bad one without saying it is the least bad is how the checking ends up
  on him.
- Never say a hook "fits perfectly" unless the judge's verdict quotes the beat that proves it.

Write the survivors into the script file's hook section. Rejected candidates stay in
`hooks-verdicts.md`, not in the script.

## 5. When he rejects a set

1. Copy his note into the brief's note list, verbatim, next to the ones already there.
2. Add the rejected set's ideas to the list of ideas already tried.
3. Turn the note into a test the judge can run (a note like "these are not hooks" becomes "does
   the first sentence give the viewer a stake before it says anything about the user?"), and add
   it to the judge's run for this video.
4. Run steps 2 to 4 again, whole. Do not patch the old set.
