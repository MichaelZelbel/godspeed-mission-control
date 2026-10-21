import { test } from "node:test";
import assert from "node:assert/strict";
import { charmState } from "../lib/count.mjs";
import { contextBlock } from "../lib/context.mjs";
import { briefText, isFinishDay } from "../lib/brief.mjs";

const ev = (kind, date, extra = {}) => ({ kind, date, when: `${date}T09:00:00Z`, ...extra });
const S = { version: 1, timezone: "Europe/Berlin", language: "en" };
const running = (extra = [], today = "2026-10-30") => charmState([ev("start", "2026-10-21"), ...extra], today);
const block = (state, opts = {}) => contextBlock(state, S, { today: "2026-10-30", ...opts });

test("empty when scheduled, when nothing runs, after a stop, and after the finish day", () => {
  assert.equal(block(running(), { conversation: "telegram:1", scheduled: true }), "");
  assert.equal(block(charmState([], "2026-10-30"), { conversation: "telegram:1" }), "");
  assert.equal(block(running([ev("stop", "2026-10-29")]), { conversation: "telegram:1" }), "");
  const finished = charmState([ev("start", "2026-10-01"), ev("finish", "2026-10-22")], "2026-10-30");
  assert.equal(block(finished, { conversation: "telegram:1" }), "");
});

test("while running: the day, the end date, the rule and how to record the question", () => {
  const b = block(running(), { conversation: "telegram:1" });
  assert.ok(b.startsWith("[godspeed-charm]"));
  assert.match(b, /day 10 of 21, 12 days to go, done on Wednesday 11 November/);
  assert.match(b, /insults, sarcasm, contempt, "why do you give me this garbage\?"/);
  assert.match(b, /The deadline is wrong\. Check the client's message and fix the draft\./);
  assert.ok(b.includes('"That sounded like a slip. Back to 21? Yes / No."'));
  assert.ok(b.includes('"Das klang nach einem Ausrutscher. Zurück auf 21? Ja / Nein."'));
  assert.match(b, /When unsure, ask/);
  assert.match(b, /at most once per message/i);
  assert.match(b, /Never lecture/);
  assert.match(b, /traffic/);
  assert.ok(b.includes('godspeed-charm asked --conversation "telegram:1" --words "<their words>"'));
  assert.ok(b.includes('godspeed-charm slip --words "<their words>"'));
  assert.match(b, /--language de/);
  assert.doesNotMatch(b, /Open question/);
});

test("the open question shows only in its own conversation", () => {
  const s = running([ev("asked", "2026-10-30", { conversation: "telegram:1", words: "why do you give me this garbage?" })]);
  const own = block(s, { conversation: "telegram:1" });
  assert.match(own, /why do you give me this garbage\?" earlier today/);
  assert.ok(own.includes('godspeed-charm answer yes --conversation "telegram:1" --words "<their words>"'));
  assert.ok(own.includes('godspeed-charm answer no --conversation "telegram:1" --words "<their words>"'));
  assert.match(own, /Anything else leaves it open/);
  const other = block(s, { conversation: "telegram:2" });
  assert.doesNotMatch(other, /garbage\?" earlier/);
  assert.doesNotMatch(other, /answer yes/);
  assert.doesNotMatch(other, /Open question/);
  assert.match(other, /12 days to go/);
});

test("a reset today: no asking about slips today", () => {
  const s = charmState([ev("start", "2026-10-21"), ev("reset", "2026-10-30")], "2026-10-30");
  const b = block(s, { conversation: "telegram:1" });
  assert.match(b, /A reset already happened today: don't ask about slips today\./);
  assert.doesNotMatch(b, /asked --conversation/);
  assert.doesNotMatch(b, /That sounded like a slip/);
  assert.match(b, /21 days to go/);
});

test("the finish day: the finish line once, a new round, the sticker, no slip question", () => {
  const due = charmState([ev("start", "2026-10-21"), ev("kept", "2026-10-25", { conversation: "c" })], "2026-11-11");
  assert.equal(due.needsFinish, true);
  const b = contextBlock(due, S, { conversation: "telegram:1", today: "2026-11-11" });
  assert.ok(b.startsWith("[godspeed-charm]"));
  assert.ok(b.includes('"Charm Challenge done: 21 days. Restarts on the way: 0. You talked me out of 1 reset."'));
  assert.ok(b.includes('"Charm Challenge geschafft: 21 Tage. Neustarts unterwegs: 0. Du hast mich einmal vom Zurücksetzen abgebracht."'));
  assert.match(b, /unless you already said it in this conversation/);
  assert.match(b, /new round/);
  assert.match(b, /\[\[sticker:party\]\]/);
  assert.match(b, /hermes-telegram-stickers/);
  assert.doesNotMatch(b, /That sounded like a slip/);
  assert.doesNotMatch(b, /asked --conversation/);
  // Written already: the same, on that day only.
  const written = charmState([ev("start", "2026-10-21"), ev("finish", "2026-11-11")], "2026-11-11");
  assert.match(contextBlock(written, S, { conversation: "telegram:1", today: "2026-11-11" }), /Charm Challenge done: 21 days/);
  assert.equal(contextBlock(written, S, { conversation: "telegram:1", today: "2026-11-12" }), "");
});

test("German first when the language is German, English stays beside it", () => {
  const due = charmState([ev("start", "2026-10-21")], "2026-11-11");
  const b = contextBlock(due, { ...S, language: "de" }, { conversation: "c", today: "2026-11-11" });
  assert.ok(b.indexOf("Charm Challenge geschafft") < b.indexOf("Charm Challenge done"));
  const en = contextBlock(due, { ...S, language: "de" }, { conversation: "c", today: "2026-11-11", language: "en" });
  assert.ok(en.indexOf("Charm Challenge done") < en.indexOf("Charm Challenge geschafft"));
});

test("without a conversation: no recording, and a bare yes or no answers nothing here", () => {
  const s = running([ev("asked", "2026-10-30", { conversation: "telegram:1", words: "garbage" })]);
  const b = block(s, {});
  assert.match(b, /12 days to go/);
  assert.match(b, /bare yes or no cannot answer/);
  assert.match(b, /charm slip/);
  assert.doesNotMatch(b, /asked --conversation/);
  assert.doesNotMatch(b, /answer yes/);
});

test("their words are kept short and on one line", () => {
  const long = "x".repeat(500) + "\nsecond line";
  const s = running([ev("asked", "2026-10-30", { conversation: "c", words: long })]);
  const b = block(s, { conversation: "c" });
  const line = b.split("\n").find((l) => l.startsWith("Open question"));
  assert.ok(line.length < 600, line.length);
  assert.doesNotMatch(line, /second line/);
});

test("no long dashes, no broken values, in any block", () => {
  const states = [
    [running(), "2026-10-30"],
    [running([ev("asked", "2026-10-30", { conversation: "c", words: "w" })]), "2026-10-30"],
    [charmState([ev("start", "2026-10-21"), ev("reset", "2026-10-30")], "2026-10-30"), "2026-10-30"],
    [charmState([ev("start", "2026-10-21")], "2026-11-11"), "2026-11-11"],
  ];
  for (const language of ["en", "de"]) for (const conversation of ["c", undefined]) for (const [s, today] of states) {
    const b = contextBlock(s, { ...S, language }, { conversation, today });
    assert.ok(b.length > 0);
    assert.ok(!/[—–]/.test(b), b);
    assert.ok(!/undefined|NaN|null/.test(b), b);
  }
});

test("the brief text: the line, the finish line, or nothing", () => {
  assert.equal(briefText(running(), "2026-10-30", "en"), "Charm Challenge: day 10 of 21, 12 days to go.");
  assert.equal(briefText(running(), "2026-10-30", "de"), "Charm Challenge: Tag 10 von 21, noch 12 Tage.");
  assert.equal(briefText(running(), "2026-10-30", "fr"), "Charm Challenge: day 10 of 21, 12 days to go.");
  const due = charmState([ev("start", "2026-10-21")], "2026-11-11");
  assert.equal(isFinishDay(due, "2026-11-11"), true);
  assert.equal(briefText(due, "2026-11-11", "en"), "Charm Challenge done: 21 days. Restarts on the way: 0.");
  const written = charmState([ev("start", "2026-10-21"), ev("finish", "2026-11-11")], "2026-11-11");
  assert.equal(briefText(written, "2026-11-11", "en"), "Charm Challenge done: 21 days. Restarts on the way: 0.");
  assert.equal(briefText(written, "2026-11-12", "en"), "");
  assert.equal(briefText(charmState([], "2026-11-12"), "2026-11-12", "en"), "");
});
