// The turn marker: the conversation a command runs in, learned without the model's help.
// Each turn the person's message starts in a conversation leaves one small file,
// .godspeed/charm-turns/<platform>_<session>.json, written by `context` (which the Hermes plugin and
// the Claude Code hook run before every message). A command given no --conversation takes the one
// marker written in the last ten minutes; with none or with several it never guesses. A turn the
// Godspeed notebook runs names its conversation in GODSPEED_CHARM_CONVERSATION and leaves no marker.
import fs from "node:fs";
import path from "node:path";

export const FRESH_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const dirOf = (mcDir) => path.join(mcDir, ".godspeed", "charm-turns");

export function writeTurn(mcDir, conversation, at) {
  const dir = dirOf(mcDir);
  fs.mkdirSync(dir, { recursive: true });
  const name = conversation.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 150);
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ conversation, when: at.toISOString() }) + "\n");
  // Markers older than a day are of no use any more.
  for (const f of fs.readdirSync(dir)) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      if (at.getTime() - Date.parse(m.when) > DAY_MS) fs.rmSync(path.join(dir, f), { force: true });
    } catch { /* leave what cannot be read */ }
  }
}

// {conversation} for exactly one fresh marker, else {count} (0, or 2 and more).
export function currentConversation(mcDir, at) {
  const found = new Set();
  let names = [];
  try { names = fs.readdirSync(dirOf(mcDir)); } catch { /* none */ }
  for (const f of names) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dirOf(mcDir), f), "utf8"));
      const age = at.getTime() - Date.parse(m.when);
      if (typeof m.conversation === "string" && m.conversation && age >= 0 && age <= FRESH_MS) found.add(m.conversation);
    } catch { /* not a marker */ }
  }
  return found.size === 1 ? { conversation: [...found][0] } : { count: found.size };
}
