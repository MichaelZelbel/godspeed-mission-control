---
name: web-design
description: Use when building, redesigning, porting or reviewing any web page, site, landing page, link page, product page, book page, component or web app UI, or when a page "looks like a template", "looks AI-made", "looks flat" or "looks amateurish".
---

# web-design

A page is a set of decisions. Pages that look machine-made are pages where
nobody decided: the axis was left free and the model's default filled it.
This skill makes every free axis a decision, checks the decisions against the
known defaults, builds to a measurable floor, and proves the result with
screenshots before anyone calls it done.

Distilled from eight public skills and from what the owner's own sites taught.
Sources and licences: [CREDITS.md](CREDITS.md).

## Step 0: What kind of job is this?

Answer these before anything else. They decide which steps apply.

1. **Whose site?** If it is one of the owner's sites or carries his name, read
   [references/house.md](references/house.md) now. Its rules outrank every
   taste rule in this skill.
2. **New, change, or port?**
   - *New page or site:* all steps.
   - *Change to a live site:* the site's existing tokens, fonts and
     components are the design system. Extend them; do not re-decide them.
     Steps 1 and 2 shrink to "what does this change need", Step 3 still runs.
   - *Port of an existing design:* fidelity is the brief. Match it line for
     line; a re-interpretation was rejected before. Skip Steps 2 and 3.
3. **Which visitor mode?** Pick from what the visitor came to do, not from
   the product category. A tool's landing page is Persuade; a brand's docs
   are Read.
   - **Persuade:** decide and act (landing, product, book, link page).
   - **Operate:** complete a task (app, dashboard, form, settings).
   - **Read:** understand something (docs, article, legal page).
   - **Experience:** be inside the work (immersive, portfolio, showcase).
4. **How ambitious is the hero?** Decide it here, write it into `DESIGN.md`,
   and never let it default to "a headline beside a picture":
   - **Layered** (the default for every Persuade and Experience page:
     landing, product, book, link page). The first viewport is a physical
     composition: a far plane, a real subject, a near plane, type set between
     them, planes that move at visibly different rates on scroll (and gently
     with the pointer on desktop), overlap that never covers readable text.
     Built by this skill; the recipe is under "The hero" in
     [references/craft-floor.md](references/craft-floor.md).
   - **Scroll experience** (the whole page is a scroll story: scrubbed video,
     pinned scenes, a signature scroll move). Choose it when the brief asks
     to impress, showcase or "wow", when the owner has approved scroll-craft
     for this site before, or when real footage exists. Then **invoke the
     scroll-craft skill** (Skill tool) and let it run the build; keep this
     skill's Steps 0, 3 and 5 around it. scroll-craft's rules win inside its
     engine. If scroll-craft is not installed, build a Layered hero and say so.
   - **Flat** only for Operate and Read pages (apps, docs, legal), or when the
     owner explicitly asks for simple. Say why in `DESIGN.md`.

## Step 1: The design read

Start `DESIGN.md` in the project (or build folder) with one line:

> Reading this as: <page kind> for <audience>, in <mode> mode, seen <where
> and under what light, e.g. "on a phone at night after a Substack link">.
> Vibe: <three to five words>.

Then the brief. Quote what the requester actually said; mark anything you
inferred as `(inferred)`:

- **What must the visitor believe by the end?** One sentence.
- **What do they do next?** One action, one label for it, used everywhere.
- **The one thing they should remember.** Push past "be memorable".
- **What real assets exist?** Logo, photos, copy, brand colours. Real beats
  generated. Existing copy that was written with care moves over verbatim.
- **What facts exist?** List the facts you were given. Everything else on the
  page is either one of these, or clearly an example (see "Thin facts" below).

Ask at most one question, and only when the read genuinely forks (two very
different pages would both fit). Otherwise decide, and say what you decided.
If the owner has delegated ("use your judgment"), decide and record it.

**Thin facts.** Never invent a number, price, customer, testimonial, date or
claim and present it as true. Softer claims count too ("written by one
person", "a quiet evening project"): for a real product, list every such line
you inferred in `DESIGN.md` under `Claims to confirm` and get them confirmed
before the page goes live. When the brief is thin: for a real product, ask
for the missing facts or leave the element out (no price means no price
block; a page can still sell with one true sentence and a button). For a
demo, mock-up or fictional brand, examples are fine at full fidelity, but the
page says so once (a footer line such as "A fictional brand, for
demonstration"), and nothing reads like a real review or statistic.

## Step 2: The first plan

Write your **first-instinct plan** under a `Plan v1` heading in `DESIGN.md`.
Do not open calibration.md until Step 3, and do not censor the plan; Step 3
needs something honest to attack. Keep it short enough to read in one minute:

- **Thesis:** one sentence on mood, material and energy. If it reads like a
  mood board ("modern, clean, bold"), it is not decided yet.
- **Visual material:** what the eye lands on besides type. A photograph,
  illustration, product shot, object, diagram, data, a map, a real artefact of
  the subject's world. Name it and where it comes from. A Persuade or
  Experience page with no visual material needs a written reason; "type only"
  is a choice, not a way to avoid deciding.
- **Colour:** six roles (canvas, surface, ink, ink-soft, accent, accent-ink;
  4 to 6 distinct hex values, since roles may share one) and a strategy:
  *restrained* (neutrals plus one accent), *committed* (one colour carries a
  third of the surface or more), *full* (3 to 4 named hues), or *drenched*
  (the surface is the colour). Light or dark follows the use scene from Step
  1, not the category.
- **Type:** at most two families with their roles, and why these.
- **Sections:** each gets one job, one dominant visual idea and one takeaway,
  in a line of prose plus a rough ASCII wireframe **for desktop and for a
  390px phone**. A section with no job is cut. Heroes set to a full screen
  height need a phone plan too, or they leave a half-empty first screen.
- **Hero planes** (Layered or Scroll experience, from Step 0): name each
  plane (far, subject, near, atmosphere, type), what it is made of, how fast
  it moves relative to the others, what overlaps what, and the phone version.
  "An image next to a headline" is one plane; that is a Flat hero.
- **First viewport:** a poster, not a document. Name the loudest thing. The
  *identity* must be unmistakable (brand, person), but it can be carried by
  the product, the object or the face with the name beside it; a giant
  wordmark alone is the lazy version (calibration.md §8). Never let a
  secondary product lead.
- **The one bold move:** where the boldness is spent. One place. Everything
  else supports it; supporting is not the same as empty.
- **Motion:** one authored moment at most, plus feedback that answers the
  visitor's own actions.

## Step 3: The genericness review

Now attack `Plan v1`. Read [references/calibration.md](references/calibration.md)
and check every line against it.

- Does any choice match one of the default looks, fonts or tells listed
  there? It needs a reason from *this* subject, written down, or it goes.
- **Overcorrection:** did avoiding the defaults leave the page plain? Check
  the anti-default look in calibration.md §8 as hard as the defaults.
- Run the tests in calibration.md §9 (category, twin, removal).
- Write the changes, each with its reason, under `Review`, then the final
  plan under `Plan v2`. Build from v2.

A replacement comes from the subject (its materials, places, rituals, tools,
history), never from a list. The palettes and fonts named in calibration.md
are examples of the kind of move, not a menu.

Brand rules and explicit requests beat this step: if the owner's site family
uses a font the calibration list flags, the family wins.

## Step 4: Build to the floor

Read [references/craft-floor.md](references/craft-floor.md) before writing
markup, and build to it without announcing the checklist. It covers spacing,
type, colour, depth, cards, motion, states, forms, browser surfaces and copy,
each as a check on the rendered result.

Non-negotiables while building:

- Real semantic HTML: real headings, links as `<a>`, buttons as `<button>`,
  labels on inputs, alt text on images.
- Real content. No lorem, no "John Doe", no invented numbers, testimonials,
  prices or customers. No number means no counter.
- No em dash or en dash in anything a visitor reads. No filler verbs.
- Design tokens as CSS custom properties; no stray hex values in components.
  Inline SVG uses `currentColor` or the tokens; an illustration may carry its
  own shading colours if they are derived from the palette.
- Mobile is composed, not shrunk: build the phone layout Plan v2 drew.
- Fonts are self-hosted. With a bundler: `npm i @fontsource-variable/<name>`
  and import it. Without one: copy the `.woff2` files from
  `npm pack @fontsource-variable/<name>` (or the same package on
  cdn.jsdelivr.net) into the page folder and write the `@font-face` rules.
- Link preview: a 1200x630 image at an absolute `https://` address in
  `og:image` (use the production domain even before deploying; check it
  resolves after deploying). Make it from a small HTML page (the page's own type and colour,
  the name and one line) screenshotted at 1200x630, or from the hero art.

## Step 5: Verify: one design round, then mechanics until clean

Full procedure: [references/verify.md](references/verify.md). Short version:

1. Run the check script against the page (a folder or a URL):
   ```bash
   node <skill>/scripts/check.mjs --serve ./site      # or --url http://localhost:5173
   ```
   It shoots desktop 1440, phone 390 and 360, and reduced motion (full page,
   first viewport, and 1:1 slices), and reports overflow, colliding text,
   console errors, failed requests, font CDNs, visible dashes and filler
   words, contrast, missing labels and alt text, small tap targets, no button
   above the fold, pages with no visual material, and link preview problems.
2. **Look at the screenshots yourself.** The script proves mechanics; it
   cannot see a flat hero, a hidden word or a page that means nothing.
   Essential: every `*-first.png`, every `phone390-slice*.png`, the desktop
   slices, and `desktop-reduced-first.png`. Judge type size on slices, never
   on a shrunken full-page image.
3. **Fresh-eyes review**, one reviewer per page, with the prompt in
   verify.md. A reviewer that inherits your context inherits your optimism.
4. Fix everything from 1 to 3 in **one design batch**. Look once at what the
   batch changed and correct only its side effects. Then re-run the script
   until it reports 0 FAIL, changing only what each FAIL names. No new design
   ideas after that: that is how polishing never ends.

## Step 6: Report

Short: the design read, the thesis, what the review changed, what was
verified (with screenshot paths) and what was not (a real phone, real
devices, the live deploy if not deployed). Never claim a check you did not
run. For the owner's sites, publishing is a separate step: see house.md.

## Quick reference

| Situation | Do |
|---|---|
| the owner's site | house.md first; family tokens beat taste rules |
| Live site change | Extend its system; still run Step 3 on new parts |
| Port | Fidelity; no reinterpretation |
| Landing, product, book or link page | Layered hero at minimum |
| Brief says impress, showcase, wow; or owner approved scroll-craft | Invoke scroll-craft for the build, this skill around it |
| Unsure between two very different pages | One question, then decide |
| Plan matches a default look | Reason from the subject, or change it |
| Screenshots "look fine" | Fresh-eyes reviewer before calling it done |

## Common mistakes

- Skipping `DESIGN.md` because "it is a small page". Small pages are where
  defaults win: the one-page link page had the most revisions of any site.
- Fade-up entrances on every section and hover lifts on every card. That is
  the default, not a moment.
- Letting a secondary thing lead: on a person's link page the person leads,
  not the current product.
- Overlap that hides readable text. Depth is welcome; covering words is a
  broken layout to every visitor.
- Trusting a green script run. It cannot see composition. Look.
- Calling a push "published". Pushing, publishing and verifying live are
  three steps.
