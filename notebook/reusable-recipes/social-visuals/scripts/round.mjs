// The mechanical half of a scroll-stop round: the steps that are the same every time, so a session
// spends its attention on ideas and on looking, not on re-writing resize loops and balance calls.
// The method itself, and why each step exists, is skills/social-visuals/scroll-stop.md.
//
//   node round.mjs balance
//   node round.mjs sketch <dir> <recipe.json>...        1K renders in parallel into <dir>/sketches/,
//                                                       each with a 400 px feed copy beside it
//   node round.mjs feed <picture.jpg>...                400 px copies, for pictures made elsewhere
//   node round.mjs blind <dir> <sketch.jpg>...          letter-named feed copies for the blind judge,
//                                                       plus the key and the prompt to give it
//   node round.mjs final <dir> <recipe.json> <sketch.jpg> <name>
//                                                       2K render reproducing the sketch, then
//                                                       stamped twice (standard and Instagram)
//   node round.mjs cost <sidecar.render.json>...        what each task really charged
//
// WHY COST READS THE TASK AND NOT THE BALANCE. On 2026-09-23 the balance fell 104 while eight 1K
// sketches that each cost 8 were rendering: something else was spending on the same key at the same
// time. The balance is shared; the task record's own credit figure is not. Measure with the task.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import imageScript from "./vendor/imagescript/ImageScript.js";
const { Image } = imageScript;
import { renderRecipe, readSidecar } from "./render.mjs";
import { stamp } from "./stamp.mjs";
import * as kie from "./providers/kie.mjs";

const auth = () => ({ Authorization: `Bearer ${kie.apiKey()}` });

export async function balance() {
  const r = await fetch("https://api.kie.ai/api/v1/chat/credit", { headers: auth() });
  return (await r.json()).data;
}

export async function taskCost(taskId) {
  const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, { headers: auth() });
  const d = (await r.json()).data ?? {};
  return { state: d.state, credits: d.creditsConsumed ?? d.consumeCredits ?? null, failCode: d.failCode ?? null, failMsg: d.failMsg ?? null };
}

const stem = (p) => basename(p).replace(/\.(jpe?g|png|webp|json)$/i, "");

export async function feedCopy(picture, width = 400) {
  const img = await Image.decode(readFileSync(picture));
  img.resize(width, Image.RESIZE_AUTO);
  const out = picture.replace(/\.(jpe?g|png|webp)$/i, `.${width}.jpg`);
  writeFileSync(out, await img.encodeJPEG(88));
  return out;
}

async function sketch(dir, recipes) {
  const out = join(dir, "sketches");
  mkdirSync(out, { recursive: true });
  const results = await Promise.all(recipes.map(async (path) => {
    const recipe = JSON.parse(readFileSync(path, "utf8"));
    recipe.api_parameters = { ...(recipe.api_parameters ?? {}), resolution: "1K" };
    const jpg = join(out, `${stem(path)}.jpg`);
    try {
      await renderRecipe(recipe, jpg, { quiet: true });
      await feedCopy(jpg);
    } catch { /* the task record below says what happened */ }
    let rec = null;
    try { rec = readSidecar(jpg); } catch { return { name: stem(path), state: "not started" }; }
    return { name: stem(path), ...(await taskCost(rec.task_id)) };
  }));
  for (const r of results) {
    const hint = r.failCode === "524" ? "  (timeout, charged nothing: too many small repeated things; thin them and render again)" : "";
    console.log(`${r.state === "success" ? "ok  " : "FAIL"} ${r.name}  credits=${r.credits ?? "?"}${r.failMsg ? `  ${r.failMsg}` : ""}${hint}`);
  }
  const spent = results.reduce((n, r) => n + (r.credits ?? 0), 0);
  console.log(`spent ${spent} credits on ${results.filter((r) => r.state === "success").length} sketches`);
}

function blind(dir, sketches) {
  const out = join(dir, "sketches", "judge");
  mkdirSync(out, { recursive: true });
  const key = [];
  sketches.forEach((s, i) => {
    const letter = String.fromCharCode(65 + i);
    const small = s.replace(/(\.400)?\.jpg$/i, ".400.jpg");
    if (!existsSync(small)) throw new Error(`no feed copy at ${small}; run: node round.mjs feed ${s}`);
    copyFileSync(small, join(out, `${letter}.jpg`));
    key.push(`${letter} ${stem(s).replace(/\.400$/, "")}`);
  });
  writeFileSync(join(out, "key.txt"), key.join("\n") + "\n");
  const files = key.map((k) => `  ${resolve(out, k[0] + ".jpg")}`).join("\n");
  console.log(`key written to ${join(out, "key.txt")}. Give the judge exactly this, with the post text pasted in:\n
You are judging candidate images for a social media post. Look at each of these images with the Read tool. They are shown at 400 pixels wide, roughly feed size on a phone:
${files}
Do not open any other file. The post text is:
"<POST TEXT>"
Pick the FOUR that would most make a stranger stop scrolling for a moment while still saying what the post says. Rank them 1 to 4, one sentence of reason each. Then one line naming any image you would reject outright and why. Reply with only that, using the letters.`);
}

async function final(dir, recipePath, sketchPath, name) {
  const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
  recipe.api_parameters = { ...(recipe.api_parameters ?? {}), resolution: "2K" };
  recipe.image_input = [sketchPath];
  recipe.subject = {
    the_reference: "The supplied image is the approved sketch. Reproduce that EXACT photograph at higher resolution and finer detail: the same object, the same pose, the same camera angle and crop, the same light, the same background, the same handwriting and wording. Do not recompose, do not add or remove anything.",
    ...recipe.subject,
  };
  const finalRecipe = join(dir, `${name}.json`);
  writeFileSync(finalRecipe, JSON.stringify(recipe, null, 2) + "\n");
  const raw = join(dir, `${name}.jpg`);
  await renderRecipe(recipe, raw, { quiet: true });
  for (const instagram of [false, true]) {
    const { bytes } = await stamp(readFileSync(raw), { instagram });
    writeFileSync(join(dir, `${name}.stamped${instagram ? "-instagram" : ""}.jpg`), bytes);
  }
  const c = await taskCost(readSidecar(raw).task_id);
  console.log(`${raw} rendered (${c.credits ?? "?"} credits) and stamped; look at it before using it`);
}

if (process.argv[1] && process.argv[1].endsWith("round.mjs")) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "balance") console.log(await balance());
    else if (cmd === "sketch") await sketch(args[0], args.slice(1));
    else if (cmd === "feed") for (const p of args) console.log(await feedCopy(p));
    else if (cmd === "blind") blind(args[0], args.slice(1));
    else if (cmd === "final") await final(args[0], args[1], args[2], args[3]);
    else if (cmd === "cost") for (const p of args) console.log(basename(p), JSON.stringify(await taskCost(JSON.parse(readFileSync(p, "utf8")).task_id)));
    else { console.error("usage: see the top of round.mjs"); process.exit(1); }
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
