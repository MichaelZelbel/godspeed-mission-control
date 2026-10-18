// What is due right now. Pure: it returns the messages and the records that prove they went
// out, and the caller writes the records. Run every 15 minutes by the scheduler; empty
// output is the normal case and makes the scheduler stay silent.
//
// `verdicts` is what the record showed for each open task (lib/evidence.mjs), read by the caller
// just before. A task the record closed, is unsure about, or could not be read for is not asked
// about: not in a check-in and not in the evening list. A task with nothing on record is asked,
// and the check-in says what was looked at.
import { localParts, minutesBetween, inQuietHours, whenSaid } from "./clock.mjs";
import { openTasks, recentTasks, looseEnds } from "./tasks.mjs";
import { T } from "./text.mjs";
import { recordLine } from "./evidence.mjs";
import { weekReport, renderWeek } from "./report.mjs";

const DAY = 24 * 60;
const HELD = new Set(["closed", "unsure", "unreadable"]);

export function dueMessages(entries, s, now, verdicts = new Map()) {
  const messages = []; const records = [];
  const lp = localParts(now, s.timezone);
  const when = (iso) => whenSaid(iso, now, s.timezone, s.language);
  const held = (t) => HELD.has(verdicts.get(t.id)?.kind);
  const doneToday = (kind) => entries.some((e) => e.kind === kind && localParts(new Date(e.at), s.timezone).date === lp.date);

  if (s.nudge.enabled && !inQuietHours(lp.hm, s.nudge.quiet_hours)) {
    for (const t of openTasks(entries)) {
      if (t.nudges >= s.nudge.max_per_task) continue;
      if (minutesBetween(new Date(t.started), now) > DAY) continue;
      const last = t.lastNudge && t.lastNudge > t.last ? t.lastNudge : t.last;
      if (minutesBetween(new Date(last), now) < s.nudge.after_minutes) continue;
      if (held(t)) continue;
      messages.push(T(s).nudge({
        title: t.title, when: when(t.started), doneMeans: t.done_means,
        record: recordLine(verdicts.get(t.id), T(s)),
        lastNote: t.last > t.started ? when(t.last) : "",
        last: t.nudges + 1 >= s.nudge.max_per_task,
      }));
      records.push({ kind: "nudge", task: t.id, words: "" });
    }
  }

  // Loose ends are what a finish since the last evening list left out of its done definition.
  // Each is named in exactly one evening list; after that only `met` (it happened after all) or
  // the person's own memory brings it back.
  if (s.evening.enabled && lp.hm >= s.evening.at && !doneToday("evening")) {
    const open = recentTasks(entries, now).filter((t) => !held(t));
    const lastEvening = entries.filter((e) => e.kind === "evening" && new Date(e.at) < now).at(-1);
    const from = lastEvening ? new Date(lastEvening.at) : new Date(now.getTime() - DAY * 60000);
    const loose = looseEnds(entries).filter((t) => new Date(t.ended) > from && new Date(t.ended) <= now);
    if (open.length || loose.length) {
      messages.push(T(s).evening(open.map((t) => ({ title: t.title, when: when(t.started) })), loose.map((t) => ({ title: t.title, missed: t.missed }))));
    }
    const words = [open.map((t) => t.id).join(" "), loose.length ? `loose: ${loose.map((t) => t.id).join(" ")}` : ""].filter(Boolean).join("; ");
    records.push({ kind: "evening", words: words || "none open" });
  }

  if (s.weekly.enabled && lp.weekday === s.weekly.day && lp.hm >= s.weekly.at && !doneToday("weekly")) {
    const r = weekReport(entries, s, now);
    if (r.byTitle.length) messages.push(T(s).weekly(renderWeek(r, s)));
    records.push({ kind: "weekly", words: r.byTitle.length ? "sent" : "empty week" });
  }
  return { messages, records };
}
