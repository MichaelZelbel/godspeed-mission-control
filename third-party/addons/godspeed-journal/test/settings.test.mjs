import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULTS, loadSettings, setSetting, validateSettings, settingsFile } from "../lib/settings.mjs";

const mcDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "hj-set-")); fs.writeFileSync(path.join(d, "AGENTS.md"), ""); return d; };

test("no file means defaults, nudges off, feedback check, evening list off", () => {
  const s = loadSettings(mcDir());
  assert.equal(s.feedback, "check"); assert.equal(s.nudge.enabled, false); assert.equal(s.nudge.after_minutes, 180);
  assert.equal(s.evening.enabled, false);
});

test("a file overrides only what it names", () => {
  const h = mcDir();
  fs.mkdirSync(path.join(h, "routines", "journal"), { recursive: true });
  fs.writeFileSync(settingsFile(h), JSON.stringify({ nudge: { enabled: true } }));
  const s = loadSettings(h);
  assert.equal(s.nudge.enabled, true); assert.equal(s.nudge.after_minutes, 180); assert.equal(s.length, "short");
});

test("a broken file falls back to defaults instead of crashing", () => {
  const h = mcDir(); fs.mkdirSync(path.join(h, "routines", "journal"), { recursive: true }); fs.writeFileSync(settingsFile(h), "{nope");
  assert.equal(loadSettings(h).feedback, "check");
});

test("config set parses booleans and numbers and writes the file", () => {
  const h = mcDir();
  setSetting(h, "nudge.enabled", "true"); setSetting(h, "nudge.after_minutes", "300"); setSetting(h, "length", "long");
  const onDisk = JSON.parse(fs.readFileSync(settingsFile(h), "utf8"));
  assert.equal(onDisk.nudge.enabled, true); assert.equal(onDisk.nudge.after_minutes, 300); assert.equal(onDisk.length, "long");
});

test("config set refuses unknown keys and bad values with a sentence", () => {
  const h = mcDir();
  assert.throws(() => setSetting(h, "nudges", "on"), /no setting called "nudges"/);
  assert.throws(() => setSetting(h, "feedback", "loud"), /feedback can be off, check or coach/);
  assert.throws(() => setSetting(h, "evening.at", "7pm"), /HH:MM/);
  assert.throws(() => setSetting(h, "timezone", "Mars/Olympus"), /time zone/);
  assert.throws(() => setSetting(h, "nudge.after_minutes", "5"), /at least 15/);
});

test("validateSettings reports problems in a hand-edited file", () => {
  assert.deepEqual(validateSettings(DEFAULTS), []);
  assert.equal(validateSettings({ ...DEFAULTS, length: "medium" }).length, 1);
});
