# Scoring Rubric

Use this rubric to compare serious candidates after divergent generation. Score the title and subtitle as a pair.

## Weighted score: 100 points

### 1. Reader desire and self-interest - 20 points

- **18-20:** Immediately expresses a result, relief, insight, identity, or experience the target reader strongly wants.
- **14-17:** Clear and relevant benefit, but not maximally compelling.
- **8-13:** Relevant topic with a weak or abstract payoff.
- **0-7:** Mostly describes the author's subject, method, or enthusiasm.

### 2. Instant clarity - 15 points

- **13-15:** A cold reader can explain the book correctly after one glance.
- **10-12:** Mostly clear, with one minor ambiguity.
- **6-9:** Requires explanation or depends heavily on the subtitle.
- **0-5:** Misleading, opaque, or hard to parse.

### 3. Differentiation - 15 points

- **13-15:** Owns a distinctive idea, phrase, mechanism, or angle without copying the market.
- **10-12:** Recognizable but sufficiently fresh.
- **6-9:** Competent yet interchangeable with many category titles.
- **0-5:** Generic, derivative, or easily confused with an existing title.

### 4. Specificity - 10 points

- **9-10:** Uses concrete language and useful detail without clutter.
- **7-8:** Specific enough to be credible and relevant.
- **4-6:** Some concrete meaning, but important parts remain vague.
- **0-3:** Empty abstraction or broad inspiration.

### 5. Memorability and sound - 10 points

- **9-10:** Easy to say, hear, spell, recall, and recommend; strong rhythm or image.
- **7-8:** Clean and memorable.
- **4-6:** Serviceable but forgettable or slightly awkward.
- **0-3:** Clumsy, confusing, hard to pronounce, or hard to spell.

### 6. Credibility - 10 points

- **9-10:** Bold enough to matter and fully believable given the book and proof.
- **7-8:** Credible with minor claim-calibration concerns.
- **4-6:** Feels inflated, undersupported, or too absolute.
- **0-3:** Misleading or impossible to defend.

### 7. Audience and category fit - 10 points

- **9-10:** Signals the right reader, category, sophistication, and tone.
- **7-8:** Good fit with minor audience ambiguity.
- **4-6:** Could attract the wrong reader or signal the wrong level.
- **0-3:** Fundamentally mispositioned.

### 8. Title-subtitle complementarity - 5 points

- **5:** Each part performs a different useful job and the pair reads naturally.
- **3-4:** Mostly complementary, with small redundancy or imbalance.
- **1-2:** Noticeable repetition or mismatch.
- **0:** The subtitle merely restates or contradicts the title.

### 9. Marketplace readiness - 5 points

- **5:** Readable at thumbnail size, reasonable length, natural metadata, and no obvious collision or rights concern.
- **3-4:** Usable with a minor length, search, or collision check pending.
- **1-2:** Significant marketplace friction.
- **0:** Clear metadata, rights, or confusion problem.

## Penalties

Apply penalties after the 100-point base score. Explain each penalty.

- **Up to -15:** Exact or dangerously close market collision, unauthorized trademark, or strong likelihood of confusion
- **Up to -10:** Unsupported numerical, time-bound, guaranteed, or absolute claim
- **Up to -8:** Generic AI cliche or keyword-stuffed construction
- **Up to -5:** Title and subtitle repeat the same promise
- **Up to -5:** Jargon, pronunciation, spelling, or accidental-meaning problem
- **Up to -5:** Misleading scope or mismatch with the manuscript
- **Up to -3:** Avoidable length or weak thumbnail readability

Do not use penalties to double-count a weakness already fully reflected in the base score. Use them for material red flags.

## Hard gates

A high score cannot rescue a candidate that fails any of these:

1. The promise is truthful and deliverable.
2. The cold-reader interpretation substantially matches the book.
3. The intended reader can recognize the relevance.
4. No obvious legal, trademark, or marketplace conflict is being ignored.

Mark failed candidates as **Do not use until resolved**, regardless of score.

## Score bands

- **85-100:** Strong finalist, pending external validation
- **75-84:** Promising, but improve or test against stronger alternatives
- **65-74:** Salvageable direction, not yet a finalist
- **Below 65:** Discard or substantially rethink

## Scoring table

Use this table for finalists:

| Candidate | Desire /20 | Clarity /15 | Difference /15 | Specificity /10 | Memory /10 | Credibility /10 | Fit /10 | Pair /5 | Market /5 | Penalty | Final /100 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## Optional script input

The bundled script accepts either a JSON list or an object containing a `candidates` list.

```json
{
  "candidates": [
    {
      "title": "Example Title",
      "subtitle": "Example subtitle",
      "scores": {
        "desire": 18,
        "clarity": 13,
        "differentiation": 12,
        "specificity": 8,
        "memorability": 9,
        "credibility": 9,
        "audience_fit": 9,
        "complementarity": 5,
        "marketplace": 4
      },
      "penalties": [
        {"reason": "Minor collision risk", "points": -3}
      ]
    }
  ]
}
```
