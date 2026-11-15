# The visual recipe, v1

A recipe is one JSON object that describes one picture. It is the only thing Mission Control and Planino
have to agree about, so it is written down here once and mirrored there, and both carry the same
`version` string.

**A recipe says what is in THIS frame. A style profile says what is true of every frame in the
look.** They are merged at render time, the recipe winning key by key, so a single picture can
break a house rule on purpose. Style profiles live in `skills/social-visuals/brand/visual-style/`.

## The fields

| field | who fills it | what it is |
|---|---|---|
| `version` | the renderer | `"v1"`. Bump this only when the shape changes, in both systems at once. |
| `style_profile` | the renderer | Which look this came from, written in so an old recipe still says where it belongs. |
| `task` | style | One phrase naming the kind of picture. |
| `the_one_rule` | style | The relationship between the words and the picture. The single most load-bearing line in the file. |
| `the_second_rule` | style | Why this object and not another one. |
| `the_casing_rule` | style | How the sentence is cased, and why. |
| `subject` | **recipe** | What is actually in frame. Free-form sub-keys: name them after the things, `the_flag`, `the_lettering`, `the_hand`. |
| `composition` | recipe over style | Framing, focal point, depth of field, and the negative space the mark will sit in. |
| `lighting` | style, recipe may override | Light, and the reason for it. |
| `palette` | style, recipe may override | Colours, and what to avoid. |
| `image_quality_simulation` | style | Sharpness, grain, dynamic range, lens flaws. |
| `strict_negatives` | **both, merged** | What must never appear. The two lists are joined, never replaced. |
| `worn_and_real` | style, recipe may override | The instruction that keeps objects from arriving box-fresh. |
| `output` | style, recipe may override | Prose the model reads. `resolution: "ultra_high"` is a word here, not a value. |
| `api_parameters` | style, recipe may override | What the endpoint is actually sent. `aspect_ratio`, `resolution` (`1K`/`2K`/`4K`), `output_format`. |
| `image_input` | recipe, optional | Reference pictures, as URLs or local paths. |

### The two blocks that look alike and are not

`output` and `api_parameters` both carry `aspect_ratio` and `resolution`, and collapsing them is
the mistake this file exists to prevent. `output` is prose: the model reads `"ultra_high"` and
`"professional_dslr"` as description. `api_parameters` is transport: the endpoint accepts `"2K"`
and rejects `"ultra_high"` silently. Send the prose value to the API and the picture comes back at
whatever the default was.

### Why `strict_negatives` merges instead of replacing

Every line in a style profile's negative list is there because a render came back wrong in exactly
that way. If a recipe replaced the list, one picture asking for "no visible horizon" would quietly
drop "no glowing parts, no LED, no blue light", and the picture would come back looking like stock
AI imagery with nobody able to say why.

## The smallest legal recipe

Everything else comes from the style profile.

```json
{
  "subject": {
    "type": "object_macro_with_machine_hand",
    "the_object": "A small white flag of surrender: heavy off-white canvas, hand-tied with twine to a rough weathered stick.",
    "the_lettering": "The words 'You're right to push back on this.' are HAND-STITCHED into the cloth in dark charcoal thread."
  },
  "composition": {
    "framing": "portrait. The hand and stick enter from the lower left, the flag hangs across the upper right two thirds."
  }
}
```

## The worked example

[examples/recipe.json](examples/recipe.json) is a fictional format example, not an observed generated result. Pair it with the selected user’s actual approved style; no personal prompt library is required.

## Mirroring it in Planino

Planino holds the same shape as a Zod schema with the same `RECIPE_VERSION`. When a field is added
here, it is added there in the same week or the two drift. The rule is simple and there is no
machinery enforcing it, so it is written down in both places: **the version string is the contract,
and a shape change without a version change is a bug.**
