// The slip question the program asks: the Hermes plugin judges the person's message while the model
// works and, on the reply, records the question (or a plain yes or no) and puts it at the end.
// Python drives the plugin (test/telegram_driver.py) with the real add-on command on a throwaway
// mission control. Skipped when this computer has no python.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { T } from "../lib/texts.mjs";
import { readEvents } from "../lib/record.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.join(HERE, "..", "hermes", "plugin", "godspeed-charm");
const BIN = path.join(HERE, "..", "bin", "godspeed-charm.mjs");
const DRIVER = path.join(HERE, "telegram_driver.py");
const PY = ["python3", "python"].find((p) => { const r = spawnSync(p, ["-c", "print(1)"], { encoding: "utf8" }); return r.status === 0 && r.stdout.trim() === "1"; });
const skip = PY ? false : "no python on this computer";

const Q = T.en.question();
const QDE = T.de.question();
const VENT = "This caption file is garbage again. Why do you always hand me this rubbish?";
const at = (day, hour = 8) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`).toISOString();

function mission() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charm-judged-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
  fs.mkdirSync(path.join(dir, "notebook"));
  fs.mkdirSync(path.join(dir, ".godspeed"));
  fs.mkdirSync(path.join(dir, "routines", "charm"), { recursive: true });
  fs.writeFileSync(path.join(dir, "routines", "charm", "settings.json"), JSON.stringify({ version: 1, timezone: "Europe/Berlin", language: "en" }) + "\n");
  const start = spawnSync(process.execPath, [BIN, "start"], { encoding: "utf8", env: { ...process.env, GODSPEED_CHARM_DIR: dir, GODSPEED_CHARM_NOW: at("2026-10-21"), GODSPEED_SCHEDULED_RUN: "" } });
  assert.equal(start.status, 0, start.stderr);
  return dir;
}
const gone = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const kinds = (dir) => readEvents(dir).map((e) => e.kind);

// A stand-in for the add-on's command that answers `judge` as FIXTURE_JUDGE says and leaves every
// other command to the real one.
const STUB = `
import { spawnSync } from "node:child_process";
const [command, ...rest] = process.argv.slice(2);
const mode = process.env.FIXTURE_JUDGE;
if (command === "judge" && mode && !(mode === "slow" && rest.includes("--no-model"))) {
  if (mode === "slow") await new Promise((r) => setTimeout(r, 30000));
  console.log(JSON.stringify({ ok: true, verdict: mode, source: "rule", why: "stub", language: "en" }));
} else {
  const r = spawnSync(process.execPath, [process.env.REAL_BIN, command, ...rest], { stdio: "inherit" });
  process.exitCode = r.status;
}
`;

function drive(dir, steps, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "charm-home-"));
  const stub = path.join(home, "stub.mjs");
  fs.writeFileSync(stub, STUB);
  if (env.FIXTURE_MODEL) {
    fs.mkdirSync(path.join(home, "bin"));
    fs.writeFileSync(path.join(home, "bin", "godspeed-model"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(HERE, "fixtures", "model-command.mjs")}"\n`, { mode: 0o755 });
  }
  try {
    const r = spawnSync(PY, [DRIVER, PLUGIN], {
      input: JSON.stringify({ steps }), encoding: "utf8", timeout: 180000, windowsHide: true,
      env: {
        ...process.env, GODSPEED_CHARM_DIR: dir, GODSPEED_CHARM_NOW: at("2026-10-22", 9), GODSPEED_SCHEDULED_RUN: "",
        GODSPEED_CHARM_LAUNCHER: "", GODSPEED_NODE: process.execPath, GODSPEED_CHARM_SCRIPT: env.FIXTURE_JUDGE ? stub : BIN,
        REAL_BIN: BIN, HERMES_HOME: home, TELEGRAM_ALLOWED_USERS: "31415", GODSPEED_CHARM_BUTTON_DELAY: "0",
        PYTHONDONTWRITEBYTECODE: "1", ...env,
      },
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    out.log = (() => { try { return fs.readFileSync(path.join(home, "logs", "godspeed-charm.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch { return []; } })();
    return out;
  } finally { gone(home); }
}
const register = { do: "register", telegram: false };
const pre = (message, extra = {}) => ({ do: "pre", session: "s-1", platform: "api_server", message, ...extra });
const reply = (text, extra = {}) => ({ do: "reply", session: "s-1", turn: "t-1", platform: "api_server", text, ...extra });

test("a vent in a notebook chat ends with the exact question, once, also when the transformer runs twice", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), reply("Here is the file."), reply("Here is the file.")]);
    assert.equal(out.results[2].text, `Here is the file.\n\n${Q}`);
    assert.equal(out.results[3].text, out.results[2].text);
    assert.deepEqual(kinds(dir), ["start", "asked"]);
    assert.equal(readEvents(dir)[1].conversation, "api_server:s-1");
    assert.equal(readEvents(dir)[1].words, VENT);
    assert.equal(out.log.length, 1);
    assert.deepEqual([out.log[0].verdict, out.log[0].source, out.log[0].conversation], ["ask", "words", "api_server:s-1"]);
    assert.ok(!JSON.stringify(out.log).includes("garbage"));
  } finally { gone(dir); }
});

test("a German vent gets the German question", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre("Das ist schon wieder Müll. Warum gibst du mir immer so einen Schrott?"), reply("Hier ist die Datei.")]);
    assert.equal(out.results[2].text, `Hier ist die Datei.\n\n${QDE}`);
  } finally { gone(dir); }
});

test("a firm correction, a command and a scheduled turn leave the reply alone and record nothing", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [
      register,
      pre("The deadline is wrong. Check the client's message and fix the draft."), reply("Fixed."),
      pre(VENT, { platform: "cron", session: "s-2" }), reply("Done.", { platform: "cron" }),
    ]);
    assert.equal(out.results[2].text, null);
    assert.equal(out.results[4].text, null);
    assert.equal(out.results[3].outs.length, 1);
    assert.deepEqual(kinds(dir), ["start"]);
  } finally { gone(dir); }
});

test("a refused asked adds nothing", { skip }, () => {
  const dir = mission();
  try {
    assert.equal(spawnSync(process.execPath, [BIN, "slip", "--words", "charm slip"], { encoding: "utf8", env: { ...process.env, GODSPEED_CHARM_DIR: dir, GODSPEED_CHARM_NOW: at("2026-10-22", 9) } }).status, 0);
    const out = drive(dir, [register, pre(VENT), reply("Here.")], { FIXTURE_JUDGE: "ask" });
    assert.equal(out.results[2].text, null);
    assert.deepEqual(kinds(dir), ["start", "reset"]);
  } finally { gone(dir); }
});

test("a judgement that does not finish in time falls back to the word check", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), reply("Here.")], { FIXTURE_JUDGE: "slow", GODSPEED_CHARM_JUDGE_SECONDS: "1" });
    assert.equal(out.results[2].text, `Here.\n\n${Q}`);
  } finally { gone(dir); }
});

test("a plain no the model did not record is recorded and its reply added; one it recorded adds nothing", { skip }, () => {
  for (const modelRecords of [false, true]) {
    const dir = mission();
    try {
      const run = (args, now) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, GODSPEED_CHARM_DIR: dir, GODSPEED_CHARM_NOW: now, GODSPEED_SCHEDULED_RUN: "" } });
      assert.equal(run(["asked", "--conversation", "api_server:s-1", "--words", "garbage"], at("2026-10-22", 8)).status, 0);
      const steps = [register, pre("No.")];
      if (modelRecords) assert.equal(run(["answer", "no", "--conversation", "api_server:s-1", "--words", "No."], at("2026-10-22", 9)).status, 0);
      const out = drive(dir, [...steps, reply("Alright.")]);
      assert.equal(out.results[2].text, modelRecords ? null : `Alright.\n\n${T.en.no({ daysToGo: 20 })}`);
      assert.deepEqual(kinds(dir), ["start", "asked", "kept"]);
    } finally { gone(dir); }
  }
});

test("on Telegram the program's question goes out with its buttons, and the reply keeps no question", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [{ do: "register" }, { do: "pre", session: "s-1", platform: "telegram", message: VENT }, { do: "reply", session: "s-1", turn: "t-1", text: "Here is the file." }]);
    assert.equal(out.results[2].text, null);
    const sent = out.calls.filter((c) => c.method === "send_message");
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, Q);
    assert.deepEqual(sent[0].reply_markup[0].map((b) => b.text), [T.en.buttonYes(), T.en.buttonNo()]);
    assert.deepEqual(kinds(dir), ["start", "asked"]);
  } finally { gone(dir); }
});

test("the installation's godspeed-model is asked when it is there", { skip: skip || process.platform === "win32" }, () => {
  const dir = mission();
  try {
    const firm = "The deadline is wrong. Check the client's message and fix the draft.";
    assert.equal(drive(dir, [register, pre(firm), reply("Fixed.")]).results[2].text, null);
    const out = drive(dir, [register, pre(firm), reply("Fixed.")], { FIXTURE_MODEL: "unsure" });
    assert.equal(out.results[2].text, `Fixed.\n\n${Q}`);
    assert.equal(out.log[0].source, "model");
  } finally { gone(dir); }
});
