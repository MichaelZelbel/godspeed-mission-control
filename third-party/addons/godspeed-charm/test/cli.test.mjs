// The command, run the way the notebook, the hooks and a person run it: node on bin/godspeed-charm.mjs,
// on a throwaway mission control with a notebook, the day pinned through GODSPEED_CHARM_NOW.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { T } from "../lib/texts.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-charm.mjs");

function mission({ language = "en", settings } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charm-cli-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
  fs.mkdirSync(path.join(dir, "notebook"));
  fs.mkdirSync(path.join(dir, ".godspeed"));
  fs.mkdirSync(path.join(dir, "routines", "charm"), { recursive: true });
  fs.writeFileSync(path.join(dir, "routines", "charm", "settings.json"), settings ?? JSON.stringify({ version: 1, timezone: "Europe/Berlin", language }) + "\n");
  return dir;
}
const gone = (dir) => fs.rmSync(dir, { recursive: true, force: true });

// Each call gets its own moment (one second later than the one before), so two events are never
// written with the same time, the way a person never says two things in the same millisecond.
let tick = 0;
function run(dir, args, { day = "2026-10-21", env = {}, input } = {}) {
  const at = new Date(`${day}T08:00:00Z`).getTime() + (tick++ % 3000) * 1000;
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", input, windowsHide: true,
    env: {
      ...process.env, GODSPEED_CHARM_DIR: dir, GODSPEED_CHARM_NOW: new Date(at).toISOString(),
      GODSPEED_SCHEDULED_RUN: "", CLAUDE_CODE_ENTRYPOINT: "cli", GODSPEED_CHARM_LAUNCHER: "", ...env,
    },
  });
}
const json = (r) => JSON.parse(r.stdout);
const rows = (dir) => {
  const root = path.join(dir, "notebook", "Collections");
  let n = 0;
  try { for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) n += fs.readdirSync(path.join(root, e.name)).filter((f) => f.endsWith(".md")).length; } catch {}
  return n;
};
const rowsOf = (dir, kind) => {
  const root = path.join(dir, "notebook", "Collections");
  let n = 0;
  try { for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isDirectory()) n += fs.readdirSync(path.join(root, e.name)).filter((f) => f.startsWith(kind.charAt(0).toUpperCase() + kind.slice(1) + " ")).length; } catch {}
  return n;
};

test("start says the end date, exactly", () => {
  const dir = mission();
  const r = run(dir, ["start", "--words", "start the Charm Challenge"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "Charm Challenge started. 21 days to go, done on Wednesday 11 November.");
  assert.equal(rows(dir), 1);
  const s = json(run(dir, ["status", "--json"], { day: "2026-10-30" }));
  assert.equal(s.ok, true);
  assert.equal(s.state.daysToGo, 12);
  assert.equal(s.reply, "12 days to go, done on Wednesday 11 November. Longest run so far: 9 days. Restarts: 0.");
  gone(dir);
});

test("start while running writes no start, asks whether to start over, and opens that question here", () => {
  const dir = mission();
  run(dir, ["start"]);
  const r = run(dir, ["start", "--words", "start the Charm Challenge", "--conversation", "telegram:1", "--json"], { day: "2026-10-30" });
  assert.equal(r.status, 0, r.stderr);
  const out = json(r);
  assert.equal(out.reply, "Charm Challenge is already running: day 10 of 21, 12 days to go. Start over from 21? Yes / No.");
  assert.equal(rowsOf(dir, "start"), 1);
  assert.deepEqual(out.state.open.map((q) => q.conversation), ["telegram:1"]);
  // A yes there is a start over, which is a reset.
  const y = json(run(dir, ["answer", "yes", "--conversation", "telegram:1", "--words", "yes", "--json"], { day: "2026-10-30" }));
  assert.equal(y.state.restarts, 1);
  assert.equal(y.state.daysToGo, 21);
  gone(dir);
});

test("start while running asks no question it could not take a yes to", () => {
  const dir = mission();
  run(dir, ["start"]);
  // No conversation: nothing can be recorded, so nothing is asked.
  const bare = run(dir, ["start", "--json"], { day: "2026-10-30" });
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(json(bare).reply, "Charm Challenge is already running: day 10 of 21, 12 days to go.");
  assert.deepEqual(json(bare).state.open, []);
  // A reset already happened today: the count is at 21 anyway, and no question opens.
  run(dir, ["slip", "--words", "charm slip"], { day: "2026-10-31" });
  const reset = run(dir, ["start", "--conversation", "telegram:1", "--json", "--language", "de"], { day: "2026-10-31" });
  assert.equal(json(reset).reply, "Die Charm Challenge läuft schon: Tag 1 von 21, noch 21 Tage.");
  assert.deepEqual(json(reset).state.open, []);
  assert.equal(rowsOf(dir, "asked"), 0);
  gone(dir);
});

test("a slip story on a day that already had a reset: nothing changes and nothing is asked", () => {
  const dir = mission();
  run(dir, ["start"]);
  run(dir, ["slip", "--words", "charm slip"], { day: "2026-10-30" });
  const before = rows(dir);
  const story = run(dir, ["slip", "--words", "I yelled at Copilot", "--json"], { day: "2026-10-30" });
  assert.equal(story.status, 0, story.stderr);
  assert.equal(json(story).reply, "There was a reset today already, so nothing changed. Still 21 days to go.");
  assert.equal(rows(dir), before);
  const explicit = run(dir, ["slip", "--words", "charm slip"], { day: "2026-10-30" });
  assert.equal(explicit.stdout.trim(), "Back to 21. Done on Friday 20 November. Restarts: 1.");
  assert.equal(rows(dir), before);
  gone(dir);
});

test("a yes in another conversation answers nothing and writes nothing; in its own it resets", () => {
  const dir = mission();
  run(dir, ["start"]);
  const asked = run(dir, ["asked", "--conversation", "telegram:1", "--words", "why do you give me this garbage?"], { day: "2026-10-30" });
  assert.equal(asked.status, 0, asked.stderr);
  assert.equal(asked.stdout.trim(), "That sounded like a slip. Back to 21? Yes / No.");
  const before = rows(dir);
  const wrong = run(dir, ["answer", "yes", "--conversation", "telegram:2", "--words", "yes", "--json"], { day: "2026-10-30" });
  assert.equal(wrong.status, 2);
  assert.equal(wrong.stderr.trim(), T.en.noOpenQuestion());
  const refused = json(wrong);
  assert.equal(refused.ok, false);
  assert.equal(refused.reply, T.en.noOpenQuestion());
  assert.equal(refused.state.restarts, 0);
  assert.equal(rows(dir), before);
  const right = run(dir, ["answer", "yes", "--conversation", "telegram:1", "--words", "yes"], { day: "2026-10-30" });
  assert.equal(right.status, 0, right.stderr);
  assert.equal(right.stdout.trim(), "Back to 21. Done on Friday 20 November. Restarts: 1.");
  gone(dir);
});

test("no keeps the count and is remembered; the person's own words can answer too", () => {
  const dir = mission();
  run(dir, ["start"]);
  run(dir, ["asked", "--conversation", "c1", "--words", "useless thing"], { day: "2026-10-30" });
  const no = run(dir, ["answer", "no", "--conversation", "c1", "--words", "that didn't count", "--json"], { day: "2026-10-30" });
  assert.equal(no.status, 0, no.stderr);
  assert.equal(json(no).reply, "Fair enough. Still 12 days to go.");
  assert.equal(json(no).state.kept, 1);
  assert.deepEqual(json(no).state.open, []);
  // The answer from the words alone.
  run(dir, ["asked", "--conversation", "c1", "--words", "stupid bot"], { day: "2026-10-30" });
  const ja = json(run(dir, ["answer", "--conversation", "c1", "--words", "Ja!", "--json"], { day: "2026-10-30" }));
  assert.equal(ja.ok, true);
  assert.equal(ja.state.restarts, 1);
  // Words that are neither leave the question open and write nothing.
  run(dir, ["asked", "--conversation", "c1", "--words", "again?!"], { day: "2026-10-31" });
  const before = rows(dir);
  const maybe = run(dir, ["answer", "--conversation", "c1", "--words", "hmm, maybe", "--json"], { day: "2026-10-31" });
  assert.equal(maybe.status, 2);
  assert.equal(json(maybe).reply, T.en.notAnAnswer());
  assert.equal(json(maybe).state.open.length, 1);
  assert.equal(rows(dir), before);
  gone(dir);
});

test("slip: a story needs the question first; a plain charm slip resets, once a day", () => {
  const dir = mission();
  run(dir, ["start"]);
  const story = run(dir, ["slip", "--words", "I yelled at Copilot", "--json"], { day: "2026-10-30" });
  assert.equal(story.status, 2);
  assert.equal(json(story).reply, T.en.askFirst());
  assert.equal(story.stderr.trim(), T.en.askFirst());
  assert.equal(rows(dir), 1);
  const slip = run(dir, ["slip", "--words", "charm slip"], { day: "2026-10-30" });
  assert.equal(slip.status, 0, slip.stderr);
  assert.equal(slip.stdout.trim(), "Back to 21. Done on Friday 20 November. Restarts: 1.");
  assert.equal(rowsOf(dir, "reset"), 1);
  const again = run(dir, ["slip", "--words", "charm slip", "--json"], { day: "2026-10-30" });
  assert.equal(again.status, 0);
  assert.equal(json(again).state.restarts, 1);
  assert.equal(rowsOf(dir, "reset"), 1);
  gone(dir);
});

test("asked refuses when nothing runs, after a reset today, and on the finish day", () => {
  const dir = mission();
  const none = run(dir, ["asked", "--conversation", "c1", "--words", "idiot"]);
  assert.equal(none.status, 2);
  assert.equal(none.stderr.trim(), T.en.notRunning());
  run(dir, ["start"]);
  run(dir, ["slip", "--words", "charm slip"], { day: "2026-10-25" });
  const today = run(dir, ["asked", "--conversation", "c1", "--words", "idiot", "--json"], { day: "2026-10-25" });
  assert.equal(today.status, 2);
  assert.equal(json(today).reply, T.en.resetToday(json(today).state));
  assert.deepEqual(json(today).state.open, []);
  const end = run(dir, ["asked", "--conversation", "c1", "--words", "idiot", "--json"], { day: "2026-11-15" });
  assert.equal(end.status, 2);
  assert.equal(json(end).state.running, false);
  assert.equal(rowsOf(dir, "asked"), 0);
  gone(dir);
});

test("stop ends it; stop again refuses; start after a stop is a fresh challenge", () => {
  const dir = mission();
  run(dir, ["start"]);
  run(dir, ["slip", "--words", "charm slip"], { day: "2026-10-23" });
  const stop = run(dir, ["stop", "--words", "stop the Charm Challenge"], { day: "2026-10-24" });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stdout.trim(), T.en.stopped());
  const again = run(dir, ["stop"], { day: "2026-10-24" });
  assert.equal(again.status, 2);
  assert.equal(again.stderr.trim(), T.en.notRunning());
  assert.equal(run(dir, ["status"], { day: "2026-10-24" }).stdout.trim(), T.en.notRunning());
  const fresh = json(run(dir, ["start", "--json"], { day: "2026-10-25" }));
  assert.equal(fresh.reply, "Charm Challenge started. 21 days to go, done on Sunday 15 November.");
  assert.equal(fresh.state.restarts, 0);
  gone(dir);
});

test("the brief: the line while running, the finish line on the end date once written, nothing otherwise", () => {
  const dir = mission();
  const empty = run(dir, ["brief"]);
  assert.equal(empty.status, 0);
  assert.equal(empty.stdout, "");
  run(dir, ["start"]);
  assert.equal(run(dir, ["brief"], { day: "2026-10-30" }).stdout.trim(), "Charm Challenge: day 10 of 21, 12 days to go.");
  run(dir, ["asked", "--conversation", "c1", "--words", "you moron"], { day: "2026-10-31" });
  run(dir, ["answer", "no", "--conversation", "c1", "--words", "no"], { day: "2026-10-31" });
  const first = run(dir, ["brief"], { day: "2026-11-11" });
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout.trim(), "Charm Challenge done: 21 days. Restarts on the way: 0. You talked me out of 1 reset.");
  assert.equal(rowsOf(dir, "finish"), 1);
  const second = run(dir, ["brief"], { day: "2026-11-11" });
  assert.equal(second.stdout.trim(), first.stdout.trim());
  assert.equal(rowsOf(dir, "finish"), 1);
  assert.equal(run(dir, ["brief"], { day: "2026-11-12" }).stdout, "");
  gone(dir);
});

test("brief --no-write says the finish line and writes nothing", () => {
  const dir = mission();
  run(dir, ["start"]);
  const before = rows(dir);
  const r = run(dir, ["brief", "--no-write"], { day: "2026-11-11" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "Charm Challenge done: 21 days. Restarts on the way: 0.");
  assert.equal(rows(dir), before);
  assert.equal(rowsOf(dir, "finish"), 0);
  gone(dir);
});

test("status on the end date says the finish line and settles it", () => {
  const dir = mission();
  run(dir, ["start"]);
  const r = run(dir, ["status", "--json"], { day: "2026-11-11" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(json(r).reply, "Charm Challenge done: 21 days. Restarts on the way: 0.");
  assert.equal(json(r).state.finishedOn, "2026-11-11");
  assert.equal(rowsOf(dir, "finish"), 1);
  gone(dir);
});

test("German: --language de for one reply, and settings.language", () => {
  const dir = mission();
  const de = run(dir, ["start", "--language", "de"]);
  assert.equal(de.stdout.trim(), "Charm Challenge gestartet. Noch 21 Tage, fertig am Mittwoch, 11. November.");
  assert.equal(run(dir, ["brief"], { day: "2026-10-30" }).stdout.trim(), "Charm Challenge: day 10 of 21, 12 days to go.");
  assert.equal(run(dir, ["brief", "--language", "de"], { day: "2026-10-30" }).stdout.trim(), "Charm Challenge: Tag 10 von 21, noch 12 Tage.");
  assert.equal(run(dir, ["config", "set", "language", "de"]).status, 0);
  assert.equal(run(dir, ["config", "get", "language"]).stdout.trim(), "de");
  assert.equal(run(dir, ["status"], { day: "2026-10-30" }).stdout.trim(), "Noch 12 Tage, fertig am Mittwoch, 11. November. Längste Serie bisher: 9 Tage. Neustarts: 0.");
  assert.equal(run(dir, ["status", "--language", "en"], { day: "2026-10-30" }).stdout.trim(), "12 days to go, done on Wednesday 11 November. Longest run so far: 9 days. Restarts: 0.");
  const bad = run(dir, ["status", "--language", "fr"]);
  assert.equal(bad.status, 1);
  gone(dir);
});

test("an unknown language in the settings falls back to English", () => {
  const dir = mission({ language: "fr" });
  const r = run(dir, ["start"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "Charm Challenge started. 21 days to go, done on Wednesday 11 November.");
  gone(dir);
});

test("context: the block while running, nothing when scheduled, nothing when not running", () => {
  const dir = mission();
  assert.equal(run(dir, ["context", "--conversation", "telegram:1"]).stdout, "");
  run(dir, ["start"]);
  run(dir, ["asked", "--conversation", "telegram:1", "--words", "you useless pile of bits"], { day: "2026-10-30" });
  const here = run(dir, ["context", "--conversation", "telegram:1"], { day: "2026-10-30" });
  assert.equal(here.status, 0, here.stderr);
  assert.match(here.stdout, /^\[godspeed-charm\]/);
  assert.match(here.stdout, /12 days to go/);
  assert.match(here.stdout, /you useless pile of bits/);
  assert.match(here.stdout, /godspeed-charm answer yes --conversation "telegram:1"/);
  const there = run(dir, ["context", "--conversation", "telegram:2"], { day: "2026-10-30" });
  assert.match(there.stdout, /12 days to go/);
  assert.doesNotMatch(there.stdout, /useless pile of bits/);
  assert.doesNotMatch(there.stdout, /answer yes/);
  assert.equal(run(dir, ["context", "--conversation", "telegram:1", "--scheduled"], { day: "2026-10-30" }).stdout, "");
  assert.equal(run(dir, ["context", "--conversation", "telegram:1"], { day: "2026-10-30", env: { GODSPEED_SCHEDULED_RUN: "1" } }).stdout, "");
  gone(dir);
});

test("context --hook claude: the hook's JSON for its own session, silent for SDK and scheduled runs", () => {
  const dir = mission();
  run(dir, ["start"]);
  run(dir, ["asked", "--conversation", "claude:abc-123", "--words", "you useless thing"], { day: "2026-10-30" });
  const input = JSON.stringify({ session_id: "abc-123", hook_event_name: "UserPromptSubmit", prompt: "yes" });
  const r = run(dir, ["context", "--hook", "claude"], { day: "2026-10-30", input });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ["hookSpecificOutput"]);
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(out.hookSpecificOutput.additionalContext, /^\[godspeed-charm\]/);
  assert.match(out.hookSpecificOutput.additionalContext, /you useless thing/);
  assert.match(out.hookSpecificOutput.additionalContext, /--conversation "claude:abc-123"/);
  for (const env of [{ CLAUDE_CODE_ENTRYPOINT: "sdk-ts" }, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }, { GODSPEED_SCHEDULED_RUN: "1" }]) {
    const quiet = run(dir, ["context", "--hook", "claude"], { day: "2026-10-30", input, env });
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout, "", JSON.stringify(env));
    assert.equal(quiet.stderr, "");
  }
  for (const bad of ["", "not json", "[]", "{}", JSON.stringify({ session_id: "" })]) {
    const quiet = run(dir, ["context", "--hook", "claude"], { day: "2026-10-30", input: bad });
    assert.equal(quiet.status, 0);
    assert.equal(quiet.stdout, "", JSON.stringify(bad));
    assert.equal(quiet.stderr, "");
  }
  gone(dir);
});

test("context never breaks a chat: corrupt settings, a corrupt row, no mission control", () => {
  const dir = mission({ settings: "{ not json" });
  const r = run(dir, ["context", "--conversation", "telegram:1"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
  const h = run(dir, ["context", "--hook", "claude"], { input: JSON.stringify({ session_id: "x" }) });
  assert.equal(h.status, 0);
  assert.equal(h.stdout, "");
  assert.equal(h.stderr, "");
  // Elsewhere the same corrupt file is a real error.
  const s = run(dir, ["status"]);
  assert.equal(s.status, 1);
  assert.match(s.stderr, /not valid JSON/);
  gone(dir);

  const ok = mission();
  run(ok, ["start"]);
  const folder = path.join(ok, "notebook", "Collections", "Charm Challenge");
  fs.writeFileSync(path.join(folder, "broken.md"), "---\nthis: [is not\n---\n");
  const c = run(ok, ["context", "--conversation", "telegram:1"], { day: "2026-10-30" });
  assert.equal(c.status, 0);
  assert.equal(c.stderr, "");
  assert.match(c.stdout, /12 days to go/);
  gone(ok);

  const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), "charm-none-"));
  const n = run(nowhere, ["context"]);
  assert.equal(n.status, 0);
  assert.equal(n.stdout + n.stderr, "");
  const st = run(nowhere, ["status"]);
  assert.equal(st.status, 1);
  assert.match(st.stderr, /mission control/);
  gone(nowhere);
});

test("context stays quiet even when finding mission control or reading the arguments fails", () => {
  // A device.env that is a folder makes reading it throw (EISDIR) inside findMissionControl.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "charm-home-"));
  fs.mkdirSync(path.join(home, ".godspeed", "device.env"), { recursive: true });
  const env = { GODSPEED_CHARM_DIR: "", HOME: home, USERPROFILE: home };
  const spawn = (args, extra = {}) => spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", cwd: home, windowsHide: true, input: extra.input,
    env: { ...process.env, GODSPEED_SCHEDULED_RUN: "", CLAUDE_CODE_ENTRYPOINT: "cli", GODSPEED_CHARM_LAUNCHER: "", ...env, ...extra.env },
  });
  for (const [args, input] of [[["context", "--conversation", "telegram:1"]], [["context", "--hook", "claude"], JSON.stringify({ session_id: "abc" })]]) {
    const r = spawn(args, { input });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  }
  // Elsewhere the same failure is an error a person sees, without a stack trace.
  const s = spawn(["status"]);
  assert.equal(s.status, 1);
  assert.match(s.stderr, /^godspeed-charm: /);
  // Arguments the .cmd launcher cut short: the context still says nothing.
  const cut = spawn(["context", "--conversation", "telegram:1"], { env: { GODSPEED_CHARM_LAUNCHER: "cmd" } });
  assert.equal(cut.status, 0);
  assert.equal(cut.stdout + cut.stderr, "");
  gone(home);
});

test("the finish write in context waits at most a moment for a busy notebook, and the block still comes", () => {
  const dir = mission();
  run(dir, ["start"]);
  // Another writer (this test process, alive) holds the notebook's lock.
  const lock = path.join(dir, ".godspeed", "workspace.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, thread: 0, token: "held-by-test", at: new Date().toISOString() }));
  const started = Date.now();
  const r = run(dir, ["context", "--conversation", "telegram:1"], { day: "2026-11-11" });
  const took = Date.now() - started;
  assert.equal(r.status, 0, r.stderr);
  assert.ok(took < 8000, `context took ${took} ms`);
  assert.match(r.stdout, /Charm Challenge done: 21 days/);
  assert.equal(r.stderr, "");
  assert.equal(rowsOf(dir, "finish"), 0);
  fs.rmSync(lock);
  run(dir, ["context", "--conversation", "telegram:1"], { day: "2026-11-11" });
  assert.equal(rowsOf(dir, "finish"), 1);
  gone(dir);
});

test("context on the finish day: the finish line, no slip question, a sticker only with --stickers; it settles the finish", () => {
  const dir = mission();
  run(dir, ["start"]);
  const r = run(dir, ["context", "--conversation", "telegram:1"], { day: "2026-11-11" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Charm Challenge done: 21 days\. Restarts on the way: 0\./);
  assert.doesNotMatch(r.stdout, /sticker/i);
  assert.doesNotMatch(r.stdout, /That sounded like a slip/);
  assert.equal(rowsOf(dir, "finish"), 1);
  assert.match(run(dir, ["context", "--conversation", "telegram:1", "--stickers"], { day: "2026-11-11" }).stdout, /\[\[sticker:party\]\]/);
  // Later the same day it still says it (once per conversation is the model's to keep); the day after, nothing.
  assert.match(run(dir, ["context", "--conversation", "telegram:1"], { day: "2026-11-11" }).stdout, /Charm Challenge done/);
  assert.equal(rowsOf(dir, "finish"), 1);
  assert.equal(run(dir, ["context", "--conversation", "telegram:1"], { day: "2026-11-12" }).stdout, "");
  gone(dir);
});

test("bad arguments are errors (exit 1), not refusals", () => {
  const dir = mission();
  run(dir, ["start"]);
  assert.equal(run(dir, ["asked", "--words", "x"]).status, 1);
  assert.equal(run(dir, ["answer", "yes"]).status, 1);
  assert.equal(run(dir, ["slip"]).status, 1);
  assert.equal(run(dir, ["start", "--words"]).status, 1);
  assert.equal(run(dir, ["nonsense"]).status, 1);
  gone(dir);
});

test("config and help", () => {
  const dir = mission();
  assert.equal(run(dir, ["config", "get", "timezone"]).stdout.trim(), "Europe/Berlin");
  const set = run(dir, ["config", "set", "timezone", "America/New_York"]);
  assert.equal(set.status, 0, set.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "routines", "charm", "settings.json"), "utf8")).timezone, "America/New_York");
  assert.equal(run(dir, ["config", "set", "timezone", "Mars/Base"]).status, 1);
  const help = run(dir, ["help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /godspeed-charm start/);
  gone(dir);
});

test("words from a file arrive as written", () => {
  const dir = mission();
  run(dir, ["start"]);
  const file = path.join(dir, "words.txt");
  fs.writeFileSync(file, "why \"this\" again?\nseriously");
  const r = run(dir, ["asked", "--conversation", "c1", "--words-file", file, "--json"], { day: "2026-10-30" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(json(r).state.open[0].words, "why \"this\" again?\nseriously");
  gone(dir);
});
