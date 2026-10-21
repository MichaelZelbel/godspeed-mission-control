// The Yes / No buttons on Telegram: the Hermes plugin, run by python with stand-ins for Telegram and
// Hermes (test/telegram_driver.py) and the real godspeed-charm command on a throwaway mission
// control, so a tap writes real events. Skipped when this computer has no python.
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

const SESSION = "s-1";
const TURN = "t-1";
const CONVERSATION = `telegram:${SESSION}`;
const Q = T.en.question();
const QDE = T.de.question();
const at = (day, hour = 8) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`).toISOString();

function mission() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charm-telegram-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
  fs.mkdirSync(path.join(dir, "notebook"));
  fs.mkdirSync(path.join(dir, ".godspeed"));
  fs.mkdirSync(path.join(dir, "routines", "charm"), { recursive: true });
  fs.writeFileSync(path.join(dir, "routines", "charm", "settings.json"), JSON.stringify({ version: 1, timezone: "Europe/Berlin", language: "en" }) + "\n");
  return dir;
}
const gone = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const base = (dir, now) => ({ ...process.env, GODSPEED_CHARM_DIR: dir, GODSPEED_CHARM_NOW: now, GODSPEED_SCHEDULED_RUN: "", GODSPEED_CHARM_LAUNCHER: "" });
const charm = (dir, args, now) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", windowsHide: true, env: base(dir, now) });

// A challenge started on 21 October and, on the 22nd, the slip question asked in this Telegram
// conversation, the way the model runs it. Returns the tool call Hermes would report.
function asked(dir, { language } = {}) {
  assert.equal(charm(dir, ["start"], at("2026-10-21")).status, 0);
  const lang = language ? ["--language", language] : [];
  const r = charm(dir, ["asked", "--conversation", CONVERSATION, "--words", "why is this garbage again", "--json", ...lang], at("2026-10-22"));
  assert.equal(r.status, 0, r.stderr);
  return {
    command: `godspeed-charm asked --conversation "${CONVERSATION}" --words "why is this garbage again" --json${language ? ` --language ${language}` : ""}`,
    output: r.stdout.trim(),
    when: JSON.parse(r.stdout).state.open[0].when,
  };
}
const tool = (a, extra = {}) => ({ do: "tool", session: SESSION, turn: TURN, command: a.command, output: a.output, ...extra });
const reply = (text, extra = {}) => ({ do: "reply", session: SESSION, turn: TURN, text, ...extra });

function drive(dir, steps, env = {}) {
  const r = spawnSync(PY, [DRIVER, PLUGIN], {
    input: JSON.stringify({ steps }), encoding: "utf8", timeout: 180000, windowsHide: true,
    env: {
      ...base(dir, at("2026-10-22", 9)), GODSPEED_NODE: process.execPath, GODSPEED_CHARM_SCRIPT: BIN,
      TELEGRAM_ALLOWED_USERS: "31415", GODSPEED_CHARM_BUTTON_DELAY: "0", PYTHONDONTWRITEBYTECODE: "1", ...env,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}
const sends = (out) => out.calls.filter((c) => c.method === "send_message");
const edits = (out) => out.calls.filter((c) => c.method === "edit_message_text");

test("a slip question on Telegram comes as its own message with Yes and No, and leaves the reply", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const out = drive(dir, [{ do: "register" }, tool(a), reply(`I fixed the draft.\n\n${Q}`), { do: "files" }]);
    assert.deepEqual(out.results[0].handlers, ["^gsc1:"]);
    assert.equal(out.results[2].text, "I fixed the draft.");
    const sent = sends(out);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, Q);
    assert.equal(sent[0].chat_id, 31415);
    assert.equal(sent[0].reply_to_message_id, 8);
    assert.deepEqual(sent[0].reply_markup.map((row) => row.map((b) => b.text)), [["Yes", "No"]]);
    const data = sent[0].reply_markup[0].map((b) => b.data);
    for (const d of data) assert.match(d, /^gsc1:[a-f0-9]{32}$/);
    assert.notEqual(data[0], data[1]);
    // Each button's token, under the workspace like the habit buttons' tokens.
    const tokens = Object.values(out.results[3].files);
    assert.equal(tokens.length, 2);
    assert.deepEqual(tokens.map((t) => t.answer).sort(), ["no", "yes"]);
    for (const t of tokens) {
      assert.equal(t.conversation, CONVERSATION);
      assert.equal(t.askedWhen, a.when);
      assert.ok(Number.isFinite(t.created));
      assert.equal(t.messageId, String(sent[0].message_id));
      assert.equal(t.language, "en");
    }
    assert.ok(data.every((d) => tokens.some((t) => t.key === d.slice(5))));
  } finally { gone(dir); }
});

test("a tap on Yes answers it: the message becomes the reply, the buttons go, the reset is written", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const out = drive(dir, [{ do: "register" }, tool(a), reply(`Done.\n\n${Q}`), { do: "tap", button: 0 }]);
    const [edit] = edits(out);
    assert.equal(edits(out).length, 1);
    assert.equal(edit.text, "Back to 21. Done on Thursday 12 November. Restarts: 1.");
    assert.ok("reply_markup" in edit);
    assert.equal(edit.reply_markup, null);
    assert.equal(edit.message_id, sends(out)[0].message_id);
    assert.equal(out.results[3].answered.length, 1);
    const last = readEvents(dir).at(-1);
    assert.equal(last.kind, "reset");
    assert.equal(last.words, "(button)");
    assert.equal(last.conversation, CONVERSATION);
  } finally { gone(dir); }
});

test("a tap from anyone else, in a group or on another bot's message does nothing", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const before = readEvents(dir).length;
    const out = drive(dir, [
      { do: "register" }, tool(a), reply(`Done.\n\n${Q}`),
      { do: "tap", button: 0, user: 999 },
      { do: "tap", button: 0, chat_type: "group" },
      { do: "tap", button: 0, from_bot: 7 },
      { do: "tap", button: 0, chat: 999 },
    ]);
    assert.equal(out.calls.filter((c) => c.method.startsWith("edit")).length, 0);
    assert.deepEqual(out.results.slice(3).map((r) => r.answered), [[], [], [], []]);
    assert.equal(readEvents(dir).length, before);
  } finally { gone(dir); }
});

test("those taps used nothing up: the owner's own tap on the same message still answers", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const out = drive(dir, [{ do: "register" }, tool(a), reply(`Done.\n\n${Q}`), { do: "tap", button: 1, user: 999 }, { do: "tap", button: 1 }]);
    assert.deepEqual(edits(out).map((e) => e.text), ["Fair enough. Still 20 days to go."]);
    assert.equal(readEvents(dir).at(-1).kind, "kept");
    assert.equal(readEvents(dir).at(-1).words, "(button)");
  } finally { gone(dir); }
});

test("a tap after midnight edits the message to the expired text and writes nothing", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const before = readEvents(dir).length;
    const out = drive(dir, [{ do: "register" }, tool(a), reply(`Done.\n\n${Q}`), { do: "tap", button: 0, now: at("2026-10-23", 9) }]);
    assert.equal(edits(out).length, 1);
    assert.equal(edits(out)[0].text, T.en.noOpenQuestion());
    assert.equal(edits(out)[0].reply_markup, null);
    assert.equal(readEvents(dir).length, before);
  } finally { gone(dir); }
});

test("a second tap, on the same button or the other one, edits to the expired text and writes nothing", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const before = readEvents(dir).length;
    const out = drive(dir, [
      { do: "register" }, tool(a), reply(`Done.\n\n${Q}`),
      { do: "tap", button: 0 }, { do: "tap", button: 0 }, { do: "tap", button: 1 },
    ]);
    assert.deepEqual(edits(out).map((e) => e.text), ["Back to 21. Done on Thursday 12 November. Restarts: 1.", T.en.noOpenQuestion(), T.en.noOpenQuestion()]);
    assert.equal(readEvents(dir).length, before + 1);
  } finally { gone(dir); }
});

test("a German question gets Ja and Nein, and the reply comes in German", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir, { language: "de" });
    const out = drive(dir, [{ do: "register" }, tool(a), reply(`Erledigt.\n\n${QDE}`), { do: "tap", button: 1 }]);
    assert.equal(out.results[2].text, "Erledigt.");
    assert.equal(sends(out)[0].text, QDE);
    assert.deepEqual(sends(out)[0].reply_markup.map((row) => row.map((b) => b.text)), [["Ja", "Nein"]]);
    assert.equal(edits(out)[0].text, "Alles klar. Noch 20 Tage.");
    assert.equal(readEvents(dir).at(-1).kind, "kept");
  } finally { gone(dir); }
});

test("the question stays in the reply when no button can be sent", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const text = `Done.\n\n${Q}`;
    // Hermes without the Telegram gateway: no client to send with.
    const none = drive(dir, [{ do: "register", telegram: false }, tool(a), reply(text)]);
    assert.equal(none.results[2].text, null);
    // No single owner, or a group chat: no private route.
    const open = drive(dir, [{ do: "register" }, tool(a), reply(text)], { TELEGRAM_ALLOWED_USERS: "" });
    assert.equal(open.results[2].text, null);
    const group = drive(dir, [{ do: "register" }, tool(a, { route: { CHAT_TYPE: "group" } }), reply(text)]);
    assert.equal(group.results[2].text, null);
    for (const out of [none, open, group]) assert.equal(out.calls.length, 0);
  } finally { gone(dir); }
});

test("only a successful asked, for this very conversation, on Telegram, gets buttons", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const text = `Done.\n\n${Q}`;
    const out = drive(dir, [
      { do: "register" },
      tool(a, { exit_code: 2, output: JSON.stringify({ ok: false, reply: T.en.notRunning() }) }), reply(text),
      tool(a, { turn: "t-2", command: a.command.replace(CONVERSATION, "telegram:another") }), reply(text, { turn: "t-2" }),
      tool(a, { turn: "t-3", command: a.command.replace(" asked ", " status ") }), reply(text, { turn: "t-3" }),
      tool(a, { turn: "t-4" }), reply(text, { turn: "t-4", platform: "cli" }),
      tool(a, { turn: "t-5", tool: "read_file" }), reply(text, { turn: "t-5" }),
      tool(a, { turn: "t-6" }), reply(text, { turn: "t-7" }),
    ]);
    assert.deepEqual(out.results.filter((r) => "text" in r).map((r) => r.text), [null, null, null, null, null, null]);
    assert.equal(sends(out).length, 0);
  } finally { gone(dir); }
});

test("a reply without the exact question still gets the buttons; one that was only the question becomes a pointer", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const out = drive(dir, [
      { do: "register" },
      tool(a), reply("Done. Was that a slip?"),
      tool(a, { turn: "t-2" }), reply(`  **${Q}**  `, { turn: "t-2" }),
    ]);
    assert.equal(out.results[2].text, null);
    assert.equal(out.results[4].text, "\u{1F447}");
    assert.equal(sends(out).length, 2);
  } finally { gone(dir); }
});

test("composes with the coach's picture, the owner's voice filter and the sticker plugin", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const out = drive(dir, [
      { do: "register" }, { do: "bus", kind: "coach" }, { do: "bus", kind: "voice" }, { do: "bus", kind: "stickers" },
      tool(a), reply(`Fixed it \u2014 done. [[sticker:ok]]\n\n${Q}`),
    ]);
    assert.equal(out.results[5].text, "Fixed it , done.\n\nMEDIA:/coach/picture.png");
    const coach = drive(dir, [{ do: "register" }, { do: "bus", kind: "coach" }, tool(a), reply(`Fixed it.\n${Q}`)]);
    assert.equal(coach.results[3].text, "Fixed it.\n\nMEDIA:/coach/picture.png");
  } finally { gone(dir); }
});

test("an unknown button from the owner edits to the expired text and writes nothing", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const before = readEvents(dir).length;
    const out = drive(dir, [{ do: "register" }, tool(a), reply(`Done.\n\n${Q}`), { do: "tap", data: "gsc1:" + "0".repeat(32) }]);
    assert.equal(edits(out)[0].text, T.en.noOpenQuestion());
    assert.equal(edits(out)[0].reply_markup, null);
    assert.equal(readEvents(dir).length, before);
  } finally { gone(dir); }
});

test("a failed send still delivers the question, as plain words, and keeps no tokens", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    // The question was taken out of the reply, so it must still come.
    const failed = drive(dir, [{ do: "register" }, { do: "fail", send: 1 }, tool(a), reply(`Done.\n\n${Q}`), { do: "files" }]);
    assert.equal(failed.results[3].text, "Done.");
    assert.deepEqual(failed.calls.map((c) => c.method), ["send_message_failed", "send_message"]);
    assert.equal(failed.calls[1].text, Q);
    assert.equal(failed.calls[1].reply_markup ?? null, null);
    assert.deepEqual(failed.results[4].files, {});
  } finally { gone(dir); }
});

test("a tap whose command fails says so, keeps the buttons, and a second tap can still answer", { skip }, () => {
  const dir = mission();
  try {
    const a = asked(dir);
    const broken = path.join(dir, "broken.mjs");
    fs.writeFileSync(broken, "process.exit(1);\n");
    const before = readEvents(dir).length;
    const out = drive(dir, [
      { do: "register" }, tool(a), reply(`Done.\n\n${Q}`),
      { do: "env", set: { GODSPEED_CHARM_SCRIPT: broken } }, { do: "tap", button: 0 },
      { do: "env", set: { GODSPEED_CHARM_SCRIPT: BIN } }, { do: "tap", button: 0 },
    ]);
    const [failed, answered] = edits(out);
    assert.equal(failed.text, `${Q}\n\n${T.en.buttonFailed()}`);
    assert.deepEqual(failed.reply_markup, sends(out)[0].reply_markup);
    assert.equal(answered.text, "Back to 21. Done on Thursday 12 November. Restarts: 1.");
    assert.equal(readEvents(dir).length, before + 1);
  } finally { gone(dir); }
});
