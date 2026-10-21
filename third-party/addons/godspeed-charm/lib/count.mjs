// The count: a pure function from the event list to the Charm Challenge state.
// Dates are YYYY-MM-DD strings (the person's local day); all arithmetic goes through Date.UTC,
// so the answer never depends on the machine's time zone or on daylight saving.
export const LENGTH = 21;

const DAY = 86400000;
const toMs = (d) => { const [y, m, n] = d.split("-").map(Number); return Date.UTC(y, m - 1, n); };

export const addDays = (date, n) => new Date(toMs(date) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);

export function charmState(events, today) {
  // Read in time order, so events synced from two machines still count right.
  const all = events.map((e, i) => [e, i]).sort((a, b) => String(a[0].when ?? "").localeCompare(String(b[0].when ?? "")) || a[1] - b[1]).map((p) => p[0]);
  let from = -1;
  all.forEach((e, i) => { if (e.kind === "start") from = i; });

  const state = {
    running: false, started: null, challengeStarted: null, end: null, day: null, daysToGo: null,
    restarts: 0, longestRun: 0, kept: 0, resetToday: false, needsFinish: false, finishedOn: null, open: [],
  };
  if (from < 0) return state;

  const run = all.slice(from);
  let runStart = run[0].date;
  let longest = 0, ended = null, finishedOn = null;
  const resetDates = new Set();
  const asked = []; // open questions, in the order asked

  for (const e of run.slice(1)) {
    if (ended) break; // after a stop or finish only a new start counts, and that begins a new list
    if (e.kind === "reset") {
      if (resetDates.has(e.date)) continue; // one restart per local day
      resetDates.add(e.date);
      longest = Math.max(longest, daysBetween(runStart, e.date));
      runStart = e.date;
      asked.length = 0; // a reset answers every open question
      state.resetToday = state.resetToday || e.date === today;
    } else if (e.kind === "kept") {
      state.kept++;
      const at = asked.findIndex((a) => a.conversation === (e.conversation ?? ""));
      if (at >= 0) asked.splice(at, 1);
    } else if (e.kind === "asked") {
      if (e.date === today) asked.push({ conversation: e.conversation ?? "", words: e.words ?? "", when: e.when });
    } else if (e.kind === "finish") {
      ended = e.date; finishedOn = e.date;
    } else if (e.kind === "stop") {
      ended = e.date;
    }
  }

  const end = addDays(runStart, LENGTH);
  const until = ended ?? today;
  longest = Math.max(longest, Math.min(daysBetween(runStart, until), LENGTH));
  state.restarts = resetDates.size;
  state.longestRun = longest;
  state.started = runStart;
  state.challengeStarted = run[0].date;
  state.end = end;
  state.finishedOn = finishedOn;
  state.running = !ended;
  if (state.running) {
    const elapsed = daysBetween(runStart, today);
    // Past the end without a finish written yet: stay at the last day, zero to go, until the finish is recorded.
    state.day = Math.min(elapsed + 1, LENGTH);
    state.daysToGo = Math.max(LENGTH - elapsed, 0);
    state.needsFinish = today >= end;
    state.open = asked;
  }
  return state;
}
