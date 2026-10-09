// The person's choices for the coach as a whole. One JSON file in mission control, so it travels to
// every machine with git. What each area does lives in that area's own area.md.
import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = Object.freeze({
  version: 1,
  timezone: "UTC",               // setup (or the notebook's first goal) writes the real one
  language: "en",                // en | de: the fixed messages (habit check, follow-up)
  habit_check_at: "21:00",       // the one evening question about habits not tracked yet
  max_habits: 5,                 // active habits across all areas
  daily_table: "",               // a daily CSV (one row per date) that can tick habits by itself
  tick_host: "",                 // the one machine that opens talks and sends the habit check
  git_sync: "auto",              // auto: commit and push | commit: commit only | off
  // messenger: a talk's opening is sent to the phone. chat: there is no messenger, so a talk that is
  // due is opened anyway and waits; the [godspeed-coach] block shows it the next time they write.
  talk_delivery: "messenger",
});

const CHOICES = { language: ["en", "de"], git_sync: ["auto", "commit", "off"], talk_delivery: ["messenger", "chat"] };
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const settingsFile = (mcDir) => path.join(mcDir, "coach", "settings.json");

export function loadSettings(mcDir) {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(mcDir), "utf8")) }; }
  catch { return { ...DEFAULTS }; }
}

export function saveSettings(mcDir, s) {
  fs.mkdirSync(path.dirname(settingsFile(mcDir)), { recursive: true });
  fs.writeFileSync(settingsFile(mcDir), JSON.stringify(s, null, 2) + "\n");
}

function problemWith(key, value) {
  if (CHOICES[key] && !CHOICES[key].includes(value)) return `${key} can be ${CHOICES[key].join(" or ")}.`;
  if (key === "habit_check_at" && !HM.test(value)) return "habit_check_at is a time written HH:MM, for example 21:00.";
  if (key === "max_habits" && !(Number.isInteger(value) && value >= 1 && value <= 12)) return "max_habits is a whole number from 1 to 12.";
  if (key === "timezone") {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); } catch { return `"${value}" is not a time zone this computer knows, for example Europe/Berlin.`; }
  }
  return null;
}

export function validateSettings(s) {
  return Object.entries(s).map(([k, v]) => problemWith(k, v)).filter(Boolean);
}

export function setSetting(mcDir, key, raw) {
  if (!(key in DEFAULTS) || key === "version") throw new Error(`There is no setting called "${key}". Run \`godspeed-coach config show\` to see them.`);
  let value = String(raw).trim();
  if (typeof DEFAULTS[key] === "number") value = /^-?\d+$/.test(value) ? Number(value) : value;
  const p = problemWith(key, value);
  if (p) throw new Error(p);
  const s = loadSettings(mcDir);
  s[key] = value;
  saveSettings(mcDir, s);
  return s;
}
