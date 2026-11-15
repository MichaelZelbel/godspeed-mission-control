// One run at a time: the hourly run and a `godspeed-workouts run` typed by hand share this lock, so
// two runs never write the same workout at once. A lock whose process is gone (a crash, a reboot)
// or that is older than two hours is taken over.
import fs from "node:fs";
import { ensurePrivateDir } from "./files.mjs";

const STALE_MS = 2 * 3600 * 1000;

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

export function acquire(paths) {
  ensurePrivateDir(paths.root);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(paths.lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
      return { release: () => { try { if (JSON.parse(fs.readFileSync(paths.lock, "utf8")).pid === process.pid) fs.rmSync(paths.lock, { force: true }); } catch { /* gone */ } } };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let held = null;
      try { held = JSON.parse(fs.readFileSync(paths.lock, "utf8")); } catch { /* half written: stale */ }
      const stale = !held || !alive(held.pid) || Date.now() - new Date(held.at).getTime() > STALE_MS;
      if (!stale) return null;
      fs.rmSync(paths.lock, { force: true });
    }
  }
  return null;
}

// The lock, waiting up to `ms` for a run that holds it to end, then null.
export async function acquireWithin(paths, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const lock = acquire(paths);
    if (lock || Date.now() >= until) return lock;
    await new Promise((r) => setTimeout(r, Math.min(500, Math.max(50, until - Date.now()))));
  }
}
