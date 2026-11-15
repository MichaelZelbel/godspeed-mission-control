import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { charmState } from "../lib/count.mjs";
import { judge } from "../lib/judge.mjs";
import { SLIP, ONLY_AI } from "../lib/context.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "model-command.mjs");
const ev = (kind, date, extra = {}) => ({ kind, date, when: `${date}T09:00:00Z`, ...extra });
const TODAY = "2026-10-30";
const running = (extra = []) => charmState([ev("start", "2026-10-21"), ...extra], TODAY);
const S = { language: "en" };

// The fixture as an executable of its own, the way godspeed-model is one.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charm-judge-"));
const command = path.join(dir, "godspeed-model");
fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${FIXTURE}"\n`, { mode: 0o755 });
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
const WINDOWS = process.platform === "win32";

const VENTS = [
  "This caption file is garbage again. Why do you always hand me this rubbish?",
  "Rubbish once more. Are you even reading what I write, or do you just make things up?",
  "These slides are a mess again. Why can you never get one simple layout right?",
  "Useless again. The summary you wrote misses everything I asked for.",
  "Wrong again! Do you even look at the file before you answer?",
  "This is rubbish. I told you twice how I want it and you ignored it.",
];
const FIRM = "The deadline is wrong. Check the client's message and fix the draft.";

function ask(words, { state = running(), mode, env, ...rest } = {}) {
  const log = path.join(dir, "model.log");
  fs.rmSync(log, { force: true });
  process.env.FIXTURE_MODEL = mode ?? "slip";
  process.env.FIXTURE_MODEL_LOG = log;
  const verdict = judge({ state, settings: S, today: TODAY, conversation: "api_server:s1", words, modelCommand: WINDOWS ? "" : command, ...rest });
  return { verdict, modelAsked: fs.existsSync(log) };
}

test("no model request without a running challenge, on a reset day, the finish day, in a scheduled run or without a conversation", { skip: WINDOWS }, () => {
  const cases = [
    ["no challenge", { state: charmState([], TODAY) }],
    ["reset today", { state: running([ev("reset", TODAY)]) }],
    ["finish day", { state: charmState([ev("start", "2026-10-09")], TODAY) }],
    ["scheduled", { scheduled: true }],
    ["no conversation", { conversation: "" }],
  ];
  for (const [name, opts] of cases) {
    const { verdict, modelAsked } = ask(VENTS[0], opts);
    assert.equal(verdict.verdict, "none", name);
    assert.equal(verdict.source, "rule", name);
    assert.equal(modelAsked, false, name);
  }
});

test("empty words and commands are none by rule", { skip: WINDOWS }, () => {
  for (const words of ["", "   ", "/new"]) {
    const { verdict, modelAsked } = ask(words);
    assert.deepEqual([verdict.verdict, verdict.source, modelAsked], ["none", "rule", false]);
  }
});

test("a plain yes or no to this conversation's open question is an answer by rule; elsewhere it is not", { skip: WINDOWS }, () => {
  const state = running([ev("asked", TODAY, { conversation: "api_server:s1" })]);
  const no = ask("No.", { state });
  assert.deepEqual([no.verdict.verdict, no.verdict.answer, no.verdict.source, no.modelAsked], ["answer", "no", "rule", false]);
  assert.equal(ask("ja", { state }).verdict.answer, "yes");
  const elsewhere = ask("no", { state, conversation: "api_server:other", mode: "not" });
  assert.equal(elsewhere.verdict.verdict, "none");
});

test("charm slip is none by rule: the model resets, the program never does", { skip: WINDOWS }, () => {
  const { verdict, modelAsked } = ask("charm slip");
  assert.deepEqual([verdict.verdict, verdict.source, modelAsked], ["none", "rule", false]);
});

test("the model gets one JSON request: system with the shared slip wording, the person's words, the timeout and a token cap", { skip: WINDOWS }, () => {
  ask(VENTS[0], { timeoutMs: 4321 });
  const request = JSON.parse(fs.readFileSync(path.join(dir, "model.log"), "utf8"));
  assert.deepEqual(Object.keys(request).sort(), ["max_tokens", "prompt", "system", "timeout_ms"]);
  assert.equal(request.timeout_ms, 4321);
  assert.ok(request.max_tokens > 0);
  assert.ok(request.system.includes(SLIP) && request.system.includes(ONLY_AI));
  assert.ok(request.prompt.includes(VENTS[0]));
});

test("the model's slip and unsure ask, not does not", { skip: WINDOWS }, () => {
  for (const mode of ["slip", "unsure"]) {
    const { verdict, modelAsked } = ask(VENTS[0], { mode });
    assert.deepEqual([verdict.verdict, verdict.source, modelAsked], ["ask", "model", true], mode);
  }
  assert.deepEqual(ask(FIRM, { mode: "not" }).verdict.verdict, "none");
  assert.equal(ask("Das ist Mist.", { mode: "slip-de" }).verdict.language, "de");
});

test("a failing, slow, garbled or missing model gives the word check", { skip: WINDOWS }, () => {
  for (const mode of ["fail", "sleep", "garbage"]) {
    for (const vent of mode === "sleep" ? VENTS.slice(0, 1) : VENTS) {
      const { verdict } = ask(vent, { mode, timeoutMs: 700 });
      assert.deepEqual([verdict.verdict, verdict.source, verdict.language], ["ask", "words", "en"], `${mode}: ${vent}`);
      assert.ok(verdict.why, mode);
    }
    if (mode !== "sleep") assert.equal(ask(FIRM, { mode }).verdict.verdict, "none", mode);
  }
  assert.equal(ask(VENTS[0], { noModel: true }).modelAsked, false);
  assert.equal(ask(VENTS[0], { noModel: true }).verdict.source, "words");
  assert.equal(ask(VENTS[0], { modelCommand: "" }).verdict.source, "words");
});

test("the word check asks for a German vent, in German", () => {
  const verdict = judge({ state: running(), settings: S, today: TODAY, conversation: "c:1", words: "Das ist schon wieder Müll. Warum gibst du mir immer so einen Schrott?", noModel: true });
  assert.deepEqual([verdict.verdict, verdict.language, verdict.source], ["ask", "de", "words"]);
  const firm = judge({ state: running(), settings: S, today: TODAY, conversation: "c:1", words: "Die Frist ist falsch. Prüfe die Nachricht des Kunden und korrigiere den Entwurf.", noModel: true });
  assert.equal(firm.verdict, "none");
});
