# Calibration: the defaults to recognise

Read this in Step 3, with `DESIGN.md` open. Everything here is a *default*,
not a crime: the brief's own words, a brand rule, or a reason written down
from this subject can earn any of it. What cannot earn it is "it looks
premium" or "it is what I would normally do". An axis left free and filled
with one of these is an axis nobody decided.

## 1. The five looks AI design lands on

From Anthropic's frontend-design skill (Apache-2.0, lightly edited):

1. **Cream and clay.** Warm cream background (near `#F4F1EA`), high-contrast
   serif display, terracotta or warm-clay accent (near `#D97757`, which is
   Claude's own interface accent and so reads as a tell).
2. **Dark and acid.** Near-black background with one bright acid-green or
   vermilion accent.
3. **Broadsheet.** Hairline rules, zero border radius, dense newspaper
   columns.
4. **The SaaS-card kit.** Content chopped into identical rounded cards, one
   radius on everything regardless of hierarchy, the same soft grey shadow
   (`rgba(0,0,0,.1)`) under each, gradient washes as decoration.
5. **Template chrome.** A tracked-out ALL-CAPS label above every heading;
   meta strings joined with middle dots (`A · B · C`); labels built as a
   word, a spaced dash and a fragment; tinted near-black (`#0B0B0B`, `#111`)
   standing in for black; monospace for small data labels; an arrow glyph
   appended to link and button text.

Two more that other skills measured independently:

6. **The premium-consumer palette.** Cream, brass and espresso for every
   food, craft, wellness or artisan brief. Backgrounds near `#f5f1ea
   #f7f5f1 #fbf8f1 #efeae0 #ece6db #faf7f1 #e8dfcb`, accents near `#b08947
   #b6553a #9a2436 #9c6e2a #bc7c3a #7d5621` (taste-skill, MIT). The way
   out is the subject's own materials, not another stock palette: the
   colour of this roaster's sacks, this town's stone, this tool's actual
   interface. (Lists of "alternative palettes" become the next default the
   moment everyone uses them; testing showed exactly that.)
7. **AI purple.** Violet-to-blue gradients, neon glow, glowing buttons, purple
   gradient on white.

## 2. Fonts that are defaults

These are the faces models reach for when nobody decided. Each needs a reason
from the subject (Impeccable, Anthropic, taste-skill; merged):

- Inter, Roboto, Arial, system UI as a *display* voice
- Space Grotesk, Space Mono, DM Sans, DM Serif, Plus Jakarta Sans, Outfit,
  Instrument Sans, Syne
- Fraunces, Playfair Display, Cormorant, Lora, Crimson, Newsreader, IBM Plex

A serif is not a synonym for premium. Use one when the brand names it or when
the work is genuinely editorial, literary or heritage, and say why this serif.

**Exception that always wins:** an existing brand or site family.
An existing site family may share Archivo, Newsreader and
IBM Plex Mono on purpose; a new page in that family uses them. Consistency
across a family is a decision, not a default.

## 3. Structure defaults

- Identical icon + heading + text cards as the page structure. Nested cards.
  Three equal feature columns.
- The hero-metric template: big number, small label, supporting stats,
  gradient accent.
- A split header: a section heading in the left column with its content in
  the right column. Fine once; the same split on more than two sections is a
  template, not a layout.
- More than two image-left / text-right zigzag sections in a row.
- The same layout family twice on one page.
- A bento grid with more cells than content, or an empty trailing cell.
- A logo wall, pricing teaser or trust strip inside the hero.
- A modal for a task that needs neither interruption nor protected focus.

## 4. Label and chrome defaults

- An eyebrow label: a short line of small text (usually uppercase, tracked,
  or in the accent colour) sitting directly above a heading and restating or
  decorating it ("HOW IT WORKS" above "How it works"). A byline, a date or a
  real category is not an eyebrow. Default: none. Allowed only when the label
  is information the reader needs, and never on more than one section in
  three.
- Section numbers (`01 / 06`, `001 · Capabilities`) unless the content is
  a real sequence (steps, a timeline).
- Scroll cues: "scroll", arrows, animated mouse icons. They are looking at
  the hero; they know.
- Accenting one word of a headline in a different colour, italic or font.
- Version stamps (`V0.6`, `BETA`) on a marketing page, locale/time/weather
  strips, decorative status dots, hero-bottom text strips (`BRAND. MOTION.
  SPATIAL.`), pills overlaid on photos, fake photo credits, "Quietly trusted
  by", poetic section labels ("Field notes", "On our desks").

## 5. Surface defaults

- Gradient text. Emphasis comes from weight or size.
- Neon or outer glow; zero-offset coloured halo shadows.
- Glass and backdrop blur as decoration rather than as a specific effect.
- A coloured `border-left` above 1px on cards, callouts or list items.
- Hard zero-blur offset shadows outside a world that is truly neobrutalist.
- Monospace as a costume for "technical" rather than for code or data.
- Emoji or Unicode glyphs standing in for an icon system.
- A circle or polygon mask standing in for a photo subject's real outline.
- Custom cursors, unless the cursor *is* the interaction.
- Div-built fake screenshots, fake dashboards, fake terminals in the hero.
- Light or dark picked by category ("tech is dark"). Pick from the use scene.

## 6. Motion defaults

- Fade-and-slide-up on every section. Hover lift on every card.
- Count-up stats (and never on an invented number).
- Parallax on everything, or parallax that only slides flat layers.
- More than one "wow" moment competing for attention.

## 7. Copy defaults

- Filler verbs and adjectives: elevate, seamless, unleash, unlock, next-gen,
  revolutionize, supercharge, robust, cutting-edge, transformative,
  comprehensive, empower, effortless, game-changer. Read the current owner's
  writing and brand requirements for any additional restrictions.
- "It's not just X, it's Y." Rhetorical question openers. Triplets of
  adjectives.
- Placeholder people and brands: John Doe, Jane Smith, Acme, Nexus.
- Invented precision: `4.1x`, `92%`, `48k users`, `99.99%`.
- Two labels for one intent: "Get in touch" in the nav and "Let's talk" at
  the end. Pick one, use it everywhere.
- Headlines that refer to something the page has not introduced yet.
- Prompt language or design commentary leaking into the page ("a bold hero
  that...").

## 8. The anti-default look (overcorrection)

What comes out when the defaults above are avoided and nothing is put in
their place. Testing this skill produced it twice in a row, so check for it
as hard as for the others:

- A giant all-caps grotesque wordmark as the whole hero.
- No image, illustration, object or data anywhere: only type, rules and
  flat fields of grey.
- Every section a heading plus a hairline list.
- A near-white or grey ground with one saturated accent, chosen because it is
  "not cream" rather than because of the subject.
- Pages that are correct and forgettable: nothing a visitor would describe to
  a friend.
- A flat hero: a headline on one side, one picture on the other, nothing
  crossing anything, nothing moving at a different rate. It is the most common
  hero on the web and reads as a template even when the picture is good.

Restraint means few things, each one rich. It does not mean nothing. The
test: name the one thing on the page a visitor would remember an hour later.
If the answer is "the big name", the page has not found its idea yet.

## 9. The tests

Run all three against the plan, then again against the screenshots:

- **Category test:** could someone guess this design from the category alone,
  or from "the category, avoiding the obvious"? Rework.
- **Twin test:** write down, in one line, the plan you would make for a
  *different* business in the same category (another roaster, another dev
  kit). Compare it with this plan. Every part that matches is generic. (This
  is about what *you* would produce, not whether a competitor could reuse
  the page.)
- **Removal tests** (OpenAI frontend-skill): hide the hero image; if the
  first viewport still works, the image was too weak. Hide the nav; if the
  brand disappears, the hierarchy is too weak. Delete 30 percent of the copy;
  if the page improves, keep deleting.
