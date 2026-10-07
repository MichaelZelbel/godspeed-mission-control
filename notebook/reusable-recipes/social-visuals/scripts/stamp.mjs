// Stamp Michael's mark onto a finished picture, without starting a browser.
//
// WHY THIS EXISTS ALONGSIDE scripts/stamp-image.mjs. That script BUILDS the mark: it lays out the
// face disc and the handle in a real Chrome, because matching the circle to the letters needs a
// text engine that can report where the ink actually is. Building the mark is rare. Stamping it is
// something every generated picture needs, and it must also work inside Planino, where there is no
// browser at all. So the two jobs are split:
//
//     build the mark   scripts/stamp-image.mjs --mark-only   Chrome, run by hand, almost never
//     stamp the mark   this file                             pure pixels, run on every image
//
// The four marks are already built and committed in skills/social-visuals/brand/marks/. This file only scales one of
// them and lays it over a picture, which is arithmetic plus an alpha blend. Planino does the same
// arithmetic with the same library in Deno, so both systems place the mark identically.
//
// Usage: node scripts/social-visuals/stamp.mjs <in> <out> [options]
//        --scale N      mark width as a percent of the picture width, default 5.2
//        --dark         near-black ink, for a very light picture
//        --instagram    the dotted handle, @michael.zelbel, which is Instagram only
//        --mark <path>  use some other mark PNG instead of the four committed ones
//        --bottom N     distance from the bottom as a percent of picture height, default 2.6
//        --quality N    JPEG quality, default 94
//
// GEOMETRY, AND WHY THESE NUMBERS. The committed marks were baked at an em of 240 pixels, where
// "em" is the height of the face disc and the single number the whole lockup is sized from. In
// mark-only mode the builder adds padding of .2em left and right and .16em top and bottom so the
// drop shadow is not clipped, which is why a 240 em mark is 2415 x 317 and not 2319 x 240. The
// padding has to be subtracted back out here, or every stamped mark would sit slightly too high
// and slightly too small compared with what the browser path produces.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import imageScript from "./vendor/imagescript/ImageScript.js";
const { Image } = imageScript;

const GODSPEED = process.env.GODSPEED_WORKSPACE ? resolve(process.env.GODSPEED_WORKSPACE) : null;
if (!GODSPEED) throw Error("Choose this installation with GODSPEED_WORKSPACE; no personal workspace fallback is used");

// The em the committed marks were baked at, and the padding the builder adds in mark-only mode.
// Change these only if brand/marks/ is re-baked at a different size.
export const MARK_EM = 240;
export const MARK_PAD_X = 0.2;  // em
export const MARK_PAD_Y = 0.16; // em

export const DEFAULTS = { scale: 5.2, bottom: 2.6, quality: 94 };

export function markFile({ dark = false, instagram = false } = {}) {
  const ink = dark ? "dark" : "white";
  const who = instagram ? "-instagram" : "";
  // skills/social-visuals/brand/ since 2026-09-22 (reader-layout plan); brand/ at Mission Control top before.
  const now = resolve(GODSPEED, "skills", "social-visuals", "brand", "marks", `mark-${ink}${who}.png`);
  const before = resolve(GODSPEED, "brand", "marks", `mark-${ink}${who}.png`);
  return existsSync(now) || !existsSync(before) ? now : before;
}

// Where the mark PNG goes on a picture of a given size. Pure arithmetic, exported so a test can
// check it without decoding anything, and so Planino can be checked against the same numbers.
export function placeMark({ imageW, imageH, markW, markH, scale = DEFAULTS.scale, bottom = DEFAULTS.bottom }) {
  const em = imageW * (scale / 100);
  const k = em / MARK_EM;                     // how much the baked mark has to shrink or grow
  const w = Math.round(markW * k);
  const h = Math.round(markH * k);
  // The ink sits `bottom` percent of the picture height above the bottom edge. The PNG carries
  // padding below that ink, so the PNG itself hangs that much lower.
  const inkBottom = imageH - imageH * (bottom / 100);
  const pngBottom = inkBottom + MARK_PAD_Y * em;
  return { x: Math.round((imageW - w) / 2), y: Math.round(pngBottom - h), w, h, em };
}

export async function stamp(inputBytes, opts = {}) {
  const { scale = DEFAULTS.scale, bottom = DEFAULTS.bottom, quality = DEFAULTS.quality } = opts;
  const markPath = opts.mark || markFile(opts);
  if (!existsSync(markPath)) throw new Error(`no mark at ${markPath}`);

  const base = await Image.decode(inputBytes);
  const mark = await Image.decode(readFileSync(markPath));
  const at = placeMark({ imageW: base.width, imageH: base.height, markW: mark.width, markH: mark.height, scale, bottom });

  mark.resize(at.w, at.h);
  base.composite(mark, at.x, at.y);
  return { bytes: await base.encodeJPEG(quality), at, base: { w: base.width, h: base.height } };
}

// ---------------------------------------------------------------- command line
const VALUE_FLAGS = ["scale", "bottom", "quality", "mark"];

// Split argv into flags and the two file names, without a dependency. A value flag swallows the
// token after it, so `--scale 6.0 in.jpg out.jpg` does not mistake 6.0 for the input file.
export function parseArgs(argv) {
  const opts = {}; const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (VALUE_FLAGS.includes(name)) { opts[name] = argv[++i]; } else { opts[name] = true; }
    } else files.push(a);
  }
  return { opts, files };
}

if (process.argv[1] && process.argv[1].endsWith("stamp.mjs")) {
  const { opts, files } = parseArgs(process.argv.slice(2));
  const [src, dst] = files;
  if (!src || !dst) {
    console.error("usage: node scripts/social-visuals/stamp.mjs <in> <out> [--scale N] [--dark] [--instagram] [--bottom N] [--mark path]");
    process.exit(1);
  }
  const out = await stamp(readFileSync(resolve(src)), {
    scale: opts.scale ? parseFloat(opts.scale) : DEFAULTS.scale,
    bottom: opts.bottom ? parseFloat(opts.bottom) : DEFAULTS.bottom,
    quality: opts.quality ? parseInt(opts.quality, 10) : DEFAULTS.quality,
    dark: !!opts.dark,
    instagram: !!opts.instagram,
    mark: opts.mark || null,
  });
  writeFileSync(resolve(dst), out.bytes);
  console.log(`stamped -> ${dst}  (${out.base.w}x${out.base.h}, mark ${out.at.w}x${out.at.h} at ${out.at.x},${out.at.y})`);
}
