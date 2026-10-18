# The craft floor

Read before writing markup; build to it without announcing it. Every line is a
check on the **rendered result**, not an intention. "I used a spacing scale"
is not evidence; a computed value in a screenshot is.

The floor holds the mechanics. It never picks the direction: that was Step 2.

## Spacing

- Rhythm comes from contrast between tight and generous. One value repeated
  everywhere makes every gap weigh the same and the page reads as a list.
- Use a 4px-based scale as tokens (`--space-1` ... `--space-10`).
- **More space above a heading than below it.** The gap belongs to the
  boundary between sections, not to the heading and its paragraph. The most
  common spacing error.
- Group by proximity before reaching for a border or a box. If you added a
  border to show two things belong together, the spacing was wrong first.
- Section padding is fluid (`clamp()`); a phone must not inherit 8rem of
  desktop air.
- Gutters scale with the viewport. Full-bleed media may touch the edges;
  text never does. Minimum side gutter on a phone: 16px.
- Optical, not mathematical: correct uneven visual weight against the render.

## Typography

- Two families maximum. One is often enough.
- Body text at least 16px; body measure 45 to 75 characters (`max-width:
  65ch` is a good default).
- Line height inverse to measure: display 0.95 to 1.1, body 1.5 to 1.7. Serif
  body gets a touch more.
- Tracking tightens as size grows (display around -0.02em to -0.04em, never
  tighter than -0.04em); small caps and labels get positive tracking.
- Light text on dark needs a little more line height, a touch more tracking
  and one step more weight than the same text on light.
- `text-wrap: balance` on headings, `text-wrap: pretty` on body.
- Display max around 6rem outside one genuine hero moment. Hero headline max
  two lines at desktop; step the hero size down one rung below ~700px wide so
  it does not wrap to six lines on a phone.
- Emphasis inside a headline uses weight or italic of the same family, not a
  different font or colour.
- Sentence case for headings, buttons and labels.
- Details: real curly quotes and apostrophes, `…` not `...`, non-breaking
  space between a number and its unit (`10&nbsp;MB`), `font-variant-numeric:
  tabular-nums` wherever numbers line up.
- Load only the weights you use, self-hosted (`@fontsource`), with
  `font-display: swap` and a metric-close fallback.

## Colour

- Six roles, one accent: canvas, surface, ink, ink-soft, accent, accent-ink.
  The accent owns a role or a region; scattered small accents are confetti.
- Lock the accent for the whole page. A page that hard-cuts between light and
  dark grounds may carry one hue at two lightnesses, one per ground.
- Secondary text is tinted from the ink or surface hue, never flat grey. `#888`
  on a warm or blue ground looks dirty.
- No pure `#000` canvas; no pure `#fff` on a dark canvas for long text.
- Contrast measured on the render: body at least 4.5:1, large text (24px, or
  19px bold) at least 3:1, controls and focus rings at least 3:1.
- **Redefining a colour token on a subtree does not re-ink text that already
  inherited `color`.** Wherever a section redefines `--ink`, also set
  `color: var(--ink)` on it, or the text keeps the old colour and silently
  fails contrast.
- Dark themes: `color-scheme: dark` on `<html>`, and `<meta name="theme-color">`
  matching the canvas.

## Custom properties and layout traps

- A custom property holding a **percentage** resolves against whatever uses
  it: `--w: 30%` means width in `width` and height in `height`. Composition
  tokens are lengths.
- `width` and `height` attributes on `<img>` reserve space (keep them), but
  overriding only one in CSS leaves the other at its raw pixel value.
  Override both (`width: 100%; height: auto`) or neither.
- `filter` on an ancestor of a `preserve-3d` subtree flattens it; put shadows
  on their own layer.
- A fixed or sticky header counts against the first viewport: size the hero
  with `calc(100svh - var(--header-h))`, and use `svh`/`dvh`, not `vh`, on
  phones.
- Watch selector specificity: `.section` and `.cta` padding rules cancelling
  each other is a common silent layout bug.
- Before any global search-and-replace in CSS, check every match; an anchor
  that appears twice changes two things.

## Depth

- Shadows have an offset and a blur and are tinted toward the canvas hue.
  Three elevation steps at most; if everything is raised, nothing is.
- A 1px top highlight sells a raised surface better than more blur.
- Overlap (one element crossing another's edge) is the cheapest real depth.
  **Overlap never hides readable text.** A layer may cross a box only where
  that box has no words.
- Things further away are smaller, softer and lower in contrast. Parallax
  without that reads as sliding, not depth.
- A flat dark ground bands on real screens; 3 to 5 percent grain fixes it.

## Cards and containers

- Before using a card, ask what it does that space, a hairline or proximity
  could not. Cards are for things that are units of interaction.
- Never nest cards. One radius scale for the whole page.
- Grids have exactly as many cells as content.
- A vertical list is honest for a link page. A sideways rail in a mostly
  vertical page breaks the reading direction unless the content calls for it.

## Motion

- Animate `transform` and `opacity` (and `clip-path` for wipes). Never
  `transition: all`; never animate width, height, top, left, margin, padding.
- **Should it animate at all?** (Emil Kowalski): seen 100+ times a day, no;
  tens of times, barely; occasionally (modals, drawers, toasts), yes; rare or
  first-time, may delight. Never animate keyboard-initiated actions.
- Easing: entering and exiting use ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`);
  moving on screen uses ease-in-out (`cubic-bezier(0.77, 0, 0.175, 1)`);
  never `ease-in` on UI.
- Durations: press 100 to 160ms, hover 120 to 180ms, tooltip 125 to 200ms,
  dropdown 150 to 250ms, modal or drawer 200 to 500ms. UI stays under 300ms.
  Exits are faster than entrances.
- Never enter from `scale(0)`; start from `scale(0.95)` with `opacity: 0`.
  Popovers grow from their trigger; modals stay centred.
- Press feedback on anything pressable: `scale(0.97)` or `translateY(1px)`.
- Stagger groups 30 to 80ms, and never block interaction while it plays.
- Hover effects only under `@media (hover: hover) and (pointer: fine)`.
- **Reduced motion means fewer and gentler, not zero.** Keep opacity and
  colour changes that carry meaning; remove position and scale movement. The
  static composition must still be complete.

## States and interaction

- Every interactive element: hover, focus-visible, active, disabled; plus
  loading, error and empty where they can occur.
- Focus-visible is visible: themed to the accent, 2px, with offset. Never
  `outline: none` without a replacement.
- Touch targets at least 44 by 44px with 8px between them.
- Links are `<a href>`; actions are `<button>`. No click handlers on `div`.
- Icon-only buttons get `aria-label`. Decorative images get `alt=""`.
- Never disable zoom (`user-scalable=no`, `maximum-scale=1`).
- Forms: every input has a label; correct `type`, `inputmode`,
  `autocomplete`; never block paste; errors inline next to the field; the
  submit button stays enabled until the request starts. A scripted form must
  not fall back to a GET that puts personal data in the URL.
- Destructive actions need confirmation or undo.

## Buttons and calls to action

- The label says literally what happens: "Download from Leanpub", "Save
  changes", never "Submit" or "Learn more" when something better is true.
- One to three words on a primary button, one line at desktop.
- One label per intent, everywhere on the page and the flow ("Publish" makes
  a toast that says "Published").
- Check button text contrast, and ghost buttons over photos.
- A buy or download button links straight to the destination; no pass-through
  pages.

## The hero

A Layered hero (SKILL.md Step 0) is a physical composition, not a picture with
text beside it. Adapted from scroll-craft's hero-depth rules (Nate Herk, MIT).

- **Plan the planes first:** far (sky, room, landscape, a colour field with
  texture), subject (the product, the object, the person, cut out with real
  alpha or drawn as SVG), near (a framing element, a detail, a foreground
  shape), optional atmosphere (light, mist, grain), and type. Several
  elements that move together are one plane.
- **Different rates, visibly.** On scroll the far plane moves least, the near
  plane most (for example far 0.15, subject 0.35, near 0.6 of the scroll
  distance, as `transform: translate3d`), driven by one shared progress value
  in `requestAnimationFrame`. On fine pointers, a small pointer offset per
  plane (a few pixels far, more near) adds depth; never lock the cursor.
- **Occlusion is the depth cue.** The subject may cross the headline, the near
  plane may cross the subject. It may never cover a word someone needs to
  read: let the subject pass behind or in front only where the type has room.
- **Shared contact points stay anchored.** A product stays on its surface, a
  person on the ground, while their planes move.
- **Real assets, not decoration.** A generic gradient blob is not a plane. Use
  the owner's photos, product shots or face; drawn SVG of the real object; or
  generated imagery if the project has an image service. Cut subjects with
  real transparency and check the edges.
- **Scroll payoff.** Within the first screen or two of scrolling something
  changes: the headline recedes behind the subject, a second line appears,
  the scene resolves into the next section. Use native `position: sticky`
  with transformed planes before reaching for WebGL or video.
- **Phone:** recompose, do not shrink. Type may sit above the subject on a
  phone even when it passes behind it on desktop. Less travel, same depth.
- **Reduced motion:** planes stay where they rest; the static composition is
  complete and still shows depth through overlap and scale.
- **Check it:** screenshots at the opening, one intermediate scroll position
  and the resolved exit, desktop and phone. Distinct planes must visibly move
  at different rates; nothing readable may be covered at any position.

## The first viewport

- The brand or person is unmistakable, and the loudest thing.
- Headline at most two lines, supporting line at most about 20 words, the
  primary action visible without scrolling, at most four text elements.
- No layout shift as fonts and images arrive (reserve space).

## Browser surfaces

The parts you did not draw still carry the design, and models skip them most
reliably (Impeccable). Theme from the palette: `::selection`, `caret-color`,
focus ring, scrollbar (`scrollbar-color`), link underline offset and
thickness, native `<select>` colours in dark mode, favicon, and the link
preview image (1200 by 630).

## Copy

- Plain words from the visitor's side: people manage notifications, not
  webhook config.
- Errors name the problem and the fix, and do not apologise. Empty states
  invite the next action.
- No em dash or en dash in visible text. Period, comma, colon, parentheses.
- Every number true. Every name real or clearly fictional.

## Performance

- Images sized for their rendered size (about 2 to 3x the CSS pixels),
  modern formats, `loading="lazy"` below the fold, explicit dimensions.
- Text-bearing JPEGs (book covers, logos) with chroma subsampling off, or the
  lettering smears.
- Compressed video over animated GIFs. No autoplaying audio.

## The squint test

Blur the page until detail disappears. You should still be able to name the
primary element, the secondary element and the main groups, in that order. If
everything melts into one even field, the problem is hierarchy, and no shadow,
gradient or motion will fix it.
