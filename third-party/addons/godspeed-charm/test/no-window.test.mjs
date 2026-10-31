// Every program this app starts must pass windowsHide, or on Windows a console window flashes in
// the person's face (the headache add-on's lesson, 2026-09-29).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every spawned program is hidden on Windows", () => {
  for (const dir of ["lib", "bin"]) {
    if (!fs.existsSync(path.join(root, dir))) continue;
    for (const name of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith(".mjs"))) {
      const text = fs.readFileSync(path.join(root, dir, name), "utf8");
      for (const m of text.matchAll(/\b(spawnSync|spawn|execFileSync|execFile|execSync)\(/g)) {
        const call = text.slice(m.index, text.indexOf(";", m.index) + 1);
        assert.match(call, /windowsHide: true/, `${dir}/${name}: ${call.slice(0, 120)}`);
      }
    }
  }
});
