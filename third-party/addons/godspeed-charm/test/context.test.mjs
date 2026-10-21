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
  // A start while it runs opens its question here, so the conversation goes with it.
  assert.ok(b.includes('godspeed-charm start --conversation "telegram:1" --words "<their words>"'));
  // Only a success is passed on word for word; a refusal's text never reaches the person.
  assert.match(b, /When a godspeed-charm command succeeds, use its reply word for word\. When it refuses, never pass its text on; do what this note says\./);
  assert.doesNotMatch(b, /After a godspeed-charm command, reply with its reply/);
  // A story slip: slip refuses, then asked, and the reply ends with asked's reply.
  assert.ok(b.includes('When it refuses, run godspeed-charm asked --conversation "telegram:1" --words "<their words>" and end your reply with its reply.'));
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
  assert.ok(b.includes('godspeed-charm slip --words "<their words>" and use its reply'));
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
  // The finish line and the offer of a new round together, once per conversation.
  const once = b.split("\n").find((l) => l.startsWith("Once in this conversation"));
  assert.ok(once, b);
  assert.match(once, /skip this if you already did it here/);
  assert.match(once, /Charm Challenge done: 21 days/);
  assert.match(once, /offer a new round/);
  assert.ok(b.includes('godspeed-charm start --conversation "telegram:1" --words "<their words>"'));
  // No sticker unless the caller says the sticker plugin is there (R13).
  assert.doesNotMatch(b, /sticker/i);
  const withStickers = contextBlock(due, S, { conversation: "telegram:1", today: "2026-11-11", stickers: true });
  assert.match(withStickers, /\[\[sticker:party\]\]/);
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

test("their words are quoted safely, and a question without words reads without them", () => {
  const nested = running([ev("asked", "2026-10-30", { conversation: "c", words: 'he said "fix it" or else' })]);
  const line = block(nested, { conversation: "c" }).split("\n").find((l) => l.startsWith("Open question"));
  assert.ok(line.includes('after their words "he said \\"fix it\\" or else" earlier today'), line);
  for (const words of [undefined, "", "   "]) {
    const bare = running([ev("asked", "2026-10-30", { conversation: "c", ...(words === undefined ? {} : { words }) })]);
    const l = block(bare, { conversation: "c" }).split("\n").find((x) => x.startsWith("Open question"));
    assert.ok(l, "the open question is still named");
    assert.doesNotMatch(l, /""/);
    assert.doesNotMatch(l, /after their words/);
    assert.match(l, /earlier today you asked whether to go back to 21/);
    assert.match(l, /answer yes --conversation "c"/);
  }
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
  for (const language of ["en", "de"]) for (const conversation of ["c", undefined]) for (const stickers of [false, true]) for (const [s, today] of states) {
    const b = contextBlock(s, { ...S, language }, { conversation, today, stickers });
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
