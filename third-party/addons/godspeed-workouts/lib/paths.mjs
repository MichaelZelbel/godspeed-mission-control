// Where things live.
//
// Everything the add-on keeps is in one private state folder, never in git and never in the
// mission control folder: the settings, the Hevy key, one record per workout, the run state and the
// log. Linux as root: /var/lib/godspeed/workouts; otherwise ~/.godspeed/workouts.
// GODSPEED_WORKOUTS_STATE names another one (the tests use that).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NAME = "godspeed-workouts";

export const isRoot = () => typeof process.getuid === "function" && process.getuid() === 0;

export function stateDir({ env = process.env, platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  if (env.GODSPEED_WORKOUTS_STATE) return path.resolve(env.GODSPEED_WORKOUTS_STATE);
  if (platform === "linux" && root) return "/var/lib/godspeed/workouts";
  return path.join(home, ".godspeed", "workouts");
}

export function statePaths(dir) {
  const p = (...a) => path.join(dir, ...a);
  return {
    root: dir,
    settings: p("settings.json"),     // the person's choices: the tracker's name, the minute, where messages go
    hevy: p("hevy.json"),             // the Hevy key (owner only)
    state: p("state.json"),           // the last run, the events cursor, problems and what was said
    records: p("records.json"),       // one record per workout: its row, what the add-on last wrote, the cells that are the person's
    log: p("workouts.log"),           // one line per run and per change, workouts by date and id only
    lock: p("run.lock"),
    serviceEnv: p("service.env"),     // extra settings for the scheduled run (another notebook address, a proxy)
  };
}

// Where the program is copied to, and where its command goes.
export function appDir({ env = process.env, platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  if (env.GODSPEED_WORKOUTS_APP) return path.resolve(env.GODSPEED_WORKOUTS_APP);
  if (platform === "linux" && root) return "/usr/local/lib/godspeed-workouts";
  return path.join(home, ".godspeed", "addons", NAME);
}

export function binDir({ platform = process.platform, root = isRoot(), home = os.homedir() } = {}) {
  if (platform === "linux" && root) return "/usr/local/bin";
  return path.join(home, ".godspeed", "bin");
}

function homeOfUser(user) {
  try {
    const line = fs.readFileSync("/etc/passwd", "utf8").split("\n").find((l) => l.split(":")[0] === user);
    return line ? line.split(":")[5] : null;
  } catch { return null; }
}

// The mission control folder (for the coaching talks and the assistant's Telegram bot): the
// argument, the environment, the device file Godspeed writes, the folder this runs in (or one above
// it), the default folders. A folder counts when it holds AGENTS.md or Godspeed's model launcher.
export function findMissionControl({ arg, cwd = process.cwd(), userHome = os.homedir(), env = process.env, homeOf = homeOfUser } = {}) {
  const isMc = (d) => !!d && (fs.existsSync(path.join(d, "AGENTS.md")) || fs.existsSync(path.join(d, ".godspeed", "model.mjs")));
  for (const c of [arg, env.GODSPEED_WORKSPACE, env.GODSPEED_ROOT, env.GODSPEED_DIR]) {
    if (c) return isMc(path.resolve(c)) ? path.resolve(c) : null;
  }
  try {
    const m = fs.readFileSync(path.join(userHome, ".godspeed", "device.env"), "utf8").match(/^\s*GODSPEED_DIR=(.+)$/m);
    if (m) {
      const d = m[1].trim().replace(/^["']|["']$/g, "");
      if (isMc(d)) return path.resolve(d);
    }
  } catch { /* no device file */ }
  let d = path.resolve(cwd);
  for (;;) {
    if (isMc(d)) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  const sudoHome = env.SUDO_USER && env.SUDO_USER !== "root" ? homeOf(env.SUDO_USER) : null;
  for (const home of [userHome, sudoHome].filter(Boolean)) {
    for (const name of ["godspeed-v2", "godspeed"]) {
      const dflt = path.join(home, name);
      if (isMc(dflt)) return dflt;
    }
  }
  return null;
}
