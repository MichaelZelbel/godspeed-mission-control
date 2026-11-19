import {AI_REFUSED, AI_UNREACHABLE} from "../../../core/no-ai.mjs";

// A CHAT SEND THE AI TOOK AND NEVER ANSWERED ENDS (#790, 19 November 2026). The chats waited for
// the answer with no limit: an AI that accepted the request and then stopped answering left the
// spinner turning for minutes and the question with no reason. A request is not streamed, so a slow
// answer and a stalled AI look alike while it is waiting. Two things tell them apart:
// - the AI's state, which every chat surface already reads each second (ChatConnectionEmptyState):
//   when the notebook's own connection checks say the AI is refused or cannot be reached for
//   `graceMs` while the answer is still awaited, the send has stalled and ends with that reason;
// - `limitMs`, a backstop just past the notebook's own ten-minute budget for a chat answer
//   (core/runtime.mjs), after which the notebook has answered every request it will answer.
// A stall reads as an outage (#771), with the same sentence the notebook says for one.
export const CHAT_STALL = {graceMs: 15000, limitMs: 630000, everyMs: 1000};

export type StallWatch = {stalled: Promise<never>; stop: () => void};

export function watchForStall(readState: () => string, {graceMs, limitMs, everyMs} = CHAT_STALL): StallWatch {
  const started = Date.now();
  let failingSince: number | null = null, timer: ReturnType<typeof setInterval> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setInterval(() => {
      const now = Date.now(), state = readState();
      if (state === "refused" || state === "unreachable") failingSince ??= now;
      else failingSince = null;
      const reason = failingSince !== null && now - failingSince >= graceMs ? (state === "refused" ? AI_REFUSED : AI_UNREACHABLE)
        : now - started >= limitMs ? AI_UNREACHABLE : null;
      if (!reason) return;
      clearInterval(timer);
      reject(Object.assign(new Error(reason), {stalled: true}));
    }, everyMs);
  });
  stalled.catch(() => {});
  return {stalled, stop: () => clearInterval(timer)};
}
