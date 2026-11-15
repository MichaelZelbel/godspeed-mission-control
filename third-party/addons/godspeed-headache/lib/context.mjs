// The lines the model sees before it reads the person's message, so "headache over" or "took
// another pill" lands on the right headache without a search. Empty when nothing is open.
import { describe } from "./report.mjs";

export function contextBlock(episodes, s, now) {
  const open = episodes.filter((e) => e.open);
  if (!open.length) return "";
  const L = [`[godspeed-headache] Open headache${open.length > 1 ? "s" : ""} (times in ${s.timezone}):`];
  for (const e of open) {
    L.push(`- ${e.id}: ${describe(e, s.timezone, now)}`);
    if (now - Date.parse(e.start) > 20 * 3600000) L.push(`  Open for more than 20 hours: it probably ended and was not closed. If this message is about headaches, ask once when it ended.`);
  }
  L.push("\"Headache over\", a pill, a pain level or a side belongs to the open headache; follow the headache-tracker recipe.");
  return L.join("\n");
}
