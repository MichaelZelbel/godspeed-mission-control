// The person's choices about how much the journal speaks. One JSON file in mission control, so it
// travels to every machine with git and a person can read it. Changed by saying so to the
// assistant, which runs `godspeed-journal config set`.
import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = Object.freeze({
  version: 1,
  language: "en",                 // en | de: the fixed messages (nudge, evening, weekly)
  timezone: "UTC",                // setup writes the real one; the server runs on UTC
  feedback: "check",              // off: only "Saved." | check: done question + done check | coach: check + one reflective question when a task closes
  length: "short",                // short | long
  ask_done_definition: true,
  prefix_required: true,          // true: only messages addressed to the journal are entries
  nudge: { enabled: false, after_minutes: 180, max_per_task: 1, quiet_hours: "21:00-08:00" },
  evening: { enabled: false, at: "18:30" },
  weekly: { enabled: false, day: "sun", at: "18:00" },
  evidence: { script: "" },       // a program that prints the posts that went out (README, "Already on record"); a path inside mission control
  tick_host: "",                  // the one machine that sends nudges and the evening list
  git_sync: "auto",               // auto: commit and push | commit: commit only | off
});

const CHOICES = {
  language: ["en", "de"], feedback: ["off", "check", "coach"], length: ["short", "long"],
  git_sync: ["auto", "commit", "off"], "weekly.day": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
};
const BOOLEAN_WORDS = { true: true, on: true, yes: true, false: false, off: false, no: false };
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const settingsFile = (mcDir) => path.join(mcDir, "routines", "journal", "settings.json");

function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? merge(base[k], v) : v;
  }
  return out;
}

export function loadSettings(mcDir) {
  try { return merge(DEFAULTS, JSON.parse(fs.readFileSync(settingsFile(mcDir), "utf8"))); }
  catch { return merge(DEFAULTS, {}); }
}

export function saveSettings(mcDir, s) {
  fs.mkdirSync(path.dirname(settingsFile(mcDir)), { recursive: true });
  fs.writeFileSync(settingsFile(mcDir), JSON.stringify(s, null, 2) + "\n");
}

function lookup(obj, key) { return key.split(".").reduce((o, k) => (o && k in o ? o[k] : undefined), obj); }

function problemWith(key, value) {
  if (CHOICES[key] && !CHOICES[key].includes(value)) {
    const c = CHOICES[key];
    return `${key} can be ${c.slice(0, -1).join(", ")} or ${c.at(-1)}.`;
  }
  if (typeof lookup(DEFAULTS, key) === "boolean" && typeof value !== "boolean") return `${key} is on or off.`;
  if (key.endsWith(".at") && !HM.test(value)) return `${key} is a time written HH:MM, for example 18:30.`;
  if (key === "nudge.quiet_hours" && value !== "" && !/^\d\d:\d\d-\d\d:\d\d$/.test(value)) return "quiet hours are written HH:MM-HH:MM, for example 21:00-08:00, or empty for none.";
  if (key === "nudge.after_minutes" && !(Number.isInteger(value) && value >= 15)) return "nudge.after_minutes is a whole number of minutes, at least 15.";
  if (key === "nudge.max_per_task" && !(Number.isInteger(value) && value >= 0 && value <= 3)) return "nudge.max_per_task is 0 to 3.";
  if (key === "timezone") {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); } catch { return `"${value}" is not a time zone this computer knows, for example Europe/Berlin.`; }
  }
  return null;
}

export function validateSettings(s) {
  const out = [];
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) walk(v, key);
      else { const p = problemWith(key, v); if (p) out.push(p); }
    }
  };
  walk(s, "");
  return out;
}

export function setSetting(mcDir, key, raw) {
  const current = lookup(DEFAULTS, key);
  if (current === undefined || (typeof current === "object" && current !== null)) throw new Error(`There is no setting called "${key}". Run \`godspeed-journal config show\` to see them.`);
  let value = String(raw).trim();
  if (typeof current === "boolean") value = BOOLEAN_WORDS[value.toLowerCase()] ?? value;
  else if (typeof current === "number") value = /^-?\d+$/.test(value) ? Number(value) : value;
  const p = problemWith(key, value);
  if (p) throw new Error(p);
  const s = loadSettings(mcDir);
  const parts = key.split(".");
  let o = s;
  for (const k of parts.slice(0, -1)) o = o[k];
  o[parts.at(-1)] = value;
  saveSettings(mcDir, s);
  return s;
}
