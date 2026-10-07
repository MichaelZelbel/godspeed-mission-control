---
name: social-visuals
description: Use when the user wants a picture for a social media post, a LinkedIn or X image, a post visual, or says "make an image for this post", "what visual goes with this", "that image but with this change". Four ways in - the default is a scroll-stop round (twenty ideas, 1K sketches judged at feed size, a blind second judge, four finished 2K pictures on one page, no questions along the way); or he describes the picture; or he explicitly asks for ideas to pick from; or he changes a picture that already exists. Renders a photographic metaphor and stamps the selected brand mark on it. Not for diagrams (those go to excalidraw-visuals) and not for video thumbnails (that is Planino's Thumbnail Studio).
---

# A picture for a post

The method in one line: **the sentence is made out of the object that already means the sentence.**
Not text laid over a photograph. The words are stitched, burned or scratched INTO the thing, and
the thing is chosen because it argues the line on its own. Everything else here serves that.

The mark at the bottom is never asked of the image model. It is stamped on afterwards, from a
pre-built PNG, because image models spell handles wrong and draw faces badly. The recipe actively
forbids the model from drawing any text or logo, and reserves the space instead.

## Which of the four ways in

| the user says | do this |
|---|---|
| "make the picture for this post", "what visual goes with this", "come up with ideas for an image post" | **Scroll-stop**, the default: [scroll-stop.md](scroll-stop.md) |
| "a white flag in a robot hand" | **Flow 1**, write the recipe and render |
| "list some ideas first, don't render yet" (he asks for WORDS before pictures, in so many words) | **Flow 2**, propose three to five, let him pick |

**"Ideas" alone is not a request for words.** Only explicit words-first instructions select Flow 2; otherwise use the full scroll-stop method after budget approval.
| "that one, but the flag is torn" | **Flow 3**, change the picture he means |

## Scroll-stop: the default

Follow [scroll-stop.md](scroll-stop.md) end to end, after the exact paid budget is approved, without further preference questions until four
finished pictures are on one page. Twenty ideas in forced slots, six concepts, nine 1K sketches,
a kill pass at 400 px, one blind judge, four 2K finals made from their sketches and stamped. It
requires a current provider quote and an explicitly approved bounded budget before any paid task. The
mechanical steps are `skills/social-visuals/scripts/round.mjs`.

## Flow 1: he describes the picture

1. Read [proposing.md](proposing.md) anyway, at least the test: could the words be deleted in
   Photoshop leaving a clean background? If his idea fails that test, say so in one sentence and
   offer the nearest idea that passes. He decides. Do not silently render a weak idea.
2. Write the recipe against [recipe-v1.md](recipe-v1.md). Only `subject` and `composition` are
   really yours to fill; everything else comes from the style profile.
3. Save it in the project folder, then render:

```bash
node skills/social-visuals/scripts/visual.mjs --recipe <recipe.json> --project <slug> --label <name>
```

## Flow 2: he explicitly wants ideas in words

1. Read [proposing.md](proposing.md) properly. It carries the five places to look for an object,
   which is what stops three to five proposals from being one idea three to five times.
2. Present them numbered: label, one-sentence pitch, risk in brackets. **Stop there.** Do not
   render before he picks. Rendering all five to let him see them spends five times the money to
   answer a question a sentence answers.
3. For each pick, write the recipe and render as in Flow 1.

## Flow 3: he wants a change

Two modes, and picking the right one is the whole skill here.

**`edit` is the default.** The picture itself goes back to the model with the change. Everything
not named stays as it was: the same object, the same wear, the same camera angle, the same wall.
Use it for anything that is a change to the picture in front of him.

```bash
node skills/social-visuals/scripts/visual.mjs --edit <picture.jpg> "<what to change>" --label <name>
```

**`recompose` is a re-roll.** Edit the named fields of the recipe in the sidecar, save it as a new
recipe, and render fresh. Use it when the change is structural (a different object, a different
composition) or when two `edit` attempts have drifted. It costs the same and gives a genuinely
different picture rather than a modified one.

```bash
node skills/social-visuals/scripts/visual.mjs --recipe <edited-recipe.json> --project <same slug> --label <name>
```

Say which mode you used and why, in one line, because the difference is not visible in the result.

## Rules that are not negotiable

- **Never hand a stamped picture back to the model.** It will try to reproduce the mark, and the
  face comes back smeared and the handle misspelled. `--edit` reaches for the `.raw.jpg` on its
  own, so this only bites if you call `render.mjs` directly.
- **Never ask the model for the handle, a logo, a caption bar or any typed text.** The recipe bans
  all of it. The mark is a separate step.
- **Never re-render after a timeout.** A poll limit running out does not stop the job, it stops
  the waiting. The task id is already on disk. `--resume <picture.jpg>` collects it for free;
  starting again pays twice.
- **Case the sentence the way its speaker would type it.** A line quoted from an assistant is
  sentence case with a full stop. Capitals read as shouting and no assistant shouts, so the
  recognition dies. This was caught in the very first working picture and it is easy to lose again.

## What a run leaves behind

    work/visuals/<YYYY-MM-DD>-<slug>/
      01-white-flag.jpg              the picture, stamped, the one to post
      01-white-flag.raw.jpg          unstamped, and the one an edit starts from
      01-white-flag.raw.render.json  the recipe, the task id, the parent, the change asked for
      index.md                       the chain, rebuilt from the sidecars on every run

Retain raw pictures, stamped finals and recipes. Show them through a readable preview in this interface. Publishing a public page or sending a picture remains a separately authorized action.

## Cost, measured and explicitly approved

The default round uses nine 1K sketches and four 2K finals. Read current official pricing for the selected model, verify the intended account, calculate a maximum task and credit budget, and obtain the user's exact approval before any upload or paid creation. Historical prices are not current quotes. Further renders need permission within the remaining approved cap or a new explicit budget. A completed result records each task's own actual charge; a shared balance changing is not proof of this task's cost. Resume an existing task instead of buying a replacement after an interrupted wait.

## File locations

| what | where |
|---|---|
| The one command | `skills/social-visuals/scripts/visual.mjs` |
| Recipe to picture | `skills/social-visuals/scripts/render.mjs` |
| A scroll-stop round's steps | `skills/social-visuals/scripts/round.mjs` |
| The scroll-stop method | [scroll-stop.md](scroll-stop.md) |
| The mark, laid on | `skills/social-visuals/scripts/stamp.mjs` |
| Providers | `skills/social-visuals/scripts/providers/` (kie.ai, Nano Banana 2) |
| The recipe contract | [recipe-v1.md](recipe-v1.md) |
| How to find ideas | [proposing.md](proposing.md) |
| The look, swappable | `skills/social-visuals/brand/visual-style/selected.json` |
| The mark PNGs | `skills/social-visuals/brand/marks/` |
| Selected mark | The user-supplied PNG; do not borrow another person’s mark or ask the image model to draw it |
| Why the look works | The complete local proposing and recipe method documents |
| Recipe input | The actual user-approved project recipe, preserved beside its result |
| Output | `work/visuals/<date>-<slug>/` |
| API key | Selected environment key or device-private provider.json; never a personal-root fallback |

## Provider setup

Read the selected installation's configured device-private provider before calling a key missing. No personal secrets loader, private example or old account is used. Missing chosen style, mark, provider or actual spend permission is an explicit configuration need. Scripts and offline pixel dependencies are included.

## Portable installation and paid-action boundary

The complete four entry flows, visual metaphor method, twenty ideas in eight slots, six concepts, nine sketches, 400-pixel rejection pass, blind judge and four approved finals remain the workflow. Account and personal incident details are excluded. The helper scripts are licensed under the retained MIT license; ImageScript 1.3.1 and its codec files are bundled under its MIT option so a package install is unnecessary.

Set GODSPEED_WORKSPACE to this selected installation. Supply the user's own style as skills/social-visuals/brand/visual-style/selected.json and selected marks in its brand/marks/ folder. No personal style, mark or account is bundled. Read the supplied source asset and choose only permitted assets; reject unavailable branding rather than rendering another person's mark. Keep provider.json in the device-private .godspeed/connectors/social-visuals/ folder, or load the selected provider key in the environment. Keys never enter sync or output sidecars.

Before uploading local references or creating any paid task, obtain the user's explicit approval of the actual provider/model, reference files, project folder, maximum task count and maximum credits using a current cited price. Save that exact permission device privately and set GODSPEED_SOCIAL_VISUALS_APPROVAL to it. A request to finish or test this software grants no paid image budget. Unverified historical prices do not authorize spending. The adapter reserves each task before sending it and retains uncertain reservations; never replay a possible paid creation. Resume existing task IDs without another purchase. A task with no returned ID requires review, not a fresh automatic create.

The provider request envelope was checked against [Kie's Nano Banana 2 documentation](https://docs.kie.ai/market/google/nanobanana2) on 4 October 2026. Actual paid generation, current account prices, reference upload and provider output quality remain unverified until explicitly approved and exercised. A synthetic helper test or this full method is not proof of a completed image workflow. Keep raw provider images separate from stamped finals, retain originals and resume records, and judge the actual pixels before choosing a result.


## Installed personal workspace

Use the current user workspace and its configured providers. Keep original workflow, command contracts, scripts and verification criteria. Read the workspace authorization rules before sends, sign-ins, payments or publishing. Search existing device-private credentials before asking for configuration. Saved output and a passing screen are not evidence that the full requested result happened.
