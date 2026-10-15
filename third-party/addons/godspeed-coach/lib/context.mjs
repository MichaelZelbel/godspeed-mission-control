// The lines the model sees before it reads the person's message, on every interface: which talk is
// waiting for his reply, which habit question went out tonight, and which habits exist, so "yes" at
// 21:10 and "track head lifts" at noon both land in the right place. Empty when there is nothing.
//
// Written for the model, never to be passed on: the plain name comes first, and an id is marked as
// being for commands only, so it does not reach the person as "head-lifts". Nothing here is a
// sentence to relay or a question to add; the coach's own messages do the asking (lib/tick.mjs).
//
// One exception, without a messenger (talk_delivery "chat", a mission control on a computer with no
// Telegram): a talk that came due was opened, but its opening reached no phone. The first time the
// block is read in a conversation with them after that, it asks the assistant to bring the talk up,
// and says so only once (SHOWN in the talk's record, written by the caller through shownNow). A
// scheduled run is not a conversation with them, so it never uses up that once.
import { localParts, whenSaid } from "./clock.mjs";
import { openTalks } from "./talks.mjs";
import { listHabits, askedOn, answerOn } from "./habits.mjs";

const clean = (t) => String(t || "").replace(/\s+/g, " ").trim();

// The open talks that wait for this conversation: no messenger, no reply yet, not shown before.
// The capture of 14 October 2026: with the health talk open, "Can we do the psychology talk now?" was
// saved as an answer to it, because the block said every reply continues it. A request for another
// talk starts that talk and leaves this one as it is.
const OTHER_TALK = 'A message that asks for another talk ("can we do the work talk now?") starts that talk instead and leaves this one open: "A talk they start themselves".';

// An open talk also carries its opening as sent and what was prepared for it, so a talk continued
// anywhere (the capture of 14 October 2026: in Claude Code, the work talk re-read its record, its
// area, the due list and the journal, four commands on his screen before a word to him) is answered
// from here. At most about TALK_CHARS of it, since the block comes with every message for the three
// days a talk stays open; whole prepared lines are cut, never half of one. A waiting talk's line
// already quotes its opening, so it gets only what was prepared.
export const TALK_CHARS = 1500;
const cut = (t, n) => (t.length > n ? t.slice(0, n - 3).replace(/\s+\S*$/, "") + "..." : t);

// How to go on, after what the talk carries. The recipe alone did not steer a chat model: in the
// Telegram test of 15 October 2026 "Why should I move the date?" got two paragraphs, and "What
// else do you have for me?" got dating matches from another add-on's block. This block comes with
// every message, so it says it here, in three short sentences. `prep`: the prepared talk file, read
// once when they ask for something the card lacks; `from`: what the talk's suggestions come from.
export const ANSWER_LENGTH = "  Every answer is one or two sentences, and a suggestion is one sentence.";
export function goOn({ prep = "", from = "what was prepared" } = {}) {
  return [
    `  Everything needed to continue this talk is here: answer from it without running commands or looking things up, unless they ask for something it lacks${prep ? ` (then read ${prep} once)` : ""}.`,
    `  While this talk is open, a question like "what else do you have?", "what do you suggest?" or "what should I do?" is about this talk: answer from ${from}.`,
    ANSWER_LENGTH,
  ];
}

// A talk opened from a prepared talk (0.4.0, lib/prep.mjs) keeps that file's talk card as its
// Prepared section: the card is carried whole, line by line as it was written, up to CARD_CHARS,
// with the file that holds the depth behind it.
export const CARD_CHARS = 1600;
export function talkCard(talk, max = CARD_CHARS) {
  const lines = String(talk.sections.Prepared || "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
  const L = [`  Talk card, prepared ahead (the short version; ${talk.prep} holds the depth):`];
  let room = max;
  for (const l of lines) {
    const line = `  ${l}`;
    if (line.length + 1 > room) { L.push(L.length === 1 ? cut(line, room) : "  ..."); break; }
    L.push(line); room -= line.length + 1;
  }
  L.push(...goOn({ prep: talk.prep, from: "the card's moves" }));
  return L;
}

// A talk opened before 0.3.0 has no Prepared section: one brief, when they ask, has the research.
export function talkMaterial(talk, slug, { max = TALK_CHARS, opening = true } = {}) {
  const first = cut(clean(talk.sections["The opening"]), Math.min(max, 700));
  const said = !opening ? [] : [first ? `  It opened with: "${first}"` : "  No opening is recorded."];
  if (talk.prep) return [...said, ...talkCard(talk)];
  const items = String(talk.sections.Prepared || "").split("\n").map((l) => clean(l.replace(/^\s*[-*]\s+/, ""))).filter(Boolean);
  if (!items.length) return [...said, `  Nothing else was prepared. If they ask what else there is, run \`godspeed-coach brief ${slug}\` once and answer from its sections "What the research found for ..."; this talk stays the open one, so open no other.`, ANSWER_LENGTH];
  const L = [...said, "  Prepared, for when they ask what else there is:"];
  const head = L.length;
  let room = max - L.join("\n").length - 1;
  for (const item of items) {
    const line = `  - ${item}`;
    if (line.length > room) { if (L.length === head) L.push(cut(line, room)); break; }
    L.push(line); room -= line.length + 1;
  }
  L.push(...goOn());
  return L;
}

export function waitingTalks(mcDir, s, now, { scheduled = false } = {}) {
  if (s.talk_delivery !== "chat" || scheduled) return [];
  return openTalks(mcDir, now).filter(({ talk }) => !talk.answered && !talk.shown);
}

export function contextBlock(mcDir, s, now, { scheduled = false } = {}) {
  const tz = s.timezone;
  const today = localParts(now, tz).date;
  const talks = openTalks(mcDir, now);
  const waiting = new Set(waitingTalks(mcDir, s, now, { scheduled }).map((t) => t.talk.file));
  const active = listHabits(mcDir, { status: "active" });
  if (!talks.length && !active.length) return "";
  const L = [`[godspeed-coach] For you, not to pass on (times in ${tz}). The coach sends its own habit check and talk follow-up, so never raise a habit or a talk in a reply about something else${waiting.size ? ", except a talk marked waiting below" : ""}.`];
  for (const { area, ymd, talk } of talks) {
    const when = talk.opened ? whenSaid(talk.opened, now, tz) : ymd;
    if (waiting.has(talk.file)) {
      L.push(`- Waiting talk: ${area.title} (id for commands: ${area.slug}), opened ${when}, record coach/${area.slug}/talks/${ymd}.md. There is no messenger, so they have not seen it yet: it waited for this chat. First answer their message; then bring the talk up in a short sentence or two that make sense on their own and end with its question. It opened with: "${clean(talk.sections["The opening"])}". Bring it up once, in this reply only. An answer to it continues it: follow the coach recipe, "Continuing a talk". ${OTHER_TALK}`, ...talkMaterial(talk, area.slug, { opening: false }));
      continue;
    }
    L.push(`- Open talk: ${area.title} (id for commands: ${area.slug}), opened ${when}, record coach/${area.slug}/talks/${ymd}.md${talk.followUp ? ", follow-up sent" : ""}. A reply to it continues it: follow the coach recipe, "Continuing a talk". ${OTHER_TALK}`, ...talkMaterial(talk, area.slug));
  }
  const asked = active.filter((h) => askedOn(h, today) && !answerOn(h, today));
  if (asked.length) L.push(`- Habit check sent tonight, still unanswered, asking in this order: ${asked.map((h) => h.title).join(", ")}. A short yes / no / skip answers it: follow the coach recipe, "Tracking a habit".`);
  if (active.length) L.push(`- Active habits: ${active.map((h) => `${h.title} (id for commands: ${h.slug}${answerOn(h, today) ? `; today: ${answerOn(h, today)}` : ""})`).join("; ")}. "Track <habit>" or "did <habit>" tracks one.`);
  return L.join("\n");
}
