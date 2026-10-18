import assert from "node:assert/strict";
import test from "node:test";
import { tasksFrom, openTasks, resolveTask, looseEnds } from "../lib/tasks.mjs";
import { dueMessages } from "../lib/tick.mjs";
import { contextBlock } from "../lib/context.mjs";
import { weekReport, renderWeek, countedTime, wordsReport, renderWords } from "../lib/report.mjs";
import { DEFAULTS } from "../lib/settings.mjs";

const S = { ...DEFAULTS, timezone: "Europe/Berlin", nudge: { ...DEFAULTS.nudge, enabled: true } };
const E = (at, kind, extra = {}) => ({ at, kind, words: "", ...extra });
const start = E("2026-09-22T08:40:00.000Z", "start", { task: "t-v", title: "Edit video", done_means: ["thumbnail", "description"] });

test("a start opens a task, done closes it with met and missed", () => {
  const es = [start, E("2026-09-22T11:00:00.000Z", "done", { task: "t-v", met: ["thumbnail"], missed: ["description"] })];
  const [t] = tasksFrom(es);
  assert.equal(t.state, "done"); assert.deepEqual(t.missed, ["description"]);
  assert.equal(openTasks(es).length, 0);
});

test("define adds to the done definition; nudges do not count as activity", () => {
  const es = [start, E("2026-09-22T09:00:00.000Z", "define", { task: "t-v", done_means: ["uploaded"] }), E("2026-09-22T12:00:00.000Z", "nudge", { task: "t-v" })];
  const [t] = tasksFrom(es);
  assert.deepEqual(t.done_means, ["thumbnail", "description", "uploaded"]);
  assert.equal(t.last, "2026-09-22T09:00:00.000Z"); assert.equal(t.nudges, 1);
});

test("resolveTask: empty ref is newest open, else id, else title words", () => {
  const es = [start, E("2026-09-22T09:00:00.000Z", "start", { task: "t-k", title: "Ko-fi page" })];
  assert.equal(resolveTask(es, "").id, "t-k");
  assert.equal(resolveTask(es, "t-v").id, "t-v");
  assert.equal(resolveTask(es, "VIDEO").id, "t-v");
  assert.equal(resolveTask(es, "nothing"), null);
});

test("resolveTask: a word matching several open tasks is ambiguous, not the oldest one", () => {
  const es = [
    E("2026-09-22T08:00:00.000Z", "start", { task: "t-va", title: "Edit video A" }),
    E("2026-09-22T09:00:00.000Z", "start", { task: "t-vb", title: "Edit video B" }),
  ];
  const r = resolveTask(es, "video");
  assert.deepEqual(r.ambiguous, ["Edit video A", "Edit video B"]);
  assert.equal(resolveTask(es, "video A").id, "t-va");
});

test("resolveTask: a closed task is not found by id unless includeClosed", () => {
  const es = [start, E("2026-09-22T11:00:00.000Z", "done", { task: "t-v" })];
  assert.equal(resolveTask(es, "t-v"), null);
  assert.equal(resolveTask(es, "t-v", { includeClosed: true }).id, "t-v");
});

test("tick: silent before the threshold, one nudge after, never a second", () => {
  assert.deepEqual(dueMessages([start], S, new Date("2026-09-22T10:00:00Z")).messages, []);
  const due = dueMessages([start], S, new Date("2026-09-22T11:45:00Z"));
  assert.equal(due.messages.length, 1);
  // The whole message, because the point is that it reads cold on a phone: where it comes from,
  // which task and when, what done meant, the question, the replies and what silence does.
  assert.equal(due.messages[0], [
    'From your journal: today at 10:40 you started "Edit video". You said it is done when: thumbnail; description. Nothing about it has been noted since.',
    'Is it done, or are you still on it? Reply "done" and I\'ll check it against what you said done means, reply "still on it" and it stays open, or tell me what you\'re doing instead. No reply is fine: it stays open and I won\'t ask about it again.',
  ].join("\n"));
  assert.equal(due.records[0].kind, "nudge");
  const after = [start, { ...due.records[0], at: "2026-09-22T11:45:00.000Z" }];
  assert.deepEqual(dueMessages(after, S, new Date("2026-09-22T16:00:00Z")).messages, []);
});

test("tick: nudges off, quiet hours and day-old tasks stay silent", () => {
  const off = { ...S, nudge: { ...S.nudge, enabled: false } };
  assert.deepEqual(dueMessages([start], off, new Date("2026-09-22T11:45:00Z")).messages, []);
  assert.deepEqual(dueMessages([start], S, new Date("2026-09-22T19:30:00Z")).messages.filter((m) => m.startsWith("From your journal: ")), []); // 21:30 Berlin
  assert.deepEqual(dueMessages([start], S, new Date("2026-09-23T10:00:00Z")).messages.filter((m) => m.startsWith("From your journal: ")), []);
});

test("tick: evening list once a day, recorded even when nothing is open", () => {
  const at = new Date("2026-09-22T16:31:00Z"); // 18:31 Berlin
  const quiet = { ...S, nudge: { ...S.nudge, enabled: false }, evening: { ...S.evening, enabled: true } };
  const one = dueMessages([start], quiet, at);
  assert.equal(one.messages.length, 1);
  assert.equal(one.messages[0], [
    "From your journal, still open:",
    "• Edit video, started today at 10:40",
    'Reply "done" or "drop" with a name, for example "done Edit video". Anything you don\'t mention stays as it is, and no reply is fine.',
  ].join("\n"));
  assert.equal(one.records[0].kind, "evening");
  const done = [start, { ...one.records[0], at: at.toISOString() }];
  assert.deepEqual(dueMessages(done, quiet, new Date("2026-09-22T17:30:00Z")).messages, []);
  const none = dueMessages([], quiet, at);
  assert.deepEqual(none.messages, []); assert.equal(none.records[0].kind, "evening");
});

test("tick speaks German when asked", () => {
  const de = { ...S, language: "de" };
  assert.equal(dueMessages([start], de, new Date("2026-09-22T11:45:00Z")).messages[0], [
    "Aus deinem Tagebuch: Du hast heute um 10:40 „Edit video\" angefangen. Fertig ist es laut dir, wenn: thumbnail; description. Seitdem hast du nichts dazu notiert.",
    "Ist es erledigt, oder bist du noch dran? Antworte „erledigt\", dann prüfe ich es gegen das, was du als fertig festgelegt hast, „noch dran\", dann bleibt es offen, oder schreib, woran du stattdessen arbeitest. Keine Antwort ist auch in Ordnung: Es bleibt offen, und ich frage nicht noch einmal danach.",
  ].join("\n"));
});

test("tick: the check-in names a later note, the day of an older task, and a second chance when one is left", () => {
  const es = [
    E("2026-09-21T18:00:00.000Z", "start", { task: "t-o", title: "Tax return" }), // Mon 20:00 Berlin
    E("2026-09-21T19:00:00.000Z", "note", { task: "t-o", words: "halfway" }),
  ];
  const twice = { ...S, nudge: { ...S.nudge, max_per_task: 2, quiet_hours: "" } };
  const m = dueMessages(es, twice, new Date("2026-09-21T23:30:00Z")).messages[0]; // Tue 01:30 Berlin
  assert.match(m, /^From your journal: yesterday at 20:00 you started "Tax return"\. Your last note about it was yesterday at 21:00\.\n/);
  assert.doesNotMatch(m, /done when/); // no definition, so none is invented
  assert.match(m, /it stays open, and I'll ask once more later\.$/);
});

test("context: empty when nothing is open, names the task and a missing definition", () => {
  assert.equal(contextBlock([], S, new Date("2026-09-22T11:00:00Z")), "");
  const bare = E("2026-09-22T08:40:00.000Z", "start", { task: "t-b", title: "Taxes" });
  const c = contextBlock([bare], S, new Date("2026-09-22T11:00:00Z"));
  assert.match(c, /t-b: "Taxes" since 10:40 \(140 min\)/); assert.match(c, /done means: NOT DEFINED/);
  assert.match(c, /Never ask about these yourself/);
});

test("context: a recent nudge tells the model a short reply belongs to that task", () => {
  const es = [start, E("2026-09-22T11:45:00.000Z", "nudge", { task: "t-v" })];
  assert.match(contextBlock(es, S, new Date("2026-09-22T12:00:00Z")), /asked at 13:45/);
});

test("context: never hands the model a question to add to an answer about something else", () => {
  // 2026-09-30: the block offered 'Is "Clean up Claude sessions in VS Code" (started 12:59) paused,
  // or is this part of it?' and a session copied it onto the end of an unrelated report. Asking
  // is the check-in's job, in a message of its own.
  const es = [
    start,
    E("2026-09-22T09:00:00.000Z", "start", { task: "t-k", title: "Ko-fi page" }),
  ];
  const c = contextBlock(es, S, new Date("2026-09-22T15:00:00Z"));
  assert.match(c, /"Edit video"/); assert.match(c, /"Ko-fi page"/);
  assert.doesNotMatch(c, /paused|side-asked|end your answer|If this message is about something else/i);
});

test("week report counts time, catches and answered nudges", () => {
  const es = [
    start, E("2026-09-22T11:45:00.000Z", "nudge", { task: "t-v" }), E("2026-09-22T11:50:00.000Z", "note", { task: "t-v", words: "still on it" }),
    E("2026-09-22T12:40:00.000Z", "done", { task: "t-v", missed: ["description"] }),
  ];
  const r = weekReport(es, S, new Date("2026-09-22T20:00:00Z"));
  assert.equal(r.byTitle[0].minutes, 240); assert.equal(r.catches, 1); assert.equal(r.nudgesSent, 1); assert.equal(r.nudgesAnswered, 1);
  assert.match(renderWeek(r, S), /Edit video: 4h 00m/);
});

// Counted time (0.3.0). The incident: a task started at 22:09 and closed by hand after midnight
// the next day read "26h 11m" in the week report the work talk was going to read.
test("counted time: a task's clock stops when another task starts", () => {
  const es = [
    E("2026-09-22T08:00:00.000Z", "start", { task: "t-a", title: "A" }),
    E("2026-09-22T09:00:00.000Z", "start", { task: "t-b", title: "B" }),
    E("2026-09-22T09:30:00.000Z", "done", { task: "t-b" }),
    E("2026-09-22T11:00:00.000Z", "done", { task: "t-a" }),
  ];
  const m = countedTime(es, new Date("2026-09-22T12:00:00Z"));
  assert.equal(m.get("t-a").minutes, 60); assert.equal(m.get("t-b").minutes, 30);
  assert.equal(m.get("t-a").cut, false);
});

test("counted time: a note about an open task puts its clock back on", () => {
  const es = [
    E("2026-09-22T08:00:00.000Z", "start", { task: "t-a", title: "A" }),
    E("2026-09-22T09:00:00.000Z", "start", { task: "t-b", title: "B" }),
    E("2026-09-22T09:30:00.000Z", "done", { task: "t-b" }),
    E("2026-09-22T09:30:00.000Z", "note", { task: "t-a", words: "back on A" }),
    E("2026-09-22T11:00:00.000Z", "done", { task: "t-a" }),
  ];
  assert.equal(countedTime(es, new Date("2026-09-22T12:00:00Z")).get("t-a").minutes, 150);
});

test("counted time: more than four hours without an entry stops the clock, and says the time is unknown", () => {
  const es = [
    E("2026-09-28T20:09:27.240Z", "start", { task: "t-s", title: "Substack post for yesterday's video" }),
    E("2026-09-29T14:15:06.354Z", "nudge", { task: "t-s", source: "tick" }),
    E("2026-09-29T14:07:11.637Z", "start", { task: "t-d", title: "Start My Day journal" }),
    E("2026-09-29T14:41:27.000Z", "done", { task: "t-d" }),
    E("2026-09-29T22:20:47.387Z", "done", { task: "t-s", source: "cli" }),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const m = countedTime(es, new Date("2026-09-30T10:00:00Z"));
  assert.deepEqual(m.get("t-s"), { minutes: 0, cut: true });
  assert.equal(m.get("t-d").minutes, 34);
  const r = weekReport(es, S, new Date("2026-09-30T10:00:00Z"));
  const text = renderWeek(r, S);
  assert.doesNotMatch(text, /26h/);
  assert.match(text, /No time counted .*Substack post for yesterday's video/);
  assert.match(text, /Start My Day journal: 0h 34m/);
  assert.match(renderWeek(r, { ...S, language: "de" }), /Keine Zeit gezählt .*Substack post/);
});

test("counted time: a silence after some work keeps that work and says at least", () => {
  const es = [
    E("2026-09-22T08:00:00.000Z", "start", { task: "t-a", title: "A" }),
    E("2026-09-22T09:00:00.000Z", "note", { task: "t-a", words: "halfway" }),
    E("2026-09-22T20:00:00.000Z", "done", { task: "t-a" }),
  ];
  assert.deepEqual(countedTime(es, new Date("2026-09-22T21:00:00Z")).get("t-a"), { minutes: 60, cut: true });
  assert.match(renderWeek(weekReport(es, S, new Date("2026-09-22T21:00:00Z")), S), /A: at least 1h 00m/);
});

test("counted time: a task closed from the record ends when the proof happened, not when it was closed", () => {
  const es = [
    E("2026-09-28T20:09:27.240Z", "start", { task: "t-s", title: "Substack post" }),
    E("2026-09-29T22:15:00.000Z", "done", { task: "t-s", source: "evidence", evidence: "https://x.substack.com/p/y", evidence_at: "2026-09-28T20:35:25.000Z" }),
  ];
  assert.deepEqual(countedTime(es, new Date("2026-09-30T10:00:00Z")).get("t-s"), { minutes: 26, cut: false });
});

test("words: what they said this week, in their own words, never the machinery", () => {
  const es = [
    E("2026-09-29T14:07:11.000Z", "note", { task: "t-trial", words: "Since the morning I've just been putting out fires." }),
    E("2026-09-28T12:20:00.000Z", "start", { task: "t-trial", title: "Interstitial journaling trial", words: "Interstitial journaling trial" }),
    E("2026-09-29T15:20:37.000Z", "start", { task: "t-l", title: "Chimney cleaner letter", words: "Now the chimney cleaner letter." }),
    E("2026-09-29T16:17:37.000Z", "done", { task: "t-l", missed: ["letter signed"], words: "Okay, that took longer than I thought." }),
    E("2026-09-29T16:30:10.000Z", "evening", { source: "tick", words: "t-trial" }),
    E("2026-09-29T20:00:00.000Z", "mark", { task: "t-l", words: "side-asked" }),
    E("2026-09-29T21:00:00.000Z", "done", { task: "t-x", source: "evidence", words: "On record: the post went out." }),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const list = wordsReport(es, S, new Date("2026-09-30T10:00:00Z"), 7);
  assert.deepEqual(list.map((w) => w.kind), ["note", "start", "done"]);
  assert.equal(list[0].title, "Interstitial journaling trial");
  const text = renderWords(list, S);
  assert.match(text, /Tue 2026-09-29/);
  assert.match(text, /16:07 note on "Interstitial journaling trial": Since the morning/);
  assert.match(text, /18:17 done "Chimney cleaner letter": Okay, that took longer/);
  assert.doesNotMatch(text, /side-asked|On record/);
  assert.equal(wordsReport(es, S, new Date("2026-10-09T10:00:00Z"), 7).length, 0);
});

test("met: an item left out at the finish that happened after all moves from missed to met", () => {
  const es = [
    E("2026-09-29T15:20:37.000Z", "start", { task: "t-l", title: "Chimney cleaner letter", done_means: ["letter written", "letter signed", "letter scanned"] }),
    E("2026-09-29T16:17:37.000Z", "done", { task: "t-l", met: ["letter written"], missed: ["letter signed", "letter scanned"] }),
    E("2026-09-29T19:00:00.000Z", "met", { task: "t-l", met: ["letter signed"] }),
  ];
  const [t] = tasksFrom(es);
  assert.equal(t.state, "done");
  assert.deepEqual(t.missed, ["letter scanned"]); assert.deepEqual(t.met, ["letter written", "letter signed"]);
  assert.deepEqual(looseEnds(es).map((x) => x.id), ["t-l"]);
  assert.deepEqual(looseEnds([...es, E("2026-09-29T19:01:00.000Z", "met", { task: "t-l", met: ["letter scanned"] })]), []);
});

test("evening list: what was left out at a finish is shown once, then never again", () => {
  const ev = { ...S, nudge: { ...S.nudge, enabled: false }, evening: { enabled: true, at: "18:30" } };
  const es = [
    E("2026-09-29T15:20:37.000Z", "start", { task: "t-l", title: "Chimney cleaner letter" }),
    E("2026-09-29T16:17:37.000Z", "done", { task: "t-l", missed: ["letter signed", "letter scanned"] }),
  ];
  const first = dueMessages(es, ev, new Date("2026-09-29T16:31:00Z"));
  assert.equal(first.messages.length, 1);
  assert.equal(first.messages[0], [
    "From your journal: you finished these without everything you said done includes:",
    "• Chimney cleaner letter, missing: letter signed, letter scanned",
    'If one of them happened after all, reply "done" with its name, for example "done Chimney cleaner letter". No reply is fine; they won\'t be listed again.',
  ].join("\n"));
  const next = [...es, { ...first.records[0], at: "2026-09-29T16:31:00.000Z" }];
  assert.deepEqual(dueMessages(next, ev, new Date("2026-09-30T16:31:00Z")).messages, []);
  const de = dueMessages(es, { ...ev, language: "de" }, new Date("2026-09-29T16:31:00Z"));
  assert.match(de.messages[0], /^Aus deinem Tagebuch: Diese Aufgaben hast du abgeschlossen, aber ohne alles, was du als fertig festgelegt hattest:\n• Chimney cleaner letter, es fehlte: letter signed, letter scanned\nFalls etwas davon/);
  const settled = [...es, E("2026-09-29T16:20:00.000Z", "met", { task: "t-l", met: ["letter signed", "letter scanned"] })];
  assert.deepEqual(dueMessages(settled, ev, new Date("2026-09-29T16:31:00Z")).messages, []);
});

test("evening list: open tasks and loose ends together, each said in full", () => {
  const ev = { ...S, nudge: { ...S.nudge, enabled: false }, evening: { enabled: true, at: "18:30" } };
  const es = [
    start,
    E("2026-09-22T09:00:00.000Z", "start", { task: "t-l", title: "Letter" }),
    E("2026-09-22T10:00:00.000Z", "done", { task: "t-l", missed: ["scanned"] }),
  ];
  const m = dueMessages(es, ev, new Date("2026-09-22T16:31:00Z")).messages[0];
  assert.equal(m, [
    "From your journal, still open:",
    "• Edit video, started today at 10:40",
    "Finished, but without everything you said done includes:",
    "• Letter, missing: scanned",
    'Reply "done" or "drop" with a name, for example "done Edit video". Anything you don\'t mention stays as it is, and no reply is fine.',
  ].join("\n"));
});

test("context: loose ends of the last day are named with the command, and never to be raised", () => {
  const es = [
    E("2026-09-29T15:20:37.000Z", "start", { task: "t-l", title: "Chimney cleaner letter" }),
    E("2026-09-29T16:17:37.000Z", "done", { task: "t-l", missed: ["letter signed"] }),
  ];
  const c = contextBlock(es, S, new Date("2026-09-29T18:00:00Z"));
  assert.match(c, /Never bring these up yourself/);
  assert.match(c, /t-l: "Chimney cleaner letter", finished 18:17, without: letter signed/);
  assert.match(c, /godspeed-journal met <id> --met "<item>"/);
  assert.equal(contextBlock(es, S, new Date("2026-09-30T18:00:00Z")), "");
});
