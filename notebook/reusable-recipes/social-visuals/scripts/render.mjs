// Turn a recipe into a picture.
//
// A recipe says what is in THIS frame. A style profile says what is true of every frame in a look.
// This file merges the two, hands the result to a provider, and writes a sidecar next to the image
// so the picture always carries the exact recipe that made it.
//
// THE SIDECAR IS WRITTEN BEFORE THE WAIT, not after. The provider hands back a task id in about a
// second and then the picture takes up to four minutes. If the wait is interrupted, or the poll
// limit runs out, the job carries on running and has already been paid for. With the id on disk,
// `--resume` collects it. Without the id, the only honest option is to pay a second time.
//
// Usage:
//   node scripts/social-visuals/render.mjs <recipe.json> <out.jpg> [--style selected] [--aspect 4:5]
//   node scripts/social-visuals/render.mjs --resume <out.jpg>
//   node scripts/social-visuals/render.mjs --edit <previous.jpg> "<what to change>" <out.jpg>

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as kie from "./providers/kie.mjs";
import {createHash} from 'node:crypto';
import {requireOutputPermission} from './spend-permission.mjs';
import {unstampedSource} from './source-image.mjs';

const GODSPEED = process.env.GODSPEED_WORKSPACE ? resolve(process.env.GODSPEED_WORKSPACE) : null;
if (!GODSPEED) throw Error("Choose this installation with GODSPEED_WORKSPACE; no personal workspace fallback is used");

export const PROVIDERS = { kie };
export const RECIPE_VERSION = "v1";

export function loadStyle(name = "selected") {
  if(!/^[a-z][a-z0-9-]{0,60}$/.test(name))throw Error('Choose a named style inside this installation');
  // skills/social-visuals/brand/ since 2026-09-22 (reader-layout plan); brand/ at Mission Control top before.
  const p = [resolve(GODSPEED, "skills", "social-visuals", "brand", "visual-style", `${name}.json`),
    resolve(GODSPEED, "brand", "visual-style", `${name}.json`)].find((q) => existsSync(q)) || resolve(GODSPEED, "skills", "social-visuals", "brand", "visual-style", `${name}.json`);
  if (!existsSync(p)) throw new Error(`no style profile called ${name}. Look in skills/social-visuals/brand/visual-style/.`);
  return JSON.parse(readFileSync(p, "utf8"));
}

// Merge a style profile into a recipe. The recipe always wins, so a single picture can break any
// house rule on purpose, and the merged object records which profile it came from.
export function mergeRecipe(recipe, style) {
  const merged = {
    version: RECIPE_VERSION,
    style_profile: style.profile,
    the_one_rule: recipe.the_one_rule ?? style.the_one_rule,
    the_second_rule: recipe.the_second_rule ?? style.the_second_rule,
    the_casing_rule: recipe.the_casing_rule ?? style.the_casing_rule,
    task: recipe.task ?? "single_object_photograph_where_the_lettering_is_part_of_the_object",
    output: { ...style.output, ...(recipe.output ?? {}) },
    // Two blocks that look alike and are not. `output` is prose the model reads, where "ultra_high"
    // is a useful word. `api_parameters` is what the endpoint is actually sent, where the only
    // legal values are things like "2K". Collapsing them sends "ultra_high" to the API, which the
    // API does not know, and the recipe silently loses its resolution.
    api_parameters: { ...(style.api_parameters ?? {}), ...(recipe.api_parameters ?? {}) },
    image_quality_simulation: { ...style.image_quality_simulation, ...(recipe.image_quality_simulation ?? {}) },
    subject: recipe.subject,
    composition: { ...style.composition_defaults, ...(recipe.composition ?? {}) },
    lighting: { ...style.lighting, ...(recipe.lighting ?? {}) },
    palette: { ...style.palette, ...(recipe.palette ?? {}) },
    // Both lists survive. A recipe adds its own bans without losing the house ones, and the house
    // ones are the reason the pictures do not drift back into stock AI imagery.
    strict_negatives: [...new Set([...(style.strict_negatives ?? []), ...(recipe.strict_negatives ?? [])])],
  };
  const worn = recipe.worn_and_real ?? style.worn_and_real;
  if (worn) merged.worn_and_real = worn;
  if (recipe.environment) merged.environment = recipe.environment;
  // Without this line a recipe's reference pictures were dropped here and toPayload never saw them.
  if (recipe.image_input?.length) merged.image_input = recipe.image_input;
  return merged;
}

// What actually goes over the wire. `image_input` and `api_parameters` are pulled out of the
// recipe and set as their own fields, exactly as scripts/generate_kie.py does, because the model
// reads `prompt` as one blob of text and would otherwise be told the aspect ratio twice.
export function toPayload(merged, overrides = {}) {
  const body = { ...merged };
  const api = body.api_parameters ?? {};
  const imageInput = body.image_input ?? [];
  delete body.api_parameters;
  delete body.image_input;
  return {
    prompt: JSON.stringify(body),
    aspect: overrides.aspect ?? api.aspect_ratio ?? body.output?.aspect_ratio ?? "4:5",
    resolution: overrides.resolution ?? api.resolution ?? body.output?.resolution ?? "2K",
    format: overrides.format ?? api.output_format ?? body.output?.output_format ?? "jpg",
    imageInput,
  };
}

const sidecarPath = (outPath) => `${outPath.replace(/\.(jpe?g|png|webp)$/i, "")}.render.json`;

function writeSidecar(outPath, data, {exclusive=false}={}) {
  const p = sidecarPath(outPath);
  mkdirSync(dirname(resolve(p)), { recursive: true });
  writeFileSync(resolve(p), JSON.stringify(data, null, 2),{flag:exclusive?'wx':'w'});
  return p;
}

export function readSidecar(outPath) {
  const p = sidecarPath(outPath);
  if (!existsSync(resolve(p))) throw new Error(`no render record beside ${outPath}. Nothing to resume.`);
  return JSON.parse(readFileSync(resolve(p), "utf8"));
}

async function collect(provider, taskId, outPath, record, opts = {}) {
  const url = await provider.waitForTask(taskId, {
    maxPolls: opts.maxPolls,
    onPoll: opts.quiet ? undefined : (n, state) => process.stderr.write(`  poll ${n}: ${state}\n`),
  });
  const bytes = await provider.download(url);
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), bytes);
  writeSidecar(outPath, { ...record, state: "ready", image_url: url, image_sha256:createHash('sha256').update(bytes).digest('hex'), finished_at: new Date().toISOString() });
  return { path: outPath, url, taskId };
}

export async function renderRecipe(recipeOrPath, outPath, opts = {}) {
  if(existsSync(sidecarPath(outPath))||existsSync(resolve(outPath)))throw Error('This picture already has a retained result or task; resume or review it before starting another');
  if((opts.provider??'kie')==='kie')requireOutputPermission(outPath);
  const provider = PROVIDERS[opts.provider ?? "kie"];
  if (!provider) throw new Error(`no provider called ${opts.provider}`);
  const recipe = typeof recipeOrPath === "string" ? JSON.parse(readFileSync(resolve(recipeOrPath), "utf8")) : recipeOrPath;
  const style = loadStyle(opts.style ?? recipe.style_profile ?? "selected");
  const merged = mergeRecipe(recipe, style);
  const payload = toPayload(merged, opts);

  writeSidecar(outPath,{version:RECIPE_VERSION,state:'preparing',mode:'fresh',provider:provider.id,model:opts.model??provider.defaultModel,started_at:new Date().toISOString(),recipe:merged},{exclusive:true});
  const imageUrls = [];
  for (const ref of [...(payload.imageInput ?? []), ...(opts.inputImages ?? [])]) {
    imageUrls.push(await provider.toImageUrl(ref));
  }

  const { taskId } = await provider.createTask({ ...payload, imageUrls, model: opts.model });
  const record = {
    version: RECIPE_VERSION,
    mode: "fresh",
    provider: provider.id,
    model: opts.model ?? provider.defaultModel,
    task_id: taskId,
    state: "rendering",
    started_at: new Date().toISOString(),
    style_profile: style.profile,
    aspect: payload.aspect,
    resolution: payload.resolution,
    parent: opts.parent ?? null,
    change_note: null,
    recipe: merged,
  };
  writeSidecar(outPath, record);
  if (!opts.quiet) process.stderr.write(`  task ${taskId} started, recorded beside ${outPath}\n`);
  return collect(provider, taskId, outPath, record, opts);
}

// Change one thing about a picture that already exists, by handing the picture itself back to the
// model. Everything the model is not told about stays as it was, which is what "that image, but
// with this change" almost always means.
export async function editImage(previousPath, instruction, outPath, opts = {}) {
  previousPath=unstampedSource(previousPath);
  if(existsSync(sidecarPath(outPath))||existsSync(resolve(outPath)))throw Error('This edited picture already has a retained result or task; resume or review it before another purchase');
  if((opts.provider??'kie')==='kie')requireOutputPermission(outPath);
  const provider = PROVIDERS[opts.provider ?? "kie"];
  let parentRecord = null;
  try {
    parentRecord = readSidecar(previousPath);
  } catch {
    // Editing a picture that came from somewhere else is allowed. There is simply no recipe to
    // inherit, so the edit carries the style profile's rules and nothing more.
  }
  const style = loadStyle(opts.style ?? parentRecord?.style_profile ?? "selected");

  // The guardrails matter. Without them the model treats an edit as a fresh brief and re-rolls the
  // whole frame, which is the failure everybody mistakes for "the model ignored me".
  const prompt = JSON.stringify({
    task: "edit_the_supplied_photograph",
    keep: "Everything not named below stays EXACTLY as it is in the supplied image: the same object, the same materials, the same wear, the same camera angle, the same lighting, the same background, and the same lettering unless the change asks for different words.",
    change: instruction,
    the_one_rule: style.the_one_rule,
    strict_negatives: style.strict_negatives,
    output: { ...style.output, ...(opts.output ?? {}) },
  });

  writeSidecar(outPath,{version:RECIPE_VERSION,state:'preparing',mode:'edit',provider:provider.id,model:opts.model??provider.defaultModel,parent:previousPath,change_note:instruction,started_at:new Date().toISOString()},{exclusive:true});
  const imageUrls = [await provider.toImageUrl(previousPath)];
  const aspect = opts.aspect ?? parentRecord?.aspect ?? style.output?.aspect_ratio ?? "4:5";
  const resolution = opts.resolution ?? parentRecord?.resolution ?? style.api_parameters?.resolution ?? "2K";
  const { taskId } = await provider.createTask({ prompt, aspect, resolution, format: "jpg", imageUrls, model: opts.model });

  const record = {
    version: RECIPE_VERSION,
    mode: "edit",
    provider: provider.id,
    model: opts.model ?? provider.defaultModel,
    task_id: taskId,
    state: "rendering",
    started_at: new Date().toISOString(),
    style_profile: style.profile,
    aspect,
    resolution,
    parent: previousPath,
    change_note: instruction,
    recipe: parentRecord?.recipe ?? null,
  };
  writeSidecar(outPath, record);
  if (!opts.quiet) process.stderr.write(`  edit task ${taskId} started, recorded beside ${outPath}\n`);
  return collect(provider, taskId, outPath, record, opts);
}

// Pick up a job whose wait was cut short. Costs nothing, because the job was already paid for.
export async function resume(outPath, opts = {}) {
  const record = readSidecar(outPath);
  const provider = PROVIDERS[record.provider] ?? PROVIDERS.kie;
  if (record.state === "ready" && existsSync(resolve(outPath))) {
    return { path: outPath, url: record.image_url, taskId: record.task_id, alreadyDone: true };
  }
  if (!record.task_id) throw new Error(`the record beside ${outPath} has no task id`);
  return collect(provider, record.task_id, outPath, record, opts);
}

// ---------------------------------------------------------------- command line
const VALUE_FLAGS = ["style", "aspect", "resolution", "provider", "model", "max-polls"];

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

if (process.argv[1] && process.argv[1].endsWith("render.mjs")) {
  const { opts, files } = parseArgs(process.argv.slice(2));
  const common = {
    style: opts.style,
    aspect: opts.aspect,
    resolution: opts.resolution,
    provider: opts.provider,
    model: opts.model,
    maxPolls: opts["max-polls"] ? parseInt(opts["max-polls"], 10) : undefined,
  };
  try {
    let out;
    if (opts.resume) {
      out = await resume(files[0], common);
      console.log(out.alreadyDone ? `already there -> ${out.path}` : `collected -> ${out.path}`);
    } else if (opts.edit) {
      const [previous, instruction, dst] = files;
      if (!previous || !instruction || !dst) {
        console.error('usage: node scripts/social-visuals/render.mjs --edit <previous.jpg> "<what to change>" <out.jpg>');
        process.exit(1);
      }
      out = await editImage(previous, instruction, dst, common);
      console.log(`edited -> ${out.path}`);
    } else {
      const [recipe, dst] = files;
      if (!recipe || !dst) {
        console.error("usage: node scripts/social-visuals/render.mjs <recipe.json> <out.jpg> [--style N] [--aspect 4:5]");
        process.exit(1);
      }
      out = await renderRecipe(recipe, dst, common);
      console.log(`rendered -> ${out.path}`);
    }
  } catch (e) {
    console.error(`\n${e.message}`);
    if (e.resumable) console.error(`Resume with: node scripts/social-visuals/render.mjs --resume ${files.at(-1)}`);
    process.exit(1);
  }
}
