# Verify

A page is not done because it was written. It is done when its screenshots
have been looked at, by you and by fresh eyes, and what they showed is fixed.
Two rounds at most: build fully, inspect everything in one batch, fix
everything in one batch, confirm once, stop polishing.

## 1. Serve it and run the check script

```bash
# static folder (output defaults to a lab/check folder beside it)
node <skill>/scripts/check.mjs --serve ./dist
# or a running dev server or a live URL
node <skill>/scripts/check.mjs --url http://localhost:5173 --out lab/check
```

It needs `playwright-core` or `playwright` (found in the current folder, the
served folder, the script's folder or the global npm root; otherwise `npm i
-D playwright-core` once) and an installed Chrome (or `WEBDESIGN_CHROME`).

What it does, per viewport (desktop 1440x900, phone 390x844, small phone
360x640, desktop with reduced motion):

- Hides `navigator.webdriver`, so scripts that skip automated browsers (such
  as Lovable's analytics) behave as they do for a real visitor.
- Scrolls the whole page once so scroll-triggered content appears, waits for
  fonts and settled animations, then takes a full-page screenshot, a
  first-viewport screenshot, and 1:1 slices one screen tall.
- Also reports: text from separate blocks that overlaps or touches, tap
  targets under 44px on phones, no button in the first viewport, a page with
  no images or media at all, typical body text under 16px, a relative
  `og:image`, and a missing description or preview image.
- Reports, as `FAIL` or `WARN` lines and in `report.json`:
  - horizontal overflow (page wider than the viewport, with the widest culprit)
  - console errors and failed requests (4xx, 5xx, network errors)
  - requests to Google Fonts or other font CDNs
  - em dashes, en dashes and banned filler words in visible text
  - `<img>` without `alt`, or without width and height
  - buttons and links with no accessible name; inputs with no label
  - text elements whose contrast against their resolved background is below
    4.5:1 (3:1 for large text). Backgrounds are resolved through ancestors;
    text over images or gradients is marked `UNCHECKED`, not passed.
  - `transition: all` in the stylesheets, and zoom disabled in the viewport
    meta.

A green run proves mechanics. It does not prove the page is good.

## 2. Look at every screenshot

Open each PNG. At full size for the phone shots. Check:

- **The first viewport** at each size: is the brand or person the loudest
  thing? Is the primary action visible? Does the headline wrap badly?
- **Hierarchy:** the squint test. Primary, secondary, groups.
- **Overlap:** does any layer cover readable text, anywhere, at any size?
- **Phone composition:** composed or merely shrunk? Tap targets comfortable?
- **Reduced motion:** is the static page complete, with nothing stuck
  invisible because its entrance animation never ran?
- **The plan:** does it look like `DESIGN.md` said it would? Where it does
  not, the page is wrong, not the plan (or update the plan deliberately).
- **Calibration:** run the category and twin tests from calibration.md on
  what you see, not what you intended.

A screenshot taken while an entrance animation is mid-flight shows missing
elements that are not missing. If something is absent, check timing before
rebuilding.

## 3. Fresh-eyes review

Dispatch one subagent **per page** that has **not** seen your conversation.
Give it only: the check folder (full-page shots, first-viewport shots and 1:1
slices), the path to `DESIGN.md`, `report.json`, the absolute path of this
skill's `references/calibration.md`, and this prompt:

> You are a senior designer reviewing a page you did not make. Look at every
> first-viewport shot and every 1:1 slice; use the full-page shots only for
> overall rhythm, because they are shrunk and mislead about type size. Read
> DESIGN.md to learn what it was meant to be, then read calibration.md at
> <absolute path>.
>
> 1. Specificity verdict: is this page designed for this subject, or could
>    another business in the same category use it unchanged? One paragraph.
> 2. Which calibration defaults does it show? Name each with where it is.
> 3. The five most important problems, most severe first, each with the
>    screenshot and the place on it, and a concrete fix.
> 4. Anything that covers or crowds readable text, any size.
> 4b. The hero: DESIGN.md says Layered, Scroll experience or Flat. Does the
>    screenshot deliver it? A Layered hero shows distinct planes, a real
>    subject and overlap; "a headline beside a picture" is Flat, whatever the
>    plan says.
> 5. Two things that work and must survive the fixes.
>
> Be blunt. Do not praise to soften. Do not suggest adding things unless
> something required is missing; prefer removing.

Run the reviewer in the foreground and wait for it; one review per page is
enough. If no subagent tool exists, or the reviewer fails twice, review it
yourself with the same prompt after a break from the build, and say in the
report that the review was not independent.

Its findings are input, not orders: apply what is right for the brief, and
say which findings you declined and why.

## 4. One design batch, then mechanics until clean

Fix everything from steps 1 to 3 in one design batch. Then re-run the script
and repeat until it reports 0 FAIL, changing only what each FAIL names (a fix
can break something else; that is why this is a loop). No new design ideas
after the batch. Look at the screenshots of whatever changed. Keep the first
report (`--out lab/check-run1`, `lab/check-run2`, ...) and note which run
supersedes it. Never reuse a green result for a changed page.

## 5. What this does not cover

Say so in the report when it applies:

- A real phone: iOS video decoding, Low Power Mode, touch scrolling and
  Safari quirks are not reproduced by headless Chrome.
- Other browsers (Safari, Firefox).
- Motion as a visitor feels it; screenshots are stills.
- The live deployment, if you only checked locally. Check the deployed URL
  too, with the same script, after publishing.

## Report format

Short, grouped, specific:

```
Checked: desktop 1440, phone 390 and 360, reduced motion. Script: 0 FAIL, 2 WARN.
Fixed after review: hero headline wrapped to 4 lines at 360 (stepped size down);
  card grid had an empty cell (reshaped to 2 columns); focus ring invisible on accent button.
Declined: reviewer asked for testimonials; there are none real.
Not verified: real iPhone; Safari; the live URL (not deployed yet).
Shots: lab/check/desktop-full.png, lab/check/phone390-full.png, ...
```
