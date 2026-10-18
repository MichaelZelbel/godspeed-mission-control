---
name: book-title-strategist
description: Generate, evaluate, and validate marketable titles and subtitles for nonfiction books. Use whenever a user is naming, renaming, positioning, comparing, or testing a book or ebook.
---

# Book Title Strategist

Create title and subtitle combinations that make the right reader recognize a wanted result, compelling idea, or useful category. Do not merely summarize the author's subject matter.

A strong title is a strategic hypothesis, not a guarantee of sales. Never promise that a title will make a book successful.

## Choose the operating mode

Use the mode that matches the request:

- **Create:** Develop title and subtitle candidates from a manuscript, outline, concept, or brief.
- **Audit:** Evaluate titles the user already has, explain what a cold reader will infer, and improve weak candidates.
- **Refine:** Preserve a chosen strategic direction while producing sharper variants.
- **Validate:** Research the current market, check likely collisions, and design a reader test.
- **Quick ideas:** Perform the strategy work internally, then return a concise list when the user explicitly wants speed.

## Load the right references

Use progressive disclosure rather than loading every file automatically.

- Read `references/01-strategy-brief.md` to frame the reader, promise, mechanism, proof, and market.
- Read `references/02-title-architectures.md` before broad title generation.
- Read `references/03-subtitle-design.md` before pairing subtitles.
- Read `references/04-scoring-rubric.md` before ranking or auditing candidates.
- Read `references/05-validation.md` for web research, collision checks, reader tests, or final selection.
- Follow `references/06-output-template.md` for the response structure.
- Consult `references/07-worked-examples.md` only when an example will resolve ambiguity or improve quality.
- Consult `references/08-sources.md` when provenance or source notes are useful.

## Build the strategic brief first

Extract all available context from the conversation and supplied files before asking questions. Establish:

1. Book type, category, and commercial purpose.
2. Specific ideal reader and their present situation.
3. Result, relief, insight, identity, or experience they want.
4. Emotional stakes and the cost they want to avoid.
5. Distinctive mechanism, framework, thesis, story, or point of view.
6. Evidence that makes the promise believable.
7. Phrases the reader actually uses.
8. Comparable titles, crowded language, and phrases to avoid.
9. Desired voice, status signal, and level of directness.
10. Claim limits, marketplace rules, and other constraints.

If critical information is missing, ask only the questions that would materially change the naming direction. When useful work is still possible, state reasonable assumptions and proceed instead of stalling.

Condense the brief to this internal positioning sentence:

> For [specific reader] who [present situation], this book helps them [wanted result] without [feared cost] through [distinctive mechanism or thesis], supported by [proof].

## Research the landscape when it matters

When web access is available, research current comparable books if the user asks for titles that work in a real market, wants a final recommendation, requests collision checking, or the category is unfamiliar.

- Search using the reader's language, not only the author's terminology.
- Review enough relevant titles to identify category signals, repeated structures, overused words, and open territory.
- Separate useful category recognition from copycat similarity.
- Prefer retailer, library, publisher, author, and official trademark sources.
- Cite current findings.
- Treat an absence of search results as preliminary only, never as legal clearance.

If tools are unavailable, label market and rights checks as pending.

## Generate divergently before judging

Do not score while brainstorming. Create a private rough pool of roughly 40 to 60 title stems across at least eight distinct architectures from `references/02-title-architectures.md`.

Include materially different strategic directions, such as:

- Direct outcome or declaration
- Desired state
- How-to benefit
- Problem escape
- Question already in the reader's mind
- Unique mechanism or named framework
- Contrarian thesis
- Reader identity or tribe
- Metaphor or image
- Practical field guide or information resource
- New category or coined concept

Vary literal versus conceptual, calm versus bold, and category-clear versus curiosity-led approaches. Do not produce a synonym cloud around the first idea.

Use reader language. Prefer concrete verbs and nouns. Consider rhythm, sound, alliteration, and ease of recall, but never sacrifice clarity to wordplay.

## Give the title and subtitle different jobs

The title should earn attention, memory, recognition, or curiosity. The subtitle should clarify the promise, audience, mechanism, scope, or credible distinction.

For each promising title, explore more than one subtitle strategy before selecting the best pair. Reject subtitle pairs that merely restate the title in longer words.

## Prune, score, and challenge

Remove duplicates, generic AI phrasing, confusing metaphors, copycat structures, and candidates that promise something the book does not deliver.

Score the strongest candidates with `references/04-scoring-rubric.md`. Use the score to structure judgment, not to manufacture certainty. When evaluating six or more finalists and code execution is available, the optional `scripts/rank_candidates.py` can calculate totals consistently.

For every finalist, run these adversarial checks:

- What will a cold reader think this book does?
- Who will they think it is for?
- Does it sell a wanted result or merely describe the author's method?
- Is the promise believable and supported by the book?
- Could the title belong to dozens of unrelated books?
- Does it sound machine-generated, inflated, or dated?
- Is it easy to say, hear, spell, remember, and recommend?
- Does the subtitle add useful information?
- Is there a likely title, trademark, or marketplace conflict?
- Will it remain readable on a small cover thumbnail and on a spine?

## Apply quality controls

- Favor clarity over cleverness when forced to choose.
- Favor reader benefit over author-centric features.
- Favor specificity over vague inspiration.
- Favor customer language over insider jargon.
- Keep claims honest. Do not invent proof, statistics, timeframes, or guaranteed outcomes.
- Use numerical promises only when the manuscript and evidence can credibly support them.
- Do not imitate an existing title closely enough to create confusion.
- Treat trademark and rights checks as preliminary unless a qualified professional has cleared them.
- Check current publishing-platform metadata rules before the title is locked.
- Do not let the model's own score choose the final title without human or market validation.

## Deliver the answer

Follow the appropriate structure in `references/06-output-template.md`.

Unless the user requests the entire brainstorm, do not expose the private 40 to 60 candidate pool. Present a useful set of distinct directions, a smaller scored shortlist, a leading recommendation, important risks, and a concrete validation plan.
