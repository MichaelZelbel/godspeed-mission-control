// The newest change of an area's RHYTHM, read from the mission control's git history (#359). On
// 1 November 2026 the health talk went from "weekly sunday" to "every 2 weeks sunday" without anyone
// asking, and the Sunday that dropped out was prepared by nothing. The coach commits every
// `area set` ("coach: area <slug> RHYTHM", lib/sync.mjs), so the history already says when the rhythm
// changed and what it was before; an area.md edited by hand shows there too once committed. An edit
// not committed yet (git_sync off commits nothing) is dated by area.md's last write, so the day it
// dropped is bridged once, not every night. That edit is committed later by whichever coach save
// comes next (the sync commits the whole coach folder), often the talk they open on the dropped day
// itself: a commit that is not this area's own `area set` of RHYTHM is therefore dated by area.md's
// last write when that is earlier, so the change keeps the day it was made and the dropped day stays
// dropped. Without git there is no change to find: this returns null and nothing is bridged.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseDoc } from "./header.mjs";

const git = (mcDir, args) => {
  const r = spawnSync("git", ["-C", mcDir, ...args], { encoding: "utf8", timeout: 15000, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
};
const rhythmIn = (text) => String(parseDoc(text).head.RHYTHM || "").trim();
const iso = (d) => d.toISOString().replace(/\.\d+Z$/, "Z");
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// { from, to, changed (ISO time), commit (short hash, or "not committed"), subject }, or null when
// git knows of no change.
export function lastRhythmChange(mcDir, area) {
  // "./" makes the path relative to mcDir, also when mcDir is a folder inside a larger repository.
  const rel = "./" + path.relative(mcDir, area.file).replace(/\\/g, "/");
  const head = git(mcDir, ["show", `HEAD:${rel}`]);
  if (head === null) return null;
  const to = area.rhythmText.trim();
  const committed = rhythmIn(head);
  if (!same(committed, to)) return { from: committed, to, changed: iso(fs.statSync(area.file).mtime), commit: "not committed", subject: "" };
  const log = git(mcDir, ["log", "-n", "1", "--format=%H%x09%cI%x09%s", "-G^RHYTHM:", "--", rel]);
  const [hash, changed, subject = ""] = String(log || "").trim().split("\t");
  if (!hash || !changed) return null;
  const before = git(mcDir, ["show", `${hash}^:${rel}`]);
  if (before === null) return null;
  const from = rhythmIn(before);
  if (!from || same(from, to)) return null;
  let at = new Date(changed);
  if (subject !== `coach: area ${area.slug} RHYTHM`) {
    // Swept into another commit: the edit was on disk by area.md's last write, if that came first.
    const written = fs.statSync(area.file).mtime;
    if (written.getTime() < at.getTime()) at = written;
  }
  return { from, to, changed: iso(at), commit: hash.slice(0, 7), subject };
}
