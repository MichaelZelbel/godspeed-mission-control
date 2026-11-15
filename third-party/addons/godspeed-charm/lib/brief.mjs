// The one line the morning brief carries, written here and put in word for word (the cycle
// tracker's heads-up line is the model). Pure: the command decides whether the finish is written.
import { T } from "./texts.mjs";

// The finish day: the end date has come and the finish is not written yet, or it was written today.
// The finish line is said all of that day (the brief, the first message), never on a later one.
export const isFinishDay = (state, today) => Boolean(state.needsFinish || (state.finishedOn && state.finishedOn === today));

// The line for today: the finish line on the finish day, the count while it runs, else "".
export function briefText(state, today, lang = "en") {
  if (isFinishDay(state, today)) return T[lang].finish(state);
  if (state.running) return T[lang].briefLine(state);
  return "";
}
