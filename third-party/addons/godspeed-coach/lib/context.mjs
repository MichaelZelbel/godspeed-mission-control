// The lines the model sees before it reads the person's message, on every interface: which talk is
// waiting for his reply, which habit question went out tonight, and which habits exist, so "yes" at
// 21:10 and "track head lifts" at noon both land in the right place. Empty when there is nothing.
//
// Written for the model, never to be passed on: the plain name comes first, and an id is marked as
// being for commands only, so it does not reach the person as "head-lifts". Nothing here is a
// sentence to relay or a question to add; the coach's own messages do the asking (lib/tick.mjs).
import { localParts, whenSaid } from "./clock.mjs";
import { openTalks } from "./talks.mjs";
import { listHabits, askedOn, answerOn } from "./habits.mjs";

export function contextBlock(mcDir, s, now) {
  const tz = s.timezone;
  const today = localParts(now, tz).date;
  const talks = openTalks(mcDir, now);
  const active = listHabits(mcDir, { status: "active" });
  if (!talks.length && !active.length) return "";
  const L = [`[godspeed-coach] For you, not to pass on (times in ${tz}). The coach sends its own habit check and talk follow-up, so never raise a habit or a talk in a reply about something else.`];
  for (const { area, ymd, talk } of talks) {
    const when = talk.opened ? whenSaid(talk.opened, now, tz) : ymd;
    L.push(`- Open talk: ${area.title} (id for commands: ${area.slug}), opened ${when}, record coach/${area.slug}/talks/${ymd}.md${talk.followUp ? ", follow-up sent" : ""}. Their reply continues it: follow the coach recipe, "Continuing a talk".`);
  }
  const asked = active.filter((h) => askedOn(h, today) && !answerOn(h, today));
  if (asked.length) L.push(`- Habit check sent tonight, still unanswered, asking in this order: ${asked.map((h) => h.title).join(", ")}. A short yes / no / skip answers it: follow the coach recipe, "Tracking a habit".`);
  if (active.length) L.push(`- Active habits: ${active.map((h) => `${h.title} (id for commands: ${h.slug}${answerOn(h, today) ? `; today: ${answerOn(h, today)}` : ""})`).join("; ")}. "Track <habit>" or "did <habit>" tracks one.`);
  return L.join("\n");
}
