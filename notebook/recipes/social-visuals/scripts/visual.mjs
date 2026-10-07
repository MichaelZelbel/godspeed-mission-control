// One command for a social post picture: render it, stamp it, file it.
//
// render.mjs makes the picture and stamp.mjs puts the mark on. Neither knows about the other, and
// running them by hand is two commands and a chance to forget the second one. This is the door
// most work should come through.
//
// THE RAW PICTURE IS KEPT, ALWAYS, and it is the one an iteration starts from. Handing a STAMPED
// picture back to the model for an edit asks it to reproduce a photograph of a logo, and it will
// try: the face comes back smeared and the handle comes back misspelled. So every render writes
// two files, and `--edit` silently reaches for the raw one.
//
//   node scripts/social-visuals/visual.mjs --recipe <recipe.json> --project <slug> [--label name]
//   node scripts/social-visuals/visual.mjs --edit <picture.jpg> "<what to change>" [--label name]
//   node scripts/social-visuals/visual.mjs --resume <picture.jpg>
//
//   --no-stamp        leave the mark off (book covers, blog headers, anything not a social post)
//   --scale N         mark size as a percent of picture width, default from the style profile
//   --dark            dark ink, for a very light picture
//   --instagram       the dotted handle, which is Instagram only
//   --style NAME      style profile, default selected
//   --aspect A        override the recipe's aspect ratio

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderRecipe, editImage, resume, loadStyle, readSidecar } from "./render.mjs";
import { stamp, DEFAULTS as STAMP_DEFAULTS } from "./stamp.mjs";
import {unstampedSource} from './source-image.mjs';

const GODSPEED = process.env.GODSPEED_WORKSPACE ? resolve(process.env.GODSPEED_WORKSPACE) : null;
if (!GODSPEED) throw Error("Choose this installation with GODSPEED_WORKSPACE; no personal workspace fallback is used");
// work/visuals since 2026-09-22 (reader-layout plan): generated pictures are work output, not a
// top-level folder. projects/visuals before.
export const VISUALS_ROOT = resolve(GODSPEED, "work", "visuals");

// The LOCAL date, not the UTC one. toISOString() puts a folder made at half past midnight into
// yesterday, and then the folder disagrees with the clock Michael is looking at.
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "visual";

export function projectDir(slug) {
  const dir = join(VISUALS_ROOT, `${today()}-${slugify(slug)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Pictures are numbered in the order they were made, so the folder reads as a history rather than
// as a pile. The number is taken from what is already there, so a resumed session carries on.
export function nextNumber(dir) {
  if (!existsSync(dir)) return 1;
  const used = readdirSync(dir)
    .map((f) => /^(\d{2})-/.exec(f))
    .filter(Boolean)
    .map((m) => parseInt(m[1], 10));
  return used.length ? Math.max(...used) + 1 : 1;
}

const rawPath = (stampedPath) => stampedPath.replace(/\.jpg$/i, ".raw.jpg");

// Given any picture in a visuals folder, find the unstamped original to edit from.
export function sourceForEdit(picturePath) {
  return unstampedSource(picturePath);
}

async function stampInto(rawFile, outFile, opts) {
  const style = loadStyle(opts.style ?? "selected");
  const mark = style.mark ?? {};
  const out = await stamp(readFileSync(rawFile), {
    scale: opts.scale ?? mark.scale ?? STAMP_DEFAULTS.scale,
    bottom: opts.bottom ?? mark.bottom ?? STAMP_DEFAULTS.bottom,
    dark: opts.dark ?? mark.ink === "dark",
    instagram: !!opts.instagram,
  });
  writeFileSync(outFile, out.bytes);
  return out;
}

// A one page index of the folder, rebuilt from the sidecars every time, so it can never drift from
// what is actually on disk.
export function writeIndex(dir) {
  const records = readdirSync(dir)
    .filter((f) => f.endsWith(".render.json"))
    .sort()
    .map((f) => ({ file: f, rec: JSON.parse(readFileSync(join(dir, f), "utf8")) }));
  const lines = [
    `# ${basename(dir)}`,
    "",
    "Rebuilt by `visual.mjs` from the sidecars. Do not edit by hand, the next render overwrites it.",
    "",
    "| picture | mode | from | change asked for | state |",
    "|---|---|---|---|---|",
  ];
  for (const { file, rec } of records) {
    // The sidecar sits beside the RAW picture, so its name carries `.raw`. The row should name the
    // stamped picture, which is the one anybody actually posts.
    const stem = file.replace(/(\.raw)?\.render\.json$/, "");
    const stamped = `${stem}.jpg`;
    const pic = existsSync(join(dir, stamped)) ? stamped : `${stem}.raw.jpg`;
    const from = rec.parent ? basename(rec.parent).replace(/\.raw\.jpg$/, ".jpg") : "";
    // A change note can be a paragraph. The table wants a glance; the whole note is in the sidecar.
    const note = (rec.change_note ?? "").replace(/\s+/g, " ").trim();
    const short = note.length > 90 ? `${note.slice(0, 87)}...` : note;
    lines.push(`| ${pic} | ${rec.mode} | ${from} | ${short} | ${rec.state} |`);
  }
  lines.push("", `Recipes live in the \`.render.json\` beside each picture. The \`.raw.jpg\` is the unstamped original, and it is what an edit starts from.`, "");
  writeFileSync(join(dir, "index.md"), lines.join("\n"));
}

// ---------------------------------------------------------------- command line
const VALUE_FLAGS = ["recipe", "project", "label", "scale", "bottom", "style", "aspect", "resolution", "provider", "model", "out", "max-polls"];

export function parseArgs(argv) {
  const opts = {};
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (VALUE_FLAGS.includes(name)) opts[name] = argv[++i];
      else opts[name] = true;
    } else files.push(a);
  }
  return { opts, files };
}

function usage() {
  console.error(`usage:
  node scripts/social-visuals/visual.mjs --recipe <recipe.json> --project <slug> [--label name]
  node scripts/social-visuals/visual.mjs --edit <picture.jpg> "<what to change>" [--label name]
  node scripts/social-visuals/visual.mjs --resume <picture.jpg>
  flags: --no-stamp --scale N --dark --instagram --style NAME --aspect A --out PATH`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith("visual.mjs")) {
  const { opts, files } = parseArgs(process.argv.slice(2));
  const common = {
    style: opts.style,
    aspect: opts.aspect,
    resolution: opts.resolution,
    provider: opts.provider,
    model: opts.model,
    maxPolls: opts["max-polls"] ? parseInt(opts["max-polls"], 10) : undefined,
  };
  const stampOpts = {
    style: opts.style,
    scale: opts.scale ? parseFloat(opts.scale) : undefined,
    bottom: opts.bottom ? parseFloat(opts.bottom) : undefined,
    dark: opts.dark ? true : undefined,
    instagram: !!opts.instagram,
  };

  try {
    if (opts.resume) {
      const target = files[0] ?? opts.resume;
      const raw = sourceForEdit(target);
      const got = await resume(raw, common);
      const stamped = raw.replace(/\.raw\.jpg$/i, ".jpg");
      if (!opts["no-stamp"] && raw !== stamped) await stampInto(raw, stamped, stampOpts);
      writeIndex(dirname(raw));
      console.log(got.alreadyDone ? `already there -> ${stamped}` : `collected -> ${stamped}`);
    } else if (opts.edit) {
      const previous = typeof opts.edit === "string" ? opts.edit : files[0];
      const instruction = typeof opts.edit === "string" ? files[0] : files[1];
      if (!previous || !instruction) usage();
      const src = sourceForEdit(previous);
      const dir = dirname(resolve(src));
      const n = String(nextNumber(dir)).padStart(2, "0");
      const label = slugify(opts.label ?? "edit");
      const stamped = opts.out ? resolve(opts.out) : join(dir, `${n}-${label}.jpg`);
      const raw = rawPath(stamped);
      await editImage(src, instruction, raw, common);
      if (!opts["no-stamp"]) await stampInto(raw, stamped, stampOpts);
      writeIndex(dir);
      console.log(opts["no-stamp"] ? `edited -> ${raw}` : `edited and stamped -> ${stamped}`);
    } else if (opts.recipe) {
      const dir = opts.out ? dirname(resolve(opts.out)) : projectDir(opts.project ?? basename(opts.recipe, ".json"));
      mkdirSync(dir, { recursive: true });
      const n = String(nextNumber(dir)).padStart(2, "0");
      const label = slugify(opts.label ?? basename(opts.recipe, ".json"));
      const stamped = opts.out ? resolve(opts.out) : join(dir, `${n}-${label}.jpg`);
      const raw = rawPath(stamped);
      await renderRecipe(opts.recipe, raw, common);
      if (!opts["no-stamp"]) await stampInto(raw, stamped, stampOpts);
      writeIndex(dir);
      console.log(opts["no-stamp"] ? `rendered -> ${raw}` : `rendered and stamped -> ${stamped}`);
    } else usage();
  } catch (e) {
    console.error(`\n${e.message}`);
    if (e.resumable) console.error(`Nothing is lost and nothing needs paying for twice. Collect it with --resume.`);
    process.exit(1);
  }
}
