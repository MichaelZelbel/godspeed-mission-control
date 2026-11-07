// The commands. `godspeed-workouts help` lists them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stateDir, statePaths, appDir, binDir, findMissionControl, NAME } from "./paths.mjs";
import { loadSettings, saveSettings, setSetting, randomMinute } from "./settings.mjs";
import { ensurePrivateDir, readJson, writePrivate } from "./files.mjs";
import { readKey, saveKey, cleanKey, keyFromOutside } from "./keys.mjs";
import { Hevy, HevyError } from "./hevy.mjs";
import { Notebook, collectionLink } from "./notebook.mjs";
import { runSync, hevyBase, notebookBase } from "./sync.mjs";
import { scheduleKind, installSchedule, removeSchedule, scheduleStatus } from "./schedule.mjs";
import { readiness } from "./channels/index.mjs";
import { localStamp, machineZone } from "./clock.mjs";
import { Records } from "./tracker.mjs";

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8")).version;

const VALUE = new Set(["state", "godspeed", "talk", "tracker"]);
const BOOL = new Set(["help", "no-schedule", "no-run", "full", "scheduled", "json"]);

export function parse(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const k = typeof a === "string" && a.startsWith("--") ? a.slice(2) : null;
    if (k && BOOL.has(k)) { flags[k] = true; continue; }
    if (k && VALUE.has(k)) { flags[k] = i + 1 < argv.length ? argv[++i] : ""; continue; }
    rest.push(a);
  }
  return { flags, rest };
}

const HELP = `godspeed-workouts ${VERSION}: your Hevy workouts in your Godspeed notebook

  setup        add it: the Hevy key, the Workouts tracker, every workout so far, the hourly run
               [--godspeed <mission control folder>] [--talk health] [--tracker <name>] [--no-run] [--no-schedule]
  connect      a new Hevy key (HEVY_API_KEY in the environment, standard input, or typed), then a run
  run          bring the notebook level with Hevy now [--full: read every workout again]
  status       what it did last, the tracker, the hourly run, any problem
  settings     show, or set <name> <value> (tracker, names, talks, minute, timezone, tell, telegram_env, workspace, texts.<name>)
  uninstall    remove the hourly run (the tracker, its rows and the state folder stay)
  help         this

The Hevy key comes from https://hevy.com/settings?developer (Hevy Pro). It is kept in the state
folder only (${stateDir()}), readable by its owner only, and never printed.`;

function schedParams(paths, settings) {
  const app = appDir();
  const script = fs.existsSync(path.join(app, "bin", `${NAME}.mjs`)) ? path.join(app, "bin", `${NAME}.mjs`) : path.join(PKG, "bin", `${NAME}.mjs`);
  return {
    kind: scheduleKind(), node: process.execPath, script, stateDir: paths.root, version: VERSION,
    minute: settings.minute, second: settings.second || 0, home: os.homedir(),
    path: [path.dirname(process.execPath), ...(String(process.env.PATH || "").split(path.delimiter))].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(path.delimiter),
  };
}

function copyProgram(target) {
  if (path.resolve(target) === PKG) return false;
  const tmp = `${target}.new`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const p of ["bin", "lib", "package.json", "README.md", "LICENSE", "CHANGELOG.md"]) {
    const from = path.join(PKG, p);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(tmp, p), { recursive: true });
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(tmp, target);
  return true;
}

function writeLauncher(dir, script) {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === "win32") {
    const f = path.join(dir, `${NAME}.cmd`);
    fs.writeFileSync(f, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return f;
  }
  const f = path.join(dir, NAME);
  fs.writeFileSync(f, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  return f;
}

// The key from outside, checked with Hevy before it is kept: a key Hevy refuses is never saved.
async function takeKey(ctx, { ask }) {
  const raw = await keyFromOutside({ env: ctx.env, ask });
  if (!raw) return { key: null };
  const key = cleanKey(raw);
  const hevy = new Hevy({ key, base: hevyBase(ctx.env) });
  try {
    const user = await hevy.userInfo();
    saveKey(ctx.paths, key);
    return { key, user };
  } catch (e) {
    if (e instanceof HevyError && e.kind === "key") throw new Error("Hevy refused that key. Make a new one at https://hevy.com/settings?developer (it needs Hevy Pro) and try again.");
    if (e instanceof HevyError && e.kind === "down") { saveKey(ctx.paths, key); return { key, user: null, why: e.message }; }
    throw e;
  }
}

const userWords = (u) => (u ? `Hevy account ${u.name || u.id}${u.pro === false ? " (Hevy says it has no Hevy Pro; the connection needs it)" : ""}, weights in ${u.weight}` : "");

async function setup(ctx) {
  const { flags, print, paths } = ctx;
  ensurePrivateDir(paths.root);
  let settings = loadSettings(paths);
  const ws = findMissionControl({ arg: flags.godspeed, env: ctx.env });
  if (ws) { settings.workspace = ws; print(`Mission control: ${ws}`); }
  else if (flags.godspeed) throw new Error(`${flags.godspeed} is not a mission control folder (it has no AGENTS.md)`);
  else print("No mission control folder was found here; coaching talks and the assistant's Telegram bot are found once one is named with --godspeed.");
  if (!settings.minute) Object.assign(settings, randomMinute());
  if (flags.tracker) settings = setSetting(settings, "tracker", flags.tracker);
  if (flags.talk !== undefined) settings = setSetting(settings, "talks", flags.talk);
  saveSettings(paths, settings);

  // The key.
  let key = readKey(paths), user = null;
  if (ctx.env.HEVY_API_KEY || !key) {
    const got = await takeKey(ctx, { ask: true });
    if (got.key) { key = got.key; user = got.user; print(`Hevy key saved${user ? `: ${userWords(user)}` : ` (Hevy did not answer just now: ${got.why}; it is checked at the first run)`}.`); }
  } else {
    try { user = await new Hevy({ key, base: hevyBase(ctx.env) }).userInfo(); print(`Hevy key: kept, ${userWords(user)}.`); }
    catch (e) { print(`Hevy key: kept, but ${e.message}.`); }
  }
  if (!key) print("No Hevy key yet. Make one at https://hevy.com/settings?developer (Hevy Pro), then run: godspeed-workouts connect");

  // The notebook.
  const nb = new Notebook({ base: notebookBase(ctx.env) });
  const up = await nb.answers();
  const zone = up ? await nb.timezone() : null;
  print(up ? `Notebook: ${notebookBase(ctx.env)}${zone ? `, time zone ${zone}` : ""}` : `The notebook does not answer at ${notebookBase(ctx.env)}; the first run waits for it.`);
  if (ctx.env.GODSPEED_WORKOUTS_NOTEBOOK) writePrivate(paths.serviceEnv, `GODSPEED_WORKOUTS_NOTEBOOK=${ctx.env.GODSPEED_WORKOUTS_NOTEBOOK}\n`);

  // The program and its command.
  const app = appDir();
  if (copyProgram(app)) print(`Program: ${app}`);
  const launcher = writeLauncher(binDir(), path.join(app, "bin", `${NAME}.mjs`));
  print(`Command: ${launcher}`);

  // A run now: on a first setup, every workout so far.
  if (key && up && !flags["no-run"]) {
    const first = !readJson(paths.state, {}).backfill?.done_at;
    const r = await runSync({ paths, settings: loadSettings(paths), env: ctx.env });
    print(`${first ? "First run" : "Run"}: ${r.summary}`);
  }
  if (!flags["no-schedule"]) {
    const s = installSchedule(schedParams(paths, loadSettings(paths)));
    print(s.ok ? `Hourly run: ${s.text}` : `The hourly run was not installed: ${s.text}`);
    if (!s.ok) return 1;
  }
  const st = readJson(paths.state, {});
  const link = collectionLink(st.web, st.collection?.slug);
  if (link) print(`Your Workouts tracker: ${link}`);
  print("Change a workout in Hevy and its row follows within the hour; delete it there and the row goes. A cell you change in the notebook stays as you wrote it, and \"Your comment\" is yours.");
  return 0;
}

async function connect(ctx) {
  ensurePrivateDir(ctx.paths.root);
  const got = await takeKey(ctx, { ask: true });
  if (!got.key) { ctx.fail("No key was given. Put it in HEVY_API_KEY, pipe it in, or type it when asked."); return 1; }
  ctx.print(`Hevy key saved${got.user ? `: ${userWords(got.user)}` : ""}.`);
  const r = await runSync({ paths: ctx.paths, settings: ctx.settings, env: ctx.env });
  ctx.print(`Run: ${r.summary}`);
  return r.code;
}

async function runCmd(ctx) {
  const r = await runSync({ paths: ctx.paths, settings: ctx.settings, env: ctx.env, full: !!ctx.flags.full });
  if (!ctx.flags.scheduled || !r.ok) ctx.print(r.summary);
  return r.code;
}

function status(ctx) {
  const { paths, settings, print } = ctx;
  const st = readJson(paths.state, {});
  const tz = settings.timezone || st.tz || machineZone();
  const at = (iso) => (iso ? `${localStamp(iso, tz)} (${tz})` : "never");
  const records = new Records(paths.records);
  const rows = records.all();
  if (ctx.flags.json) { print(JSON.stringify({ version: VERSION, state: st, rows: rows.length, key: !!readKey(paths) }, null, 1)); return 0; }
  print(`godspeed-workouts ${VERSION}, state folder ${paths.root}`);
  print(`Hevy key: ${readKey(paths) ? "saved" : "none (godspeed-workouts connect)"}`);
  const link = collectionLink(st.web, st.collection?.slug);
  print(`Tracker: "${settings.tracker}"${link ? ` ${link}` : st.collection?.id ? ` (${st.collection.id})` : " (not made yet)"}; ${rows.filter(([, r]) => !r.gone && !r.deleted_by_you).length} row(s) from Hevy, ${rows.filter(([, r]) => (r.mine || []).length).length} with cells of yours, ${rows.filter(([, r]) => r.deleted_by_you).length} deleted by you`);
  const lr = st.last_run;
  print(`Last run: ${lr ? `${at(lr.at)}, ${lr.ok ? `${lr.how}: ${["added", "changed", "removed", "kept"].map((k) => `${lr[k] || 0} ${k}`).join(", ")}` : `stopped: ${lr.why}`}` : "never"}`);
  print(`Backfill: ${st.backfill?.done_at ? `done ${at(st.backfill.done_at)} (${st.backfill.workouts} workout(s))` : "not yet"}; events read since ${st.cursor ? at(st.cursor) : "-"}`);
  print(`Hourly run: minute ${settings.minute ?? "-"}; ${scheduleStatus(schedParams(paths, settings)).text}`);
  for (const r of readiness(settings, { env: ctx.env })) print(`Messages: ${r.name} ${r.ok ? "ready" : "not ready"}: ${r.why}`);
  const problems = Object.entries(st.problems || {});
  if (st.hevy_down_since) problems.push(["hevy-not-answering", { since: st.hevy_down_since }]);
  if (st.notebook_down_since) problems.push(["notebook-not-answering", { since: st.notebook_down_since }]);
  print(problems.length ? `Problems: ${problems.map(([k, p]) => `${k} since ${at(p.since)}${p.why ? ` (${p.why})` : ""}${st.told?.[`${k}:${p.since}`] ? ", told" : ""}`).join("; ")}` : "Problems: none");
  return 0;
}

function settingsCmd(ctx) {
  const [sub, key, ...value] = ctx.rest;
  if (!sub || sub === "show") {
    const { texts, ...rest } = ctx.settings;
    ctx.print(JSON.stringify({ ...rest, texts }, null, 1));
    return 0;
  }
  if (sub !== "set" || !key) { ctx.fail("Use: godspeed-workouts settings show, or settings set <name> <value>"); return 1; }
  const next = setSetting(ctx.settings, key, value.join(" "));
  saveSettings(ctx.paths, next);
  ctx.print(`${key} is now ${JSON.stringify(key.startsWith("texts.") ? next.texts[key.slice(6)] : next[key])}`);
  if (key === "minute") {
    const s = installSchedule(schedParams(ctx.paths, next));
    ctx.print(s.ok ? `Hourly run: ${s.text}` : `The hourly run was not changed: ${s.text}`);
  }
  if (key === "tracker" || key === "names" || key === "talks") ctx.print("This applies when the tracker is made. For an existing tracker, rename it in the notebook, or tell your assistant which talk may look at it.");
  return 0;
}

function uninstall(ctx) {
  const s = removeSchedule(schedParams(ctx.paths, ctx.settings));
  ctx.print(s.text);
  ctx.print(`The Workouts tracker and its rows stay in your notebook; the state folder (${ctx.paths.root}) with your Hevy key stays too. Delete that folder to forget the key.`);
  return 0;
}

export async function main(argv, { print = (s) => console.log(s), fail = (s) => console.error(s), env = process.env } = {}) {
  const { flags, rest } = parse(argv);
  const name = rest[0] || (flags.help ? "help" : "status");
  const paths = statePaths(path.resolve(flags.state || stateDir({ env })));
  const ctx = { name, flags, rest: rest.slice(1), print, fail, env, paths, settings: loadSettings(paths) };
  const commands = { setup, connect, run: runCmd, status, settings: settingsCmd, uninstall, help: () => { print(HELP); return 0; } };
  const c = commands[name];
  if (!c) { fail(`Unknown command ${name}. Try: godspeed-workouts help`); return 1; }
  if (flags.help) { print(HELP); return 0; }
  return (await c(ctx)) ?? 0;
}
