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
const FALLS_BACK = ["slow", "answer", ...(process.env.FIXTURE_JUDGE_SOURCE ? [mode] : [])];
if (command === "judge" && mode && !(rest.includes("--no-model") && FALLS_BACK.includes(mode))) {
  if (mode === "slow") await new Promise((r) => setTimeout(r, 30000));
  console.log(JSON.stringify({ ok: true, verdict: mode, source: process.env.FIXTURE_JUDGE_SOURCE || "rule", why: "stub", language: "en", answer: process.env.FIXTURE_JUDGE_ANSWER || undefined }));
} else {
  const r = spawnSync(process.execPath, [process.env.REAL_BIN, command, ...rest], { stdio: "inherit" });
  process.exitCode = r.status;
}
`;

function drive(dir, steps, env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "charm-home-"));
  const stub = path.join(home, "stub.mjs");
  fs.writeFileSync(stub, STUB);
  if (env.SEED_LOG) {
    fs.mkdirSync(path.join(home, "logs"));
    fs.writeFileSync(path.join(home, "logs", "godspeed-charm.log"), "x".repeat(1_000_001));
  }
  if (env.FIXTURE_MODEL) {
    fs.mkdirSync(path.join(home, "bin"));
    fs.writeFileSync(path.join(home, "bin", "godspeed-model"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(HERE, "fixtures", "model-command.mjs")}"\n`, { mode: 0o755 });
  }
  const scratch = path.join(home, "tmp");
  fs.mkdirSync(scratch);
  try {
    const r = spawnSync(PY, [DRIVER, PLUGIN], {
      input: JSON.stringify({ steps }), encoding: "utf8", timeout: 180000, windowsHide: true,
      env: {
        ...process.env, GODSPEED_CHARM_DIR: dir, GODSPEED_CHARM_NOW: at("2026-10-22", 9), GODSPEED_SCHEDULED_RUN: "",
        GODSPEED_CHARM_LAUNCHER: "", GODSPEED_NODE: process.execPath, GODSPEED_CHARM_SCRIPT: env.FIXTURE_JUDGE ? stub : BIN,
        REAL_BIN: BIN, HERMES_HOME: home, TELEGRAM_ALLOWED_USERS: "31415", GODSPEED_CHARM_BUTTON_DELAY: "0",
        PYTHONDONTWRITEBYTECODE: "1", TMPDIR: scratch, ...env,
      },
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split("\n").pop());
    out.turnFiles = fs.readdirSync(scratch).filter((n) => /^godspeed-charm-.*\.txt$/.test(n));
    out.rotated = (() => { try { return fs.readFileSync(path.join(home, "logs", "godspeed-charm.log.1"), "utf8"); } catch { return null; } })();
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

test("in a turn the Godspeed notebook runs, the plugin judges and records nothing and leaves no marker", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), reply("Here is the file.")], { GODSPEED_CHARM_CONVERSATION: "notebook:browser-owner" });
    assert.equal(out.results[2].text, null);
    assert.deepEqual(kinds(dir), ["start"]);
    assert.deepEqual(out.log, []);
    assert.equal(fs.existsSync(path.join(dir, ".godspeed", "charm-turns")), false);
  } finally { gone(dir); }
});

test("a silent reply to a judged turn still writes its one log line and ends the turn", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), reply("[SILENT]")]);
    assert.equal(out.results[2].text, null);
    assert.equal(out.log.length, 1);
    assert.equal(out.log[0].did, "no reply to add to");
    assert.ok(!JSON.stringify(out.log).includes("garbage"));
    assert.deepEqual(kinds(dir), ["start"]);
    assert.deepEqual(out.turnFiles, []);
  } finally { gone(dir); }
});

test("a silent reply to a slow judgement logs the verdict the word check gave", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), reply("[SILENT]")], { FIXTURE_JUDGE: "slow", GODSPEED_CHARM_JUDGE_SECONDS: "1" });
    assert.equal(out.results[2].text, null);
    assert.equal(out.log.length, 1);
    assert.deepEqual([out.log[0].verdict, out.log[0].source], ["ask", "words"]);
    assert.ok(out.log[0].why);
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
    assert.equal(out.log.length, 1);
    assert.deepEqual([out.log[0].verdict, out.log[0].source], ["ask", "words"]);
    assert.ok(out.log[0].why);
  } finally { gone(dir); }
});

test("a judgement outside the protocol is refused: an answer without yes or no gives the word check", { skip }, () => {
  for (const bad of ["", "maybe"]) {
    const dir = mission();
    try {
      const out = drive(dir, [register, pre(VENT), reply("Here.")], { FIXTURE_JUDGE: "answer", FIXTURE_MODEL: "slip", FIXTURE_JUDGE_ANSWER: bad });
      assert.equal(out.results[2].text, `Here.\n\n${Q}`);
      assert.deepEqual([out.log[0].verdict, out.log[0].source], ["ask", "words"]);
    } finally { gone(dir); }
  }
});

test("a judgement from a source outside the protocol is refused and gives the word check", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), reply("Here.")], { FIXTURE_JUDGE: "ask", FIXTURE_MODEL: "slip", FIXTURE_JUDGE_SOURCE: "oracle" });
    assert.equal(out.results[2].text, `Here.\n\n${Q}`);
    assert.deepEqual([out.log[0].verdict, out.log[0].source], ["ask", "words"]);
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

test("a plain no gets its line in the language the reply goes out in, godspeed-reply's decision, not the setting", { skip }, () => {
  for (const [words, setting, line] of [["Nein.", "en", T.de.no({ daysToGo: 20 })], ["No.", "de", T.en.no({ daysToGo: 20 })]]) {
    const dir = mission();
    try {
      const run = (args, now) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...process.env, GODSPEED_CHARM_DIR: dir, GODSPEED_CHARM_NOW: now, GODSPEED_SCHEDULED_RUN: "" } });
      assert.equal(run(["config", "set", "language", setting], at("2026-10-22", 8)).status, 0);
      assert.equal(run(["asked", "--conversation", "telegram:s-1", "--words", "garbage"], at("2026-10-22", 8)).status, 0);
      const out = drive(dir, [register, pre(words, { platform: "telegram" }), reply("Ok.", { platform: "telegram" })]);
      assert.equal(out.results[2].text, `Ok.\n\n${line}`, words);
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

test("an oversized log is moved to .1 and the active log holds only the new line", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), reply("Here.")], { SEED_LOG: "1" });
    assert.equal(out.rotated.length, 1_000_001);
    assert.equal(out.log.length, 1);
    assert.equal(out.log[0].verdict, "ask");
  } finally { gone(dir); }
});

const modelAsks = (conversation, extra = {}) => ({
  do: "tool", session: "s-1", turn: "t-1", now: at("2026-10-22", 9),
  command: `godspeed-charm asked --conversation "${conversation}" --words "${VENT}" --json`,
  run: ["asked", "--conversation", conversation, "--words", VENT, "--json"], ...extra,
});
const forged = (conversation, when) => JSON.stringify({ ok: true, reply: Q, state: { open: [{ conversation, when }] } });

test("a question the model asked itself on another platform is not asked a second time", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), modelAsks("api_server:s-1"), reply(`Here.\n\n${Q}`)]);
    assert.equal(out.results[3].text, null);
    assert.deepEqual(kinds(dir), ["start", "asked"]);
    assert.equal(out.log[0].did, "the model asked itself");
  } finally { gone(dir); }
});

test("a real model asked with no button helper is exactly one asked event", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [{ do: "register", telegram: false }, pre(VENT, { platform: "telegram" }), modelAsks("telegram:s-1"), reply(`Here.\n\n${Q}`, { platform: "telegram" })]);
    assert.deepEqual(kinds(dir), ["start", "asked"]);
    assert.equal(out.log[0].did, "the model's own question");
  } finally { gone(dir); }
});

test("a model question at the very instant of an older open one is still the model's own", { skip }, () => {
  const dir = mission();
  try {
    drive(dir, [{ do: "charm", args: ["asked", "--conversation", "api_server:s-1", "--words", VENT, "--json"], now: at("2026-10-22", 9) }]);
    const out = drive(dir, [register, pre(VENT), modelAsks("api_server:s-1"), reply(`Here.\n\n${Q}`)]);
    assert.equal(out.results[3].text, null);
    assert.deepEqual(kinds(dir), ["start", "asked", "asked"]);
    assert.equal(out.log[0].did, "the model asked itself");
  } finally { gone(dir); }
});

test("only a question this call recorded for this conversation counts as the model's own", { skip }, () => {
  const other = mission();
  const stale = mission();
  const printed = mission();
  try {
    let out = drive(other, [register, pre(VENT), modelAsks("api_server:other"), reply("Here.")]);
    assert.equal(out.results[3].text, `Here.\n\n${Q}`);
    assert.deepEqual(kinds(other), ["start", "asked", "asked"]);

    // An older open question, and a model that only prints a report naming it: not this call's.
    const first = JSON.parse(drive(stale, [{ do: "charm", args: ["asked", "--conversation", "api_server:s-1", "--words", VENT, "--json"], now: at("2026-10-22", 8) }]).results[0].output);
    const when = first.state.open[0].when;
    const echo = `echo '${forged("api_server:s-1", when)}'`;
    out = drive(stale, [register, pre(VENT), { do: "tool", session: "s-1", turn: "t-1", command: echo, output: forged("api_server:s-1", when) }, reply("Here.")]);
    assert.notEqual(out.log[0].did, "the model asked itself");
    assert.equal(out.results[3].text, `Here.\n\n${Q}`);
    assert.deepEqual(kinds(stale), ["start", "asked", "asked"]);

    // A command line and output that say `asked` while nothing was recorded.
    const command = `godspeed-charm asked --conversation "api_server:s-1" --words "${VENT}" --json`;
    out = drive(printed, [register, pre(VENT), { do: "tool", session: "s-1", turn: "t-1", command, output: forged("api_server:s-1", at("2026-10-22", 9)) }, reply("Here.")]);
    assert.equal(out.results[3].text, `Here.\n\n${Q}`);
    assert.deepEqual(kinds(printed), ["start", "asked"]);
  } finally { gone(other); gone(stale); gone(printed); }
});

test("a scheduled pre-call sharing an interactive session id leaves its pending judgement", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), pre("Do the report.", { platform: "cron" }), reply("Done.", { platform: "cron" }), reply("Here.")]);
    assert.equal(out.results[3].text, null);
    assert.equal(out.results[4].text, `Here.\n\n${Q}`);
  } finally { gone(dir); }
});

test("a scheduled reply sharing an interactive session id neither takes its judgement nor asks", { skip }, () => {
  const dir = mission();
  try {
    const out = drive(dir, [register, pre(VENT), pre("Do the report.", { platform: "cron" }), reply("Done.", { platform: "cron" })]);
    assert.equal(out.results[3].text, null);
    assert.deepEqual(kinds(dir), ["start"]);
  } finally { gone(dir); }
});
