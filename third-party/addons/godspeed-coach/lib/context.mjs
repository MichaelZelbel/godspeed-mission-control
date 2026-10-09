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
      L.push(`- Waiting talk: ${area.title} (id for commands: ${area.slug}), opened ${when}, record coach/${area.slug}/talks/${ymd}.md. There is no messenger, so they have not seen it yet: it waited for this chat. First answer their message; then bring the talk up in a short sentence or two that make sense on their own and end with its question. It opened with: "${clean(talk.sections["The opening"])}". Bring it up once, in this reply only. Their answer continues it: follow the coach recipe, "Continuing a talk".`);
      continue;
    }
    L.push(`- Open talk: ${area.title} (id for commands: ${area.slug}), opened ${when}, record coach/${area.slug}/talks/${ymd}.md${talk.followUp ? ", follow-up sent" : ""}. Their reply continues it: follow the coach recipe, "Continuing a talk".`);
  }
  const asked = active.filter((h) => askedOn(h, today) && !answerOn(h, today));
  if (asked.length) L.push(`- Habit check sent tonight, still unanswered, asking in this order: ${asked.map((h) => h.title).join(", ")}. A short yes / no / skip answers it: follow the coach recipe, "Tracking a habit".`);
  if (active.length) L.push(`- Active habits: ${active.map((h) => `${h.title} (id for commands: ${h.slug}${answerOn(h, today) ? `; today: ${answerOn(h, today)}` : ""})`).join("; ")}. "Track <habit>" or "did <habit>" tracks one.`);
  return L.join("\n");
}
