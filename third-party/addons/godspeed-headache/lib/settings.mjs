// The few choices the headache tracker has. One JSON file in mission control, so it travels to every
// machine with git and a person can read it.
import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = Object.freeze({
  version: 1,
  timezone: "UTC",          // setup writes the real one; the server runs on UTC
  language: "en",           // en | de: the language the recipe answers in
  overuse_days: 10,         // painkiller days in 30 at which the pattern report warns
  daily_table: "",          // optional CSV with one row per day and a date column, relative to mission control
  daily_columns: [],        // numeric columns of that table to compare on headache and free days
  git_sync: "auto",         // auto: commit and push | commit: commit only | off
});

const CHOICES = { language: ["en", "de"], git_sync: ["auto", "commit", "off"] };

export const settingsFile = (mcDir) => path.join(mcDir, "routines", "headache", "settings.json");

export function loadSettings(mcDir) {
  let s = { ...DEFAULTS };
  try { s = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(mcDir), "utf8")) }; } catch {}
  if (s.daily_table && mcDir && !path.isAbsolute(s.daily_table)) s.daily_table = path.join(mcDir, s.daily_table);
  return s;
}

export function saveSettings(mcDir, s) {
  fs.mkdirSync(path.dirname(settingsFile(mcDir)), { recursive: true });
  fs.writeFileSync(settingsFile(mcDir), JSON.stringify(s, null, 2) + "\n");
}

export function validateSettings(s) {
  const out = [];
  for (const [k, c] of Object.entries(CHOICES)) if (!c.includes(s[k])) out.push(`${k} can be ${c.join(" or ")}.`);
  try { new Intl.DateTimeFormat("en", { timeZone: s.timezone }); } catch { out.push(`"${s.timezone}" is not a time zone this computer knows, for example Europe/Berlin.`); }
  if (!(Number.isInteger(s.overuse_days) && s.overuse_days > 0 && s.overuse_days <= 30)) out.push("overuse_days is a whole number from 1 to 30.");
  if (!Array.isArray(s.daily_columns)) out.push("daily_columns is a list of column names.");
  return out;
}

export function setSetting(mcDir, key, raw) {
  if (!(key in DEFAULTS) || key === "version") throw new Error(`There is no setting called "${key}". Run \`godspeed-headache config show\` to see them.`);
  let value = String(raw).trim();
  if (typeof DEFAULTS[key] === "number") value = Number(value);
  if (Array.isArray(DEFAULTS[key])) value = value ? value.split(",").map((x) => x.trim()).filter(Boolean) : [];
  let s = {};
  try { s = JSON.parse(fs.readFileSync(settingsFile(mcDir), "utf8")); } catch { s = { ...DEFAULTS }; }
  s[key] = value;
  const problems = validateSettings({ ...DEFAULTS, ...s });
  if (problems.length) throw new Error(problems.join(" "));
  saveSettings(mcDir, s);
  return s;
}
