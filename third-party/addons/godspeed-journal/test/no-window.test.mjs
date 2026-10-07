// Every program this app starts must pass windowsHide. The background sync runs with no console,
// so on Windows any child started without it gets a visible console window of its own: a
// terminal flashing in the person's face after each entry (2026-09-29, a node started only to
// wait 1.5 seconds before retrying a commit).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every spawned program is hidden on Windows", () => {
  for (const dir of ["lib", "bin"]) {
    for (const name of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith(".mjs"))) {
      const text = fs.readFileSync(path.join(root, dir, name), "utf8");
      for (const m of text.matchAll(/\b(spawnSync|spawn|execFileSync|execFile|execSync)\(/g)) {
        const call = text.slice(m.index, text.indexOf(";", m.index) + 1);
        assert.match(call, /windowsHide: true/, `${dir}/${name}: ${call.slice(0, 120)}`);
      }
    }
  }
});
