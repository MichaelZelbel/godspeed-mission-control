import { test } from "node:test";
import assert from "node:assert/strict";
import { charmState } from "../lib/count.mjs";
import { T, formatDay } from "../lib/texts.mjs";

const ev = (kind, date, extra = {}) => ({ kind, date, when: `${date}T09:00:00Z`, ...extra });
const state = (events, today) => charmState(events, today);

test("formatDay in both languages", () => {
  assert.equal(formatDay("2026-11-11", "en"), "Wednesday 11 November");
  assert.equal(formatDay("2026-11-12", "en"), "Thursday 12 November");
  assert.equal(formatDay("2026-11-11", "de"), "Mittwoch, 11. November");
  assert.equal(formatDay("2026-03-01", "de"), "Sonntag, 1. März");
});

test("start text", () => {
  const s = state([ev("start", "2026-10-21")], "2026-10-21");
  assert.equal(T.en.started(s.end), "Charm Challenge started. 21 days to go, done on Wednesday 11 November.");
});

test("status text: 12 days to go, longest run 9, restarts 2", () => {
  // start 10-01, reset 10-10 (a 9 day run), reset 10-21 (an 11 day run), today 10-30.
  const s = state([ev("start", "2026-10-01"), ev("reset", "2026-10-10"), ev("reset", "2026-10-21")], "2026-10-30");
  assert.equal(s.daysToGo, 12);
  assert.equal(s.end, "2026-11-11");
  assert.equal(s.restarts, 2);
  // The count's own longest run here is 11; the brief's figure of 9 is checked with it set.
  assert.equal(T.en.status({ ...s, longestRun: 9 }), "12 days to go, done on Wednesday 11 November. Longest run so far: 9 days. Restarts: 2.");
});

test("question, yes, no, brief, finish", () => {
  assert.equal(T.en.question(), "That sounded like a slip. Back to 21? Yes / No.");
  const reset = state([ev("start", "2026-10-01"), ev("reset", "2026-10-08"), ev("reset", "2026-10-15"), ev("reset", "2026-10-22")], "2026-10-22");
  assert.equal(reset.restarts, 3);
  assert.equal(T.en.yes(reset), "Back to 21. Done on Thursday 12 November. Restarts: 3.");
  const mid = state([ev("start", "2026-10-21")], "2026-10-30");
  assert.equal(T.en.no(mid), "Fair enough. Still 12 days to go.");
  assert.equal(T.en.briefLine(mid), "Charm Challenge: day 10 of 21, 12 days to go.");
  assert.equal(T.en.finish({ restarts: 2, kept: 3 }), "Charm Challenge done: 21 days. Restarts on the way: 2. You talked me out of 3 resets.");
});

test("singular forms, and no zero-resets sentence", () => {
  const one = { daysToGo: 1, longestRun: 1, restarts: 1, end: "2026-11-11", day: 21, kept: 1 };
  assert.equal(T.en.no(one), "Fair enough. Still 1 day to go.");
  assert.equal(T.en.status(one), "1 day to go, done on Wednesday 11 November. Longest run so far: 1 day. Restarts: 1.");
  assert.equal(T.en.briefLine(one), "Charm Challenge: day 21 of 21, 1 day to go.");
  assert.equal(T.en.finish(one), "Charm Challenge done: 21 days. Restarts on the way: 1. You talked me out of 1 reset.");
  assert.equal(T.en.finish({ restarts: 0, kept: 0 }), "Charm Challenge done: 21 days. Restarts on the way: 0.");
  assert.equal(T.de.finish({ restarts: 0, kept: 0 }), "Charm Challenge geschafft: 21 Tage. Neustarts unterwegs: 0.");
});

test("alreadyRunning asks, askFirst explains", () => {
  const mid = state([ev("start", "2026-10-21")], "2026-10-30");
  assert.equal(T.en.alreadyRunning(mid), "Charm Challenge is already running: day 10 of 21, 12 days to go. Start over from 21? Yes / No.");
  assert.match(T.en.askFirst(), /charm slip/);
  assert.match(T.en.askFirst(), /Yes \/ No/);
  assert.match(T.de.alreadyRunning(mid), /Ja \/ Nein/);
  assert.match(T.de.askFirst(), /charm slip/);
});

test("German texts", () => {
  const mid = state([ev("start", "2026-10-21")], "2026-10-30");
  assert.equal(T.de.started(mid.end), "Charm Challenge gestartet. Noch 21 Tage, fertig am Mittwoch, 11. November.");
  assert.equal(T.de.briefLine(mid), "Charm Challenge: Tag 10 von 21, noch 12 Tage.");
  assert.equal(T.de.no({ ...mid, daysToGo: 1 }), "Alles klar. Noch 1 Tag.");
});

test("no text has a long dash or a broken value", () => {
  const states = [
    state([ev("start", "2026-10-21")], "2026-10-30"),
    state([ev("start", "2026-10-21"), ev("reset", "2026-10-22"), ev("kept", "2026-10-23", { conversation: "c" })], "2026-10-23"),
  ];
  for (const lang of ["en", "de"]) {
    for (const [name, fn] of Object.entries(T[lang])) {
      for (const s of states) {
        const text = name === "started" ? fn(s.end) : fn(s);
        assert.equal(typeof text, "string", `${lang}.${name}`);
        assert.ok(!/[—–]/.test(text), `${lang}.${name}: ${text}`);
        assert.ok(!/undefined|NaN|null/.test(text), `${lang}.${name}: ${text}`);
      }
    }
  }
});

test("an unknown language falls back to English, never to nothing", () => {
  assert.equal(T.fr, T.en);
  assert.equal(T[undefined], T.en);
  assert.equal(T[""], T.en);
  assert.deepEqual(Object.keys(T), ["en", "de"]);
});

test("the German start-over question reads naturally", () => {
  const mid = state([ev("start", "2026-10-21")], "2026-10-30");
  assert.equal(T.de.alreadyRunning(mid), "Die Charm Challenge läuft schon: Tag 10 von 21, noch 12 Tage. Noch mal von vorn mit 21 Tagen? Ja / Nein.");
});

test("the refusals added with the command", () => {
  const reset = state([ev("start", "2026-10-21"), ev("reset", "2026-10-30")], "2026-10-30");
  assert.equal(T.en.resetToday(reset), "There was a reset today already, so nothing changed. Still 21 days to go.");
  assert.equal(T.de.resetToday(reset), "Heute gab es schon einen Neustart, also hat sich nichts geändert. Noch 21 Tage.");
  assert.equal(T.en.notAnAnswer(), "That was neither a yes nor a no, so the question stays open.");
  assert.equal(T.de.notAnAnswer(), "Das war weder ein Ja noch ein Nein, also bleibt die Frage offen.");
});
