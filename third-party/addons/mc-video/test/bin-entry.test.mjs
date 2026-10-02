// The entry point the manifest declares must exist, and the old name must still answer.
//
// On 2026-09-22 the rename rewrote package.json, lib.mjs and the CI workflow to say
// bin/mc-video.mjs and left the file itself at bin/mc-video.mjs, so the command, the launcher
// `mc-video setup` writes, and CI all pointed at nothing. Never one name, and never two copies:
// the old name is a shim that loads the real file, because two copies drift apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

test("every command package.json declares points at a file", () => {
  for (const [cmd, rel] of Object.entries(pkg.bin)) {
    assert.ok(existsSync(path.join(ROOT, rel)), `${cmd} -> ${rel} does not exist`);
  }
});
