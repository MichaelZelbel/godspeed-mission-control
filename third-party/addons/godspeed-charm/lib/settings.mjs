// The few choices the Charm Challenge has. One JSON file in mission control, so it travels to every
// machine and a person can read it.
import fs from "node:fs";
import path from "node:path";

export const DEFAULTS = Object.freeze({
  version: 1,
  timezone: "UTC",          // setup writes the real one; the server runs on UTC
  language: "en",           // en | de: the language the replies come in
});

const CHOICES = { language: ["en", "de"] };
const SETTABLE = ["timezone", "language"];

export const settingsFile = (mcDir) => path.join(mcDir, "routines", "charm", "settings.json");

// A missing file means the defaults. A file that exists but cannot be read or understood throws:
// the count's day boundary is the timezone in it, so guessing UTC would file events on the wrong
// day, and the context block (which must print nothing when it cannot trust the record) needs
// to hear about it.
export function loadSettings(mcDir) {
  let text;
  try { text = fs.readFileSync(settingsFile(mcDir), "utf8"); } catch (error) {
    if (error.code === "ENOENT") return { ...DEFAULTS };
    throw new Error(`The settings file ${settingsFile(mcDir)} cannot be read: ${error.message}`);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch (error) {
    throw new Error(`The settings file ${settingsFile(mcDir)} is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`The settings file ${settingsFile(mcDir)} must hold one JSON object.`);
  return { ...DEFAULTS, ...parsed };
}

export function saveSettings(mcDir, s) {
  fs.mkdirSync(path.dirname(settingsFile(mcDir)), { recursive: true });
  fs.writeFileSync(settingsFile(mcDir), JSON.stringify(s, null, 2) + "\n");
}

export function validateSettings(s) {
  const out = [];
  for (const [k, c] of Object.entries(CHOICES)) if (!c.includes(s[k])) out.push(`${k} can be ${c.join(" or ")}.`);
  try { new Intl.DateTimeFormat("en", { timeZone: s.timezone }); } catch { out.push(`"${s.timezone}" is not a time zone this computer knows, for example Europe/Berlin.`); }
  return out;
}

export function setSetting(mcDir, key, raw) {
  if (!SETTABLE.includes(key)) throw new Error(`There is no setting called "${key}". It can be ${SETTABLE.join(" or ")}.`);
  const s = { ...loadSettings(mcDir), [key]: String(raw).trim() };
  const problems = validateSettings(s);
  if (problems.length) throw new Error(problems.join(" "));
  saveSettings(mcDir, s);
  return s;
}
