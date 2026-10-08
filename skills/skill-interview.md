# The Skill Interview (Chapter 16)

Adapt the summary skill you saved in Chapter 15 to your own preferences.
The assistant interviews you, then updates the same file.

Open a session in your mission control and paste:

```
Read skills/summarize-for-me/SKILL.md. Interview me one question at a time about the job the summary must do, the shape of the result and the details it must preserve.

Ask about choices the existing file leaves open, including what to do when there is no action and how to show uncertain dates. Use my existing profile where relevant instead of asking me to repeat it.

Show a revised version of this same skill. When I confirm it, update skills/summarize-for-me/SKILL.md. Keep one master skill rather than creating a competing summary skill under another name.
```

*[Copy prompt](https://querino.ai/prompts/skill-interview)*

## Before you confirm the revised skill

1. **It is still one skill.** The change goes into
   `skills/summarize-for-me/SKILL.md`, not into a second summary skill
   under another name.
2. **Exact details stay exact.** Prices, dates, names and links are kept
   word for word, never rounded or moved.
3. **It can reach what it names.** Every file or service the skill refers
   to is one the assistant has access to.

## Naming

Use a lowercase name with hyphens and give the folder the same name, as
in `skills/summarize-for-me/SKILL.md`. Prompts meant for separate image
or video tools go in `prompts/library/`, named for the job, such as
`draw-cover-art-my-way.md`.

## Running it

A loose file helps only when you ask the assistant to read it or paste
its contents. A skill at `skills/<name>/SKILL.md` can be selected from
its description during a matching task; compare an ordinary request with
one that names the skill.

## Retest

Open a fresh session, try the same newsletter and read the answer against
your revised rules. If the interview made a second skill under another
name, ask the assistant to compare the files, keep the one you want and
archive the other outside the folders your assistant searches.
