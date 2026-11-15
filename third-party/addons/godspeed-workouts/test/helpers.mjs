import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { statePaths } from "../lib/paths.mjs";
import { loadSettings, saveSettings } from "../lib/settings.mjs";
import { saveKey } from "../lib/keys.mjs";
import { runSync } from "../lib/sync.mjs";
import { Hevy } from "../lib/hevy.mjs";
import { startFakeHevy, KEY } from "./fakes/hevy.mjs";
import { startFakeNotebook } from "./fakes/notebook.mjs";

export function tmp(name = "w") {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gw-${name}-`));
}

// A clock the test moves.
export function clock(start = "2026-10-24T10:17:00Z") {
  let t = new Date(start).getTime();
  const c = () => new Date(t);
  c.add = (ms) => { t += ms; };
  c.hours = (h) => { t += h * 3600e3; };
  c.set = (iso) => { t = new Date(iso).getTime(); };
  return c;
}

// A whole world: a pretend Hevy, a pretend notebook (or a real one), a state folder with the key,
// and run() doing what the hourly run does.
export async function world({ notebook, settings: extra = {}, key = KEY } = {}) {
  const now = clock();
  const hevy = await startFakeHevy({ clock: now });
  const nb = notebook || (await startFakeNotebook());
  const dir = tmp("state");
  const paths = statePaths(dir);
  saveSettings(paths, { ...loadSettings(paths), minute: 17, second: 5, ...extra });
  if (key) saveKey(paths, key);
  const told = [];
  const env = { GODSPEED_WORKOUTS_TEST: "1", GODSPEED_WORKOUTS_HEVY_API: hevy.url, GODSPEED_WORKOUTS_NOTEBOOK: nb.url };
  const run = (opts = {}) => runSync({
    paths, settings: loadSettings(paths), env, full: !!opts.full,
    deps: { now, hevyFor: (k) => new Hevy({ key: k, base: hevy.url, pauseMs: 0 }), tell: async (text, o) => { told.push({ text, ...o }); return { delivered: true, results: { test: "ok" } }; } },
  });
  const state = () => JSON.parse(fs.readFileSync(paths.state, "utf8"));
  const records = () => { try { return JSON.parse(fs.readFileSync(paths.records, "utf8")); } catch { return {}; } };
  const log = () => { try { return fs.readFileSync(paths.log, "utf8"); } catch { return ""; } };
  return {
    now, hevy, nb, paths, env, told, run, state, records, log,
    close: async () => { await hevy.close(); if (!notebook) await nb.close(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}
