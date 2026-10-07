---
name: strip-ai-tells
description: Edit a manuscript, chapter, post or page that sounds machine-written while preserving its author's meaning, facts, terminology and voice. A scan is available on request; edit is the default.
---
# Strip AI tells

The result is the edited file. A list of defects for the user to repair is not an editing result.

## Read before editing

Read the user's profile/voice.md, the target's conventions and the strongest two pages of the actual text. Use those pages as the voice to edit toward. Never substitute a generic voice. If no voice rules are configured, report that limitation and preserve the voice demonstrated by the supplied text.

Keep quoted output word for word, fenced code, printed prompt registry links, parsed comments, anchors, heading text, Mermaid diagrams and defined terminology intact. A permitted ellipsis must show where quoted material was removed. Never invent facts, experiences, numbers, examples, promises, typos or slang. Do not flatten every sentence to the same length.

## One piece

1. Read the entire piece before editing. Mark each real catalogue hit with its line and pattern.
2. Edit in one pass, deleting decorative sentences where that preserves meaning. Change a sentence only when it has a recognizable tell, unnecessary inflation or repetition.
3. Read the edited piece cold. Check that the author's meaning, difficulty, humour, certainty and technical terms survived. Leave good writing alone.
4. Run `node notebook/bin/check-voice.mjs --workspace <workspace> --check <file>` from the installed kit. Use `--long-form` for a manuscript: sentence length is a rhythm signal, not a reason to split a sentence mechanically. A missing configured rules block must remain explicit.
5. Retain the original, save the actual edited file and read it back. Commit one piece at a time only when repository edits were authorized.

## A whole book

Use the book's existing queue and audit when present. Do not create a parallel queue. Work one chapter per pass and carry an inventory of phrases, metaphors, openings and endings already used. Search the whole manuscript for a caught phrase before fixing only one instance. Compare openings and endings across chapters. Keep the book's own defined vocabulary stable. Never import another author's incident history or private examples.

## Handoff

One short sentence describing the actual edit, with the edited file. In scan mode, rank the worst pieces with concrete patterns and locations; write nothing. Check that formulas were removed rather than exchanged for other formulas, genuine quotations stayed intact, and the narration about what the text will do disappeared.

# The catalogue


Six families. Each lists the tells and the fix. None of these is a ban: a natural sentence is
allowed to use an ordinary construction. What marks text as machine-written is **accumulation**, so
judge a hit against how often the shape has already appeared, not against the phrase list alone.

Characters and words that are banned outright, everywhere, live in `profile/voice.md` and are
enforced by a script. They are not repeated here.

---

## A. The text narrating itself

The most common tell in long-form writing, and the one readers feel as "this was assembled, not
written". A model produces it while trying to manufacture continuity it never planned.

**Forward:** the rest of this book / the rest of this chapter / everything that follows builds on /
we will return to this / as we will see / in the next section / later in this book / keep this in
mind / this will matter later / for the remainder of this chapter.

**Backward:** as we discussed earlier / as you have already seen / as we learned in Chapter 2 / now
that we have covered X / building on what we discussed.

**Roadmap:** in this chapter we will explore / first we will look at / before we dive into / let us
start by / let us break this down / now let us turn to / with that foundation in place / we will
cover this in more detail shortly.

**Fix:** delete. Most of these tell the reader nothing they can act on. Where a pointer genuinely
orients somebody, keep exactly one clause saying what is waiting there and why they would want it.
A pointer that names neither is worse than no pointer. Do not keep telling a reader that something
matters later; make it matter when they arrive. A chapter almost never needs to announce the subject
it is about to start.

## B. Stock constructions and manufactured contrast

**Formulas:** at its core / at the heart of / the key is / the real power lies in / what makes X
powerful is / what matters most is / here is the thing / the result? / the good news? / the bottom
line? / the takeaway? / think of it as / imagine / in other words / put simply / from X to Y / more
than just / that is where X comes in / this is where it gets interesting / and that is exactly the
point.

**Contrast frames:** not X but Y / not just X but Y / less X, more Y / rather than X, Y / instead of
X, think Y / X sounds simple, but / X may seem like, but.

**Fix:** keep a contrast that carries a real distinction. Rewrite the ones that exist because the
sentence wanted a flourish. Watch for the trap of swapping one frame for another, which changes
nothing.

## C. Filler shapes

**Suspiciously neat triads.** Three polished items, every time: faster, easier and smarter /
understand, organise and act / simple, powerful and flexible. Do not mechanically convert every
three into two. Ask whether all three earn their place, then cut the decorative one. Across a book,
reduce the sense that every idea conveniently arrives in a set of three.

**Transition addiction.** However / moreover / furthermore / additionally / ultimately / crucially /
importantly / interestingly / in practice / in essence / that said / with that in mind / at the same
time / on the other hand / as a result. The best replacement is usually nothing at all. Let
paragraphs follow each other when the connection is obvious.

**Over-explaining.** The five-step loop: make a point, paraphrase it, explain the paraphrase, give
an example, restate the point. Markers: in other words / what this means is / to put that another
way / essentially / in practical terms. Compress. Do not assume the reader missed the previous
sentence.

**Mini-conclusions.** A tidy summary at the end of every section: "ultimately the key is to find
what works for you", "by understanding these principles you can", "and that is what makes this so
powerful". Delete the ones that only restate what was just read. A section may end on its last real
point.

## D. Sentences that say nothing

**Generic abstraction.** "This creates a more intuitive experience." "This opens up new
possibilities." "The implications are profound." "This represents a significant shift." The test:
could this sentence appear unchanged in a hundred unrelated articles? If yes, make it concrete, say
what specifically changes, or delete it.

**Machine vocabulary** beyond the banned list: nuanced, multifaceted, holistic, pivotal, crucial,
foster, streamline, facilitate, enhance, optimise, dynamic, ecosystem, journey, paradigm,
intersection, boundaries, intentional, thoughtfully, inherently, fundamentally. Plus the
domain-neutral nouns a model reaches for when it has nothing specific: context, capability,
approach, experience, interaction, system, process, framework. Keep them where they are precise.
Rewrite them where a plainer word would say more.

**Consulting language.** Drive adoption, unlock value, enable transformation, accelerate outcomes,
maximise impact, deliver value, align stakeholders, scalable solution, strategic approach. Keep real
specialist terms. Cut the presentation deck that wandered into the prose.

**Synthetic enthusiasm.** Powerful, exciting, remarkable, incredibly useful, revolutionary, amazing.
Show the benefit instead of naming it.

**Unearned certainty.** The reality is / the truth is / there is no question that / one thing is
clear / it is clear that / the answer is simple / this changes everything. Replace with the actual
claim. Do not hedge a claim the author has grounds for.

**Defensive hedging.** Clusters of generally, typically, often, potentially, in many cases, to some
extent, relatively, arguably, may, might. Keep the qualifications that are intellectually necessary,
cut the ones protecting nobody.

## E. Fake intimacy with the reader

**Manufactured reactions.** You might be wondering / if you are like most people / we have all been
there / you may feel overwhelmed / do not worry / the good news is / you are not alone. Delete these
when the text has no way of knowing what the reader feels. Where a real objection exists, answer it
directly instead.

**Coaching cadence.** You can, you will, you need to, you should, all you have to do, simply, just.
Second person is fine and this book is written in it. The tell is nearly every paragraph telling the
reader what they can or should do. Vary it.

**Fake punchiness.** The reason? Simple. / The problem? Memory. / No setup. No hassle. / And the
best part? / That is it. / Powerful. One strong fragment works. A page of them reads as marketing.

**Manufactured symmetry.** "It does not replace your judgment, it amplifies it." "The system adapts
to you rather than forcing you to adapt to it." These can be excellent sentences. The defect is
accumulation: when too many lines sound quote-ready, flatten some back into ordinary prose.

## F. Shape, visible only at book scale

**Paragraph architecture.** Claim, explanation, example, neat closing line. Or setup, contrast,
resolution. Or topic sentence, three supports, small conclusion. When every paragraph runs the same
invisible template, vary it. Some paragraphs are one sentence. Some develop an observation and stop
without wrapping it up.

**Sentence rhythm.** Repeated long-sentence-then-short-punchline, repeated rhetorical question then
immediate answer, repeated colons, repeated "This means", repeated "That is why". Fix enough
instances to restore a natural rhythm. Do not randomise sentence length mechanically.

**Chapter openings.** Compare them against each other: imagine / think about / most people / at
first glance / here is the problem, plus anecdote-then-lesson and question-then-answer. Each chapter
should open the way its own subject deserves.

**Chapter endings.** Summary plus preview, "now that you understand X you are ready for Y",
motivational takeaway, three-item recap, neat aphorism. A chapter does not need to hand the reader
ceremonially to the next one. End on the strongest real idea.

**Repeated conceptual vocabulary.** A model gets attached to a small set of nouns and reuses them
for everything: context, control, memory, workflow, system, capability, approach, framework. Where
the repetition is not carrying meaning, name the specific thing instead. Where the term is the
book's own defined vocabulary, leave it exactly as it is.

**Vague referents.** This approach, this process, this shift, this capability, these insights. Cover
everything above the sentence and ask what the word points at. If the answer is not immediate, name
the thing.

---

## The last check, before handing the text back

1. Does it still sound like the same author?
2. Were formulas removed, or only exchanged for different formulas?
3. Is the narration about what the book is about to do gone?
4. Did the technical meaning survive intact?
5. Was genuinely good writing left alone?
