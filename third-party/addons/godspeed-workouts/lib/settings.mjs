// The person's choices, in settings.json in the state folder. Every key has a default, so a
// settings file from an older version keeps working; `godspeed-workouts settings set` checks a value
// before it is kept. The Hevy key is not a setting here: it lives in hevy.json (keys.mjs).
import { readJson, writeJson } from "./files.mjs";

export const TELLS = ["telegram", "desktop"];
const AREA = /^[a-z][a-z0-9-]{0,39}$/;

export const TEXTS = {
  // A message, when the person can act: what it is, what happens if they do not, the next step,
  // one link. {since} is a day in words.
  key_refused: "Hevy stopped accepting the key that brings your workouts into your notebook (this also happens when Hevy Pro ends), so new workouts stay in Hevy for now. Make a new API key in Hevy's settings and send it to your assistant:",
  hevy_changed: "Hevy changed how its connection answers, so your workouts have not reached your notebook since {since}. Nothing is lost: they arrive once godspeed-workouts is updated. Ask your assistant to update it:",
  notebook_refused: "Your notebook refused a workout from Hevy ({why}), so new workouts have not reached it since {since}. Ask your assistant to look at godspeed-workouts:",
  run_failed: "godspeed-workouts stopped with an error ({why}), so new workouts have not reached your notebook since {since}. Ask your assistant to look at it:",
  deleted_mark: "(deleted in Hevy)",
};

export const DEFAULTS = {
  tracker: "Workouts",                                  // the tracker's name, when it is made
  names: ["Workouts", "Workout", "Training", "Hevy"],  // its other names ("The health talk may also look at my training")
  talks: [],                                            // coaching talks that read it, when it is made (only talks that exist)
  minute: null,                                         // the hourly run's minute, 1 to 58, picked at setup (Hevy: never at minute 0)
  second: null,
  timezone: null,                                       // null: the notebook's own time zone, else this computer's
  tell: null,                                           // where messages go: ["telegram"], ["desktop"], or null for the usual one here
  telegram_env: null,                                   // a Hermes home's .env holding the assistant's bot (found when null)
  workspace: null,                                      // the mission control folder (found at setup)
  texts: TEXTS,
};

export function loadSettings(paths) {
  const s = readJson(paths.settings, {});
  return { ...DEFAULTS, ...s, texts: { ...TEXTS, ...(s.texts || {}) } };
}

// Only what differs from a default text is written, so a later version's better wording reaches
// everyone who did not change it.
export function saveSettings(paths, settings) {
  const texts = Object.fromEntries(Object.entries(settings.texts || {}).filter(([k, v]) => TEXTS[k] !== v));
  const out = { ...settings, texts };
  if (!Object.keys(texts).length) delete out.texts;
  writeJson(paths.settings, out);
}

export function randomMinute(rand = Math.random) {
  // 1 to 58: never on the hour, and not in the minute before it either.
  return { minute: 1 + Math.floor(rand() * 58), second: Math.floor(rand() * 60) };
}

function validZone(tz) {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; }
}

// Checks and sets one setting from the command line. Returns the new settings.
export function setSetting(settings, key, raw) {
  const next = { ...settings, texts: { ...settings.texts } };
  const value = raw === undefined ? "" : String(raw).trim();
  const isNull = value === "" || value === "null";
  if (key.startsWith("texts.")) {
    const k = key.slice(6);
    if (!(k in TEXTS)) throw new Error(`texts has ${Object.keys(TEXTS).join(", ")}; not "${k}"`);
    next.texts[k] = isNull ? TEXTS[k] : value;
    return next;
  }
  switch (key) {
    case "tracker":
      if (isNull || value.length > 80) throw new Error("tracker is a name of 1 to 80 characters");
      next.tracker = value; break;
    case "names": {
      const list = value.split(",").map((x) => x.trim()).filter(Boolean);
      if (!list.length || list.some((x) => x.length > 80)) throw new Error("names is a comma-separated list of names");
      next.names = [...new Set(list)]; break;
    }
    case "talks": {
      const list = isNull ? [] : value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      if (list.some((x) => !AREA.test(x))) throw new Error("talks is a comma-separated list of coaching areas, such as health");
      next.talks = [...new Set(list)]; break;
    }
    case "minute": {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 58) throw new Error("minute is a whole number from 1 to 58 (Hevy asks for no requests at minute 0)");
      next.minute = n; break;
    }
    case "timezone":
      if (!isNull && !validZone(value)) throw new Error(`"${value}" is not a time zone, for example Europe/Berlin`);
      next.timezone = isNull ? null : value; break;
    case "tell": {
      const list = isNull ? null : value.split(",").map((x) => x.trim()).filter(Boolean);
      if (list && (!list.length || list.some((x) => !TELLS.includes(x)))) throw new Error("tell is telegram, desktop, both (telegram,desktop), or null");
      next.tell = list; break;
    }
    case "telegram_env":
      next.telegram_env = isNull ? null : value; break;
    case "workspace":
      next.workspace = isNull ? null : value; break;
    default:
      throw new Error(`There is no setting "${key}". Settings: tracker, names, talks, minute, timezone, tell, telegram_env, workspace, texts.<name>`);
  }
  return next;
}
