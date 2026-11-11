// The newest change of an area's RHYTHM, read from the mission control's git history (#359). On
// 1 November 2026 the health talk went from "weekly sunday" to "every 2 weeks sunday" without anyone
// asking, and the Sunday that dropped out was prepared by nothing. The coach commits every
// `area set` ("coach: area <slug> RHYTHM", lib/sync.mjs), so the history already says when the rhythm
// changed and what it was before; an area.md edited by hand shows there too once committed, and an
// edit not committed yet counts as a change made now. Without git, or with git_sync off and the
// edit committed by nothing, there is no change to find: this returns null and nothing is bridged.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { parseDoc } from "./header.mjs";
import { now as clockNow } from "./clock.mjs";

const git = (mcDir, args) => {
  const r = spawnSync("git", ["-C", mcDir, ...args], { encoding: "utf8", timeout: 15000, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
};
const rhythmIn = (text) => String(parseDoc(text).head.RHYTHM || "").trim();
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// { from, to, changed (ISO time), commit (short hash, or "not committed"), subject }, or null when
// git knows of no change.
export function lastRhythmChange(mcDir, area, now = clockNow()) {
  // "./" makes the path relative to mcDir, also when mcDir is a folder inside a larger repository.
  const rel = "./" + path.relative(mcDir, area.file).replace(/\\/g, "/");
  const head = git(mcDir, ["show", `HEAD:${rel}`]);
  if (head === null) return null;
  const to = area.rhythmText.trim();
  const committed = rhythmIn(head);
  if (!same(committed, to)) return { from: committed, to, changed: iso(now), commit: "not committed", subject: "" };
  const log = git(mcDir, ["log", "-n", "1", "--format=%H%x09%cI%x09%s", "-G^RHYTHM:", "--", rel]);
  const [hash, changed, subject = ""] = String(log || "").trim().split("\t");
  if (!hash || !changed) return null;
  const before = git(mcDir, ["show", `${hash}^:${rel}`]);
  if (before === null) return null;
  const from = rhythmIn(before);
  if (!from || same(from, to)) return null;
  return { from, to, changed: iso(new Date(changed)), commit: hash.slice(0, 7), subject };
}
