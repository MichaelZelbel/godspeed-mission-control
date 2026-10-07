# Where this came from, and where things actually go

This skill arrived from a Gemini and Antigravity project, and this file used to be that project's
organiser. It mandated a folder structure Mission Control has never had: a top-level `/images/` that does
not exist, a `/scripts/` layout that is not this one, and worst of all a `/prompts/` folder for
image prompts. In Mission Control, `prompts/` is Michael's prompt drawer, a memory folder with its own
rules and its own CLI. An agent following the old instructions would have filed generated image
JSONs into his memory. That was never noticed because nothing ever followed them.

Replaced 2026-08-30. What is true instead:

| the old file said | Mission Control actually does |
|---|---|
| save images to `/images/<category>/` | `work/visuals/<date>-<slug>/`, and the JPEGs are git-ignored |
| save prompts to `/prompts/<category>/` | the recipe is a `.render.json` sidecar beside its picture |
| use "the Nano Banana image generation skill" for any image | pick the right door: see below |

## The three doors, and this file is none of them

- **A picture for a social post** goes through `.claude/skills/social-visuals/`. One command
  renders it and stamps Michael's mark on it.
- **A diagram** goes through `.claude/skills/excalidraw-visuals/`. Different model, different
  style reference, hand-drawn look.
- **The prompt format itself**, when you are writing or debugging one by hand, is what the rest of
  this skill documents. Read `SKILL.md` and `master_prompt_reference.md` beside this file.

## The one thing worth keeping from the old file

**Run multiple generations in parallel.** Each picture takes twenty seconds to four minutes, almost
all of it waiting, so four sequential renders is four times the wall clock for no reason. This is
still good advice and the only line of the original worth carrying forward.
