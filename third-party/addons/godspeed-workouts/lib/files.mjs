// Private files. The state folder holds the person's Hevy key and what they trained, so every file
// is readable by its owner only (600) and every folder it makes is 700. A file is written under a
// temporary name and renamed into place, so a crash never leaves half a file.
import fs from "node:fs";
import path from "node:path";

export function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows keeps its own permissions */ }
  return dir;
}

export function writePrivate(file, text) {
  ensurePrivateDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* Windows */ }
  fs.renameSync(tmp, file);
}

export function writeJson(file, data) {
  writePrivate(file, JSON.stringify(data, null, 1) + "\n");
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

// One line in the log; a log over 1 MB keeps its newer half.
export function appendLog(file, line) {
  ensurePrivateDir(path.dirname(file));
  try {
    if (fs.statSync(file).size > 1024 * 1024) {
      const text = fs.readFileSync(file, "utf8");
      writePrivate(file, text.slice(text.indexOf("\n", text.length / 2) + 1));
    }
  } catch { /* no log yet */ }
  fs.appendFileSync(file, line.endsWith("\n") ? line : `${line}\n`, { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
}
