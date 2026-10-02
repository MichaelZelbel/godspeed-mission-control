// The few lines the model sees before it reads the person's message, so it knows what is open
// without searching. Printed by the Hermes plugin and the Claude Code hook on every turn, so it
// must be small and fast, and empty when there is nothing to know.
//
// It never asks the model to ask anything. Until 0.4.0 it offered a "side question" to add to the
// end of an answer about something else ("Is "X" (started 12:59) paused, or is this part of it?").
// On 29 and 30 September 2026 that line was added to unrelated answers seven times, often on a
// background job's report rather than on anything the person wrote, and not once did it get a
// useful answer: the person could not tell where it came from or what it meant. Asking now
// happens in one place only, the check-in and the evening list, each a message of its own that
// says in full what it is about (lib/text.mjs).
import { localParts, minutesBetween } from "./clock.mjs";
import { recentTasks, tasksFrom, looseEnds } from "./tasks.mjs";

// How long a task closed from the record is still named in the block: long enough that the
// next conversation knows it is done, short enough that the block does not grow.
const CLOSED_NOTE_MINUTES = 12 * 60;
// A loose end is named for a day after the finish, which covers that evening's list and the
// morning after, so "the letter's signed now" lands on the right task.
const LOOSE_NOTE_MINUTES = 24 * 60;

export function contextBlock(entries, s, now) {
  const open = recentTasks(entries, now);
  const closedFromRecord = tasksFrom(entries).filter((t) => t.evidence && t.evidence.closed <= now.toISOString() &&
    minutesBetween(new Date(t.evidence.closed), now) <= CLOSED_NOTE_MINUTES);
  const loose = looseEnds(entries).filter((t) => t.ended <= now.toISOString() && minutesBetween(new Date(t.ended), now) <= LOOSE_NOTE_MINUTES);
  if (!open.length && !closedFromRecord.length && !loose.length) return "";
  const hm = (iso) => localParts(new Date(iso), s.timezone).hm;
  // For the model: the time alone today, otherwise weekday, date and time.
  const when = (iso) => {
    const p = localParts(new Date(iso), s.timezone);
    return p.date === localParts(now, s.timezone).date ? p.hm : `${p.weekday[0].toUpperCase()}${p.weekday.slice(1)} ${p.date} ${p.hm}`;
  };
  const lines = [`[godspeed-journal] Open journal tasks (times in ${s.timezone}). Never ask about these yourself; the journal's own check-in and evening list do that:`];
  if (!open.length) lines.push("- none");
  for (const t of open) {
    const mins = minutesBetween(new Date(t.started), now);
    lines.push(`- ${t.id}: "${t.title}" since ${when(t.started)} (${mins} min); done means: ${t.done_means.length ? t.done_means.join("; ") : "NOT DEFINED"}`);
    if (t.lastNudge && minutesBetween(new Date(t.lastNudge), now) <= 12 * 60 && t.lastNudge >= t.last) {
      lines.push(`  The journal asked at ${when(t.lastNudge)} whether they are still on it. A short reply like "done", "still on it", "erledigt", "noch dran", or what they are doing instead, is a journal entry for this task.`);
    }
  }
  if (closedFromRecord.length) {
    lines.push("Closed from the record, not by them. Never ask whether these are done. If they bring one up, it is done already; if they say it is not, run: godspeed-journal reopen <id>");
    for (const t of closedFromRecord) lines.push(`- ${t.id}: "${t.title}", closed at ${when(t.evidence.closed)}. ${t.evidence.words}`);
  }
  if (loose.length) {
    lines.push(`Finished without something they said done includes. Never bring these up yourself. If they say one happened after all (or answer the evening list with done), run: godspeed-journal met <id> --met "<item>"`);
    for (const t of loose) lines.push(`- ${t.id}: "${t.title}", finished ${when(t.ended)}, without: ${t.missed.join("; ")}`);
  }
  lines.push(`Settings: feedback=${s.feedback}, length=${s.length}, ask_done_definition=${s.ask_done_definition}, prefix_required=${s.prefix_required}. Anything addressed to the journal follows the interstitial-journal recipe.`);
  return lines.join("\n");
}
