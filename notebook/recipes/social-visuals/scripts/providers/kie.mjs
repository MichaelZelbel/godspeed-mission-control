// The kie.ai adapter: Nano Banana 2, which is the model that made the surrender flag.
//
// This is the first of the two adapters because it is the one that is proven. Everything here
// mirrors scripts/generate_kie.py, which produced prompts/library/gv-photo-card-example.jpg, with
// three deliberate differences:
//
//   1. The key is read from the environment FIRST and from .env only as a fallback. The Python
//      script reads .env only, so on a machine where the secrets layer had exported the key
//      properly it still said the key was missing.
//   2. The task id is handed back to the caller the moment it exists, before any polling. The
//      Python script gives up after 60 polls while the job carries on running on the server, and
//      the only recovery is to notice the id in the scrollback. Losing it means paying twice.
//   3. Local files given as reference images are uploaded first, so `edit` works with a picture
//      that only exists on disk.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const GODSPEED = process.env.GODSPEED_WORKSPACE ? resolve(process.env.GODSPEED_WORKSPACE) : null;
if (!GODSPEED) throw Error("Choose this installation with GODSPEED_WORKSPACE; no personal workspace fallback is used");

const CREATE = "https://api.kie.ai/api/v1/jobs/createTask";
const RECORD = "https://api.kie.ai/api/v1/jobs/recordInfo";
const UPLOAD = "https://kieai.redpandaai.co/api/file-base64-upload";
import {requireUploadPermission,reserveGeneration,retainSubmittedTask} from "../spend-permission.mjs";

export const id = "kie";
export const defaultModel = "nano-banana-2";

function configuration(){
 const file=resolve(GODSPEED,'.godspeed','connectors','social-visuals','provider.json');
 return existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{};
}
export function apiKey(){
 const key=process.env.KIE_API_KEY||process.env.KIE_AI_API_KEY||configuration().key;
 if(!key)throw Error('Configure the selected device-private image provider or load its credentials');return key;
}

const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` });

async function json(url, init) {
  const r = await fetch(url, {...init,signal:AbortSignal.timeout(30000)});
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`${url} answered ${r.status} with something that is not JSON: ${text.slice(0, 300)}`); }
  if (!r.ok) throw new Error(`${url} answered ${r.status}: ${text.slice(0, 300)}`);
  return body;
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

// A reference image can be a URL already, or a file on this machine. Files have to go up first,
// because the API takes URLs only.
export async function toImageUrl(pathOrUrl) {
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  const abs = resolve(pathOrUrl);
  requireUploadPermission(abs);
  if (!existsSync(abs)) throw new Error(`no reference image at ${abs}`);
  const mime = MIME[extname(abs).toLowerCase()] || "image/png";
  const body = JSON.stringify({
    base64Data: `data:${mime};base64,${readFileSync(abs).toString("base64")}`,
    uploadPath: "social-visuals",
    fileName: basename(abs),
  });
  const data = await json(UPLOAD, { method: "POST", headers: headers(), body });
  const url = data?.data?.downloadUrl || data?.data?.fileUrl || data?.data?.url || data?.url;
  if (!url) throw new Error(`upload of ${basename(abs)} gave back no URL: ${JSON.stringify(data).slice(0, 300)}`);
  return url;
}

// Start a job and return its id straight away. The caller writes the id down BEFORE waiting.
export async function createTask({ prompt, aspect = "4:5", resolution = "2K", format = "jpg", imageUrls = [], model = defaultModel, googleSearch }) {
  apiKey();
  const reservation=reserveGeneration({model,resolution,prompt,imageUrls});
  const input = { prompt, aspect_ratio: aspect, resolution, output_format: format };
  if (imageUrls.length) input.image_input = imageUrls;
  if (googleSearch !== undefined) input.google_search = googleSearch;
  const body = await json(CREATE, { method: "POST", headers: headers(), body: JSON.stringify({ model, input }) });
  const taskId = body?.data?.taskId;
  if (!taskId) throw new Error(`no taskId came back: ${JSON.stringify(body).slice(0, 300)}`);
  retainSubmittedTask(reservation,taskId);
  return { taskId };
}

// Start a VIDEO job. Same Jobs API, video-shaped input. Field names follow the Seedance 2.0
// schema (docs.kie.ai/market/bytedance/seedance-2); other market models take the same envelope
// with their own input fields, which `extra` passes through untouched.
export async function createVideoTask({ prompt, model = "bytedance/seedance-2", duration = 5, aspect = "16:9", resolution = "720p", audio = true, firstFrameUrl, lastFrameUrl, extra = {} }) {
  throw Error("Video generation requires its separately authorized workflow; this picture method does not grant video spend");
  const input = { prompt, aspect_ratio: aspect, duration, resolution, generate_audio: audio, ...extra };
  if (firstFrameUrl) input.first_frame_url = firstFrameUrl;
  if (lastFrameUrl) input.last_frame_url = lastFrameUrl;
  const body = await json(CREATE, { method: "POST", headers: headers(), body: JSON.stringify({ model, input }) });
  const taskId = body?.data?.taskId;
  if (!taskId) throw new Error(`no taskId came back: ${JSON.stringify(body).slice(0, 300)}`);
  return { taskId };
}

// Ask once what a job is doing. Separated from the waiting loop so a resume can ask a single time.
export async function checkTask(taskId) {
  const body = await json(`${RECORD}?taskId=${encodeURIComponent(taskId)}`, { headers: headers() });
  const data = body?.data ?? {};
  const state = data.state;
  if (state === "success" || state === "completed") {
    let parsed = {};
    try { parsed = JSON.parse(data.resultJson || "{}"); } catch { /* fall through to the error below */ }
    const url = parsed?.resultUrls?.[0];
    if (!url) throw new Error(`the job finished but carried no image URL: ${JSON.stringify(data).slice(0, 400)}`);
    return { done: true, url };
  }
  if (state === "failed" || state === "error") throw new Error(`the job failed on their side: ${JSON.stringify(data).slice(0, 400)}`);
  return { done: false, state: state ?? "unknown" };
}

export async function waitForTask(taskId, { maxPolls = 60, intervalMs = 4000, onPoll } = {}) {
  for (let i = 1; i <= maxPolls; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    let step;
    try { step = await checkTask(taskId); } catch (e) {
      if (/failed on their side|carried no image URL/.test(e.message)) throw e;
      onPoll?.(i, `retrying after ${e.message}`);
      continue;
    }
    if (step.done) return step.url;
    onPoll?.(i, step.state);
  }
  const e = new Error(`gave up waiting after ${maxPolls} polls. The job is probably still running. Resume it with the task id, do NOT start a new one, that pays twice.`);
  e.taskId = taskId;
  e.resumable = true;
  throw e;
}

export async function download(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`downloading the image answered ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
