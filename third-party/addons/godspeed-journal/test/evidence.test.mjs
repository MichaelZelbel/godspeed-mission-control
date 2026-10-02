import assert from "node:assert/strict";
import test from "node:test";
import { platformsNamed, normalPlatform, judge, closingEntry, recordNeeds } from "../lib/evidence.mjs";
import { tasksFrom, openTasks } from "../lib/tasks.mjs";
import { dueMessages } from "../lib/tick.mjs";
import { contextBlock } from "../lib/context.mjs";
import { DEFAULTS } from "../lib/settings.mjs";

const S = { ...DEFAULTS, timezone: "Europe/Berlin", language: "de", nudge: { ...DEFAULTS.nudge, enabled: true }, evidence: { script: "record.mjs" } };
const E = (at, kind, extra = {}) => ({ at, kind, words: "", ...extra });
const TZ = S.timezone;

// The incident, 2026-09-28: the task exactly as the journal saved it, and the post exactly as
// Planino recorded it 26 minutes later. The journal asked about it the next afternoon anyway.
const substack = E("2026-09-28T20:09:27.240Z", "start", {
  task: "t-20260928-2209-substack-post-for-yesterday-s-video", title: "Substack post for yesterday's video",
  done_means: ["all Substack texts in the Planino Studio project", "post page open, ready to post tomorrow morning"],
});
const post = {
  platform: "substack", at: "2026-09-28T20:35:25.534Z", id: "b7d5bd04-7273-48c3-8390-cfe44e966ecc",
  url: "https://michaelzelbel.substack.com/p/my-ai-spent-75-days-on-sap-customer", title: "My AI Spent 75 Days on SAP Customer Support. I Wrote Nothing.",
};
const ASKED = new Date("2026-09-29T14:15:06.354Z"); // when the journal actually asked "still on it?"
const rec = (list, mentions = []) => ({ posts: { ok: true, list }, mentions });
const verdictsFor = (es, record, now = ASKED) => judge(openTasks(es), record, TZ, null);

test("a task names a platform only by a name that cannot mean anything else", () => {
  assert.deepEqual(platformsNamed({ title: "Substack post for yesterday's video" }), ["substack"]);
  assert.deepEqual(platformsNamed({ title: "Carousel", done_means: ["on Linked In"] }), ["linkedin"]);
  assert.deepEqual(platformsNamed({ title: "Chimney cleaner letter", done_means: ["letter on its way to him, by post or PDF"] }), []);
  assert.deepEqual(platformsNamed({ title: "X thread about Threads" }), []);
  assert.deepEqual(platformsNamed({ title: "Twitter thread" }), ["x"]);
  assert.equal(normalPlatform("instagram_reels"), "instagram");
  assert.equal(normalPlatform("YouTube_Shorts"), "youtube");
  assert.equal(normalPlatform("Twitter"), "x");
});

test("the incident: the Substack post closes the task with its link and nobody is asked", () => {
  const v = verdictsFor([substack], rec([post])).get(substack.task);
  assert.equal(v.kind, "closed");
  assert.equal(dueMessages([substack], S, ASKED, new Map([[substack.task, v]])).messages.length, 0);

  const close = closingEntry(tasksFrom([substack])[0], v.post, S);
  assert.equal(close.evidence, post.url);
  assert.match(close.words, /Substack-Beitrag "My AI Spent 75 Days/);
  assert.match(close.words, /2026-09-28 22:35/);
  const [t] = tasksFrom([substack, { ...close, at: "2026-09-28T20:45:00.000Z" }]);
  assert.equal(t.state, "done");
  assert.equal(t.ended, "2026-09-28T20:35:25.534Z"); // it ended when the post went out, not when the journal noticed
  assert.equal(t.evidence.url, post.url);
});

test("a task with nothing on record still gets its check-in, which says what was looked at and which day", () => {
  const v = verdictsFor([substack], rec([]));
  assert.equal(v.get(substack.task).kind, "none");
  const [m] = dueMessages([substack], S, ASKED, v).messages;
  assert.match(m, /^Aus deinem Tagebuch: Du hast gestern um 22:09 „Substack post for yesterday's video" angefangen\. Fertig ist es laut dir, wenn: all Substack texts in the Planino Studio project; post page open, ready to post tomorrow morning\. Auf Substack ist seitdem nichts erschienen\. Seitdem hast du nichts dazu notiert\.\nIst es erledigt, oder bist du noch dran\?/);
  // A task that names no platform: the same check-in, without a record sentence.
  const tofu = E("2026-09-28T20:09:27.240Z", "start", { task: "t-tofu", title: "Tofu" });
  const [t] = dueMessages([tofu], S, ASKED, verdictsFor([tofu], rec([]))).messages;
  assert.match(t, /^Aus deinem Tagebuch: Du hast gestern um 22:09 „Tofu" angefangen\. Seitdem hast du nichts dazu notiert\.\n/);
});

test("a post on another platform, or from before the task started, closes nothing", () => {
  for (const other of [{ ...post, platform: "linkedin" }, { ...post, at: "2026-09-28T20:00:00.000Z" }]) {
    const v = verdictsFor([substack], rec([other]));
    assert.equal(v.get(substack.task).kind, "none");
    assert.equal(dueMessages([substack], S, ASKED, v).messages.length, 1);
  }
});

test("when the record is not plain, the task is neither closed nor asked about", () => {
  const second = E("2026-09-28T20:20:00.000Z", "start", { task: "t-kit", title: "Substack welcome email" });
  const both = [substack, second];
  const shared = verdictsFor(both, rec([post]));
  assert.equal(shared.get(substack.task).kind, "unsure"); // two open tasks name Substack
  assert.equal(shared.get("t-kit").kind, "unsure");

  const twoPlatforms = { ...substack, title: "Substack post for yesterday's YouTube video" };
  assert.equal(verdictsFor([twoPlatforms], rec([post])).get(substack.task).kind, "unsure");

  const twoPosts = verdictsFor([substack], rec([post, { ...post, id: "p2", at: "2026-09-29T06:00:00.000Z" }]));
  assert.equal(twoPosts.get(substack.task).kind, "unsure");
  assert.equal(dueMessages([substack], S, ASKED, twoPosts).messages.length, 0);
});

test("a record that cannot be read holds the question about the platform task only", () => {
  const tofu = E("2026-09-28T20:09:27.240Z", "start", { task: "t-tofu", title: "Tofu" });
  const es = [substack, tofu];
  const v = judge(openTasks(es), { posts: { ok: false, error: "no answer" }, mentions: [] }, TZ);
  assert.equal(v.get(substack.task).kind, "unreadable");
  const { messages } = dueMessages(es, S, ASKED, v);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Tofu/);
  const evening = { ...S, nudge: { ...S.nudge, enabled: false }, evening: { enabled: true, at: "18:30" } };
  const list = dueMessages(es, evening, new Date("2026-09-29T16:31:00Z"), v).messages[0];
  assert.match(list, /• Tofu, angefangen gestern um 22:09/);
  assert.doesNotMatch(list, /Substack/);
});

test("words never close a task: a matching commit or event only holds the question", () => {
  // The event that really existed that night: the kit's Substack post from 2026-09-23, written up on
  // 2026-09-28. It shares "Substack" and "post" with the task and is a different post.
  const kit = { date: "2026-09-28", text: "substack kit texts approved and post published The two Substack kit obligations are done", source: "event" };
  const v = verdictsFor([substack], rec([], [kit])).get(substack.task);
  assert.equal(v.kind, "unsure");
  const crypto = E("2026-09-28T16:06:18.000Z", "start", { task: "t-crypto", title: "Monthly crypto transfer to Revolut" });
  const commit = { at: "2026-09-28T18:20:00+02:00", text: "Monthly crypto transfer to Revolut recorded", source: "commit" };
  assert.equal(verdictsFor([crypto], rec([], [commit])).get("t-crypto").kind, "unsure");
  // A one-word title is never matched by words, and a commit from before the start does not count.
  const tofu = E("2026-09-28T20:09:27.240Z", "start", { task: "t-tofu", title: "Tofu with egg" });
  assert.equal(verdictsFor([tofu], rec([], [{ at: "2026-09-28T21:00:00Z", text: "tofu", source: "commit" }])).get("t-tofu").kind, "none");
  assert.equal(verdictsFor([crypto], rec([], [{ ...commit, at: "2026-09-28T15:00:00Z" }])).get("t-crypto").kind, "none");
});

test("reopen undoes a close from the record, and that proof never closes it again", () => {
  const v = verdictsFor([substack], rec([post]));
  const close = { ...closingEntry(tasksFrom([substack])[0], v.get(substack.task).post, S), at: "2026-09-28T20:45:00.000Z" };
  const es = [substack, close, E("2026-09-29T08:00:00.000Z", "reopen", { task: substack.task, words: "that was the other post" })];
  const [t] = tasksFrom(es);
  assert.equal(t.state, "open"); assert.deepEqual(t.rejected, [post.id]);
  assert.equal(verdictsFor(es, rec([post])).get(substack.task).kind, "none");
});

test("the first close wins when two machines each close the same task", () => {
  const es = [substack, E("2026-09-28T21:00:00.000Z", "done", { task: substack.task }), E("2026-09-29T09:00:00.000Z", "done", { task: substack.task })];
  assert.equal(tasksFrom(es)[0].ended, "2026-09-28T21:00:00.000Z");
});

test("context: an open task with nothing on record is listed, and nothing is offered to ask about it", () => {
  const c = contextBlock([substack], S, new Date("2026-09-29T08:00:00Z"));
  assert.match(c, /since Mon 2026-09-28 22:09/);
  assert.doesNotMatch(c, /paused|side-asked|end your answer/i);
});

test("context: a task closed from the record is named as done, and the block never suggests asking about it", () => {
  const close = { ...closingEntry(tasksFrom([substack])[0], post, S), at: "2026-09-28T20:45:00.000Z" };
  const c = contextBlock([substack, close], S, new Date("2026-09-29T06:00:00Z"));
  assert.doesNotMatch(c, /side-asked/);
  assert.match(c, /- none/);
  assert.match(c, /Closed from the record, not by them\. Never ask whether these are done/);
  assert.match(c, /"Substack post for yesterday's video", closed at Mon 2026-09-28 22:45\. Belegt: .*substack\.com\/p\/my-ai-spent-75-days/);
  // Twelve hours on, the note is gone and so is the block.
  assert.equal(contextBlock([substack, close], S, new Date("2026-09-29T09:00:00Z")), "");
});

test("recordNeeds: only tasks that name a platform, since the oldest of them", () => {
  const tofu = E("2026-09-28T10:00:00.000Z", "start", { task: "t-tofu", title: "Tofu" });
  assert.equal(recordNeeds([tofu], ASKED), null);
  assert.deepEqual(recordNeeds([tofu, substack], ASKED), { since: substack.at, platforms: ["substack"] });
});
