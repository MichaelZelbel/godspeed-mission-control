import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tmpMission(files = {}) {
  const mc = fs.mkdtempSync(path.join(os.tmpdir(), "coach-"));
  fs.writeFileSync(path.join(mc, "AGENTS.md"), "");
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(mc, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
  }
  return mc;
}

export const area = (over = {}) => {
  const h = { AREA: "health", TITLE: "Health and fitness", RHYTHM: "weekly sunday", TIME: "19:00", STARTS: "2026-10-04", STATUS: "on", STYLE: "review", TONE: "gentle", SERVES: "age-healthy, six-pack", ...over };
  return Object.entries(h).map(([k, v]) => `${k}: ${v}`).join("\n") + "\nLIMIT: never diagnose\n\n## Preparation\nRead the table.\n";
};

export const S = { timezone: "Europe/Berlin", language: "en", habit_check_at: "21:00", max_habits: 5, daily_table: "", tick_host: "", git_sync: "off" };
