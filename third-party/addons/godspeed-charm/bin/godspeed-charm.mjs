#!/usr/bin/env node
// godspeed-charm: the Charm Challenge, kept by Godspeed Mission Control. 21 days of charming your
// assistants into the result instead of arguing; a slip goes back to 21 after a yes, never without
// one. This file only parses arguments, writes the events and prints. What gets decided lives in
// lib/, where the tests can reach it.
//
// Every command answers {ok, reply, state} with --json, the reply alone without it:
//   exit 0  done (reply says what happened)
//   exit 2  refused, nothing written (reply says why; also on stderr, so a person sees it)
//   exit 1  a real error: no mission control, bad arguments, the notebook busy
import fs from "node:fs";
import { findMissionControl } from "../lib/paths.mjs";
import { now } from "../lib/clock.mjs";
import { loadSettings, setSetting, DEFAULTS } from "../lib/settings.mjs";
import { hasNotebook } from "../lib/notebook.mjs";
import { readEvents, appendEvent, localDate } from "../lib/record.mjs";
import { charmState } from "../lib/count.mjs";
import { T, pickLanguage } from "../lib/texts.mjs";
import { isYes, isNo, isExplicitReset } from "../lib/words.mjs";
import { contextBlock } from "../lib/context.mjs";
import { briefText, isFinishDay } from "../lib/brief.mjs";
import { decodeArgv, readWordsFile, restoreShellEnv, startedFromGitBash, gitBashPath, LAUNCHER_ENV, CMDLINE_ENV } from "../lib/argv.mjs";

// The values that name a file or folder. From Git Bash these are turned into Windows paths;
// the person's words never are (lib/argv.mjs).
const PATH_FLAGS = ["godspeed", "words-file"];
const FLAGS = new Set(["json", "scheduled", "no-write"]);
function parseArgs(argv) {
  const pos = []; const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    let v = true;
    if (!FLAGS.has(k)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return { pos, f, error: `--${k} needs a value.` };
      v = next; i++;
    }
    f[k] = v;
  }
  return { pos, f };
}

// The launchers say how they handed the arguments over (lib/argv.mjs). The markers are read once
// and taken out of the environment.
const launched = decodeArgv(process.argv.slice(2), process.env);
const fromGitBash = startedFromGitBash(process.env);
delete process.env[LAUNCHER_ENV]; delete process.env[CMDLINE_ENV];
restoreShellEnv(process.env);
const [cmd = "help", ...rest] = launched.argv;
const { pos, f, error: argError } = parseArgs(rest);
// The context block runs before every message the person sends: whatever goes wrong there, the
// assistant must still answer, so it prints nothing and exits 0 instead of an error.
const QUIET = cmd === "context";
function die(msg) { if (QUIET) process.exit(0); console.error(msg); process.exit(1); }
if (launched.error) die(launched.error);
if (argError) die(argError);
if (fromGitBash) for (const k of PATH_FLAGS) if (typeof f[k] === "string") f[k] = gitBashPath(f[k]);
// Words that hold a line break or a quote travel safest in a file: no shell reads a file's
// contents, so nothing on the way can cut or change them.
if (f["words-file"] !== undefined) {
  if (f.words !== undefined) die("Give the words once: either --words or --words-file, not both.");
  try { f.words = readWordsFile(f["words-file"]); } catch (e) { die(e.message); }
}
if (f.language !== undefined && !["en", "de"].includes(f.language)) die("--language can be en or de.");
for (const k of ["words", "conversation"]) if (f[k] !== undefined && typeof f[k] !== "string") die(`--${k} needs a value.`);

const mcDir = findMissionControl({ arg: f.godspeed });
if (!mcDir && cmd !== "help") die("Could not find your mission control folder. Run this from inside it, or add --godspeed <folder>.");
// The record lives in the notebook (every Godspeed Mission Control has one); config and help work without it.
if (mcDir && !["help", "config"].includes(cmd) && !hasNotebook(mcDir)) die("The Charm Challenge keeps its record in the Godspeed notebook, and this mission control has none.");
let s = { ...DEFAULTS };
if (mcDir && cmd !== "help") { try { s = loadSettings(mcDir); } catch (e) { die(`godspeed-charm: ${e.message}`); } }
// --language wins for this one reply (German in, German out); then the settings; then English.
const lang = pickLanguage(f.language, s.language);
const say = T[lang];
const at = now();
let today;

// Events written by one command get one millisecond each, so a finish settled first and a start
// written after it never share a time and always read back in the order they happened.
let written = 0;
const load = () => charmState(readEvents(mcDir), today);
function write(kind, extra = {}) {
  const event = { kind, when: new Date(at.getTime() + written++).toISOString() };
  if (extra.words) event.words = extra.words;
  if (extra.conversation) event.conversation = extra.conversation;
  appendEvent(mcDir, event, at);
}
// The end date has come and the finish is not written yet: write it first, so every command acts on
// the settled count (status on the end date says the finish line, never "0 days to go").
function settle() {
  const state = load();
  if (!state.needsFinish) return state;
  write("finish");
  return load();
}

class Refusal extends Error {
  constructor(reply, state) { super(reply); this.reply = reply; this.state = state; }
}
const refuse = (reply, state) => { throw new Refusal(reply, state); };
const done = (reply, state) => ({ reply, state });
function need(key, example) {
  if (typeof f[key] !== "string" || !f[key].trim()) die(`godspeed-charm ${cmd} needs --${key}, for example: ${example}`);
  return f[key];
}
const extras = () => ({ words: f.words, conversation: f.conversation });

const commands = {
  start() {
    const state = settle();
    if (!state.running) {
      write("start", extras());
      const fresh = load();
      return done(say.started(fresh.end), fresh);
    }
    // Already running: say how far it is and ask whether to start over. That question is a reset
    // question like any other, so it is opened in this conversation and a yes there starts over.
    if (f.conversation && !state.resetToday) {
      write("asked", extras());
      const asked = load();
      return done(say.alreadyRunning(asked), asked);
    }
    return done(say.alreadyRunning(state), state);
  },
  status() {
    const state = settle();
    if (isFinishDay(state, today)) return done(say.finish(state), state);
    if (state.running) return done(say.status(state), state);
    return done(say.notRunning(), state);
  },
  asked() {
    need("conversation", 'godspeed-charm asked --conversation telegram:123 --words "why is this garbage again"');
    const state = settle();
    if (!state.running) refuse(say.notRunning(), state);
    if (state.resetToday) refuse(say.resetToday(state), state);
    write("asked", extras());
    return done(say.question(), load());
  },
  answer() {
    const conversation = need("conversation", "godspeed-charm answer yes --conversation telegram:123");
    // The notebook and the Telegram buttons say yes or no; a model may pass only the person's words.
    const given = pos.length ? pos.join(" ") : f.words;
    if (given === undefined) die('godspeed-charm answer needs yes or no, for example: godspeed-charm answer yes --conversation telegram:123 --words "yes"');
    const state = settle();
    // Only the conversation that asked can answer (a bare yes elsewhere answers something else).
    if (!state.open.some((q) => q.conversation === conversation)) refuse(say.noOpenQuestion(), state);
    if (isYes(given)) {
      write("reset", extras());
      const after = load();
      return done(say.yes(after), after);
    }
    if (isNo(given)) {
      write("kept", extras());
      const after = load();
      return done(say.no(after), after);
    }
    return refuse(say.notAnAnswer(), state);
  },
  slip() {
    const words = need("words", 'godspeed-charm slip --words "charm slip"');
    const state = settle();
    if (!state.running) refuse(say.notRunning(), state);
    // Only a plain request resets without asking; a story about yelling at an AI gets the question.
    if (!isExplicitReset(words)) refuse(say.askFirst(), state);
    // Two resets on one day count as one restart; the second is not written at all.
    if (state.resetToday) return done(say.yes(state), state);
    write("reset", extras());
    const after = load();
    return done(say.yes(after), after);
  },
  stop() {
    const state = settle();
    if (!state.running) refuse(say.notRunning(), state);
    write("stop", extras());
    return done(say.stopped(), load());
  },
  // The morning brief's line. --no-write computes the same line without settling the finish, for a
  // rehearsal briefing that must not change the live record. Prints nothing when there is nothing.
  brief() {
    let state = load();
    if (state.needsFinish && !f["no-write"]) { write("finish"); state = load(); }
    const line = briefText(state, today, lang);
    if (f.json) return done(line, state);
    if (line) console.log(line);
    return null;
  },
  // The [godspeed-charm] block for the message about to be answered. Never an error: anything that
  // goes wrong means no block.
  context() {
    if (f.scheduled || process.env.GODSPEED_SCHEDULED_RUN) return null;
    let conversation = typeof f.conversation === "string" ? f.conversation : "";
    if (f.hook !== undefined) {
      if (f.hook !== "claude") return null;
      // Claude Code's print and SDK modes run scheduled jobs and assistant runtimes, not a person.
      if (/^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT || "")) return null;
      const input = JSON.parse(fs.readFileSync(0, "utf8"));
      if (!input || typeof input.session_id !== "string" || !input.session_id) return null;
      conversation = `claude:${input.session_id}`;
    }
    let state = load();
    if (state.needsFinish) { try { write("finish"); state = load(); } catch { /* said again on the next message */ } }
    const block = contextBlock(state, s, { conversation, today, language: lang });
    if (!block) return null;
    if (f.hook === "claude") console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: block } }));
    else process.stdout.write(block + "\n");
    return null;
  },
  config() {
    const [sub = "show", key, ...v] = pos;
    if (sub === "show") { console.log(JSON.stringify(s, null, 2)); return null; }
    if (sub === "get") {
      if (!["timezone", "language"].includes(key)) die('godspeed-charm config get timezone|language');
      console.log(String(s[key]));
      return null;
    }
    if (sub === "set") {
      if (!key || !v.length) die("godspeed-charm config set timezone|language <value>");
      try { setSetting(mcDir, key, v.join(" ")); } catch (e) { die(e.message); }
      console.log(`Changed: ${key} = ${v.join(" ").trim()}`);
      return null;
    }
    die("godspeed-charm config [show | get <key> | set <key> <value>]");
  },
  help() {
    console.log(fs.readFileSync(new URL("../README.md", import.meta.url), "utf8").split("## Use")[1]?.split("\n## ")[0]?.trim() || "See README.md");
    return null;
  },
};

try {
  if (!Object.hasOwn(commands, cmd)) die(`Unknown command "${cmd}". Try: godspeed-charm help`);
  if (!["help", "config"].includes(cmd)) today = localDate(at, s.timezone);
  const result = commands[cmd]();
  if (result) console.log(f.json ? JSON.stringify({ ok: true, reply: result.reply, state: result.state }) : result.reply);
} catch (e) {
  if (e instanceof Refusal) {
    if (f.json) console.log(JSON.stringify({ ok: false, reply: e.reply, state: e.state }));
    console.error(e.reply);
    process.exitCode = 2;
  } else die(`godspeed-charm: ${e.message}`);
}
