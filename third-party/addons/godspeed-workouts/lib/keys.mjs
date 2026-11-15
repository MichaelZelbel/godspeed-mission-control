// The Hevy key: one setting, kept in hevy.json in the private state folder (readable by its owner
// only), never in code, the settings file, a log, a message or a command line. It comes in through
// HEVY_API_KEY in the environment, standard input, or a hidden prompt.
import fs from "node:fs";
import { readJson, writeJson } from "./files.mjs";

// Hevy's keys are UUIDs; anything else is refused before it is kept, so a pasted sentence or a
// line break never becomes the key.
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function cleanKey(raw) {
  const k = String(raw ?? "").trim();
  if (!KEY.test(k)) throw new Error("That is not a Hevy API key: a key looks like 8-4-4-4-12 letters and digits, as Hevy shows it at https://hevy.com/settings?developer");
  return k.toLowerCase();
}

export function readKey(paths) {
  const k = readJson(paths.hevy, null)?.api_key;
  return typeof k === "string" && KEY.test(k) ? k : null;
}

export function saveKey(paths, key, { now = new Date() } = {}) {
  writeJson(paths.hevy, { api_key: cleanKey(key), saved_at: now.toISOString() });
}

export const hasKeyFile = (paths) => fs.existsSync(paths.hevy);

// The key from the environment, else standard input when it is not a terminal (piped), else a
// prompt that does not show what is typed. null when there is none.
export async function keyFromOutside({ env = process.env, stdin = process.stdin, stdout = process.stdout, ask = true } = {}) {
  if (env.HEVY_API_KEY) return env.HEVY_API_KEY;
  if (!stdin.isTTY) {
    if (stdin.readableEnded || stdin.destroyed) return null;
    const chunks = [];
    const read = new Promise((resolve) => {
      stdin.on("data", (d) => chunks.push(d));
      stdin.on("end", resolve);
      stdin.on("error", resolve);
    });
    await Promise.race([read, new Promise((r) => setTimeout(r, 2000))]);
    stdin.pause();
    const text = Buffer.concat(chunks).toString("utf8").trim();
    return text || null;
  }
  if (!ask) return null;
  stdout.write("Your Hevy API key (from https://hevy.com/settings?developer; it is not shown as you type): ");
  return new Promise((resolve) => {
    let typed = "";
    const done = (value) => { stdin.setRawMode?.(false); stdin.pause(); stdin.removeListener("data", onData); stdout.write("\n"); resolve(value); };
    const onData = (buf) => {
      for (const ch of buf.toString("utf8")) {
        if (ch === "\r" || ch === "\n") return done(typed.trim() || null);
        if (ch === "\u0003") return done(null);
        if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
        else typed += ch;
      }
    };
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}
