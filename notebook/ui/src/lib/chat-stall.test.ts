import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {CHAT_STALL, watchForStall} from "./chat-stall";
import {AI_REFUSED, AI_UNREACHABLE} from "../../../core/no-ai.mjs";

// A chat send the AI took and never answered ends (#790): at once when the notebook's own checks
// say the AI fails, and at the latest just after the notebook's ten-minute answer budget.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const outcome = (watch: ReturnType<typeof watchForStall>) => {
  const seen: {error?: Error & {stalled?: boolean}} = {};
  watch.stalled.catch((error) => (seen.error = error));
  return seen;
};

it("ends a send once the AI has read as unreachable or refused for the grace time, with that reason", async () => {
  for (const [state, reason] of [["unreachable", AI_UNREACHABLE], ["refused", AI_REFUSED]] as const) {
    let current = "ready";
    const seen = outcome(watchForStall(() => current));
    await vi.advanceTimersByTimeAsync(30000);
    expect(seen.error).toBeUndefined();
    current = state;
    await vi.advanceTimersByTimeAsync(CHAT_STALL.graceMs - CHAT_STALL.everyMs);
    expect(seen.error).toBeUndefined();
    // Read each second, so it is seen within a second of the change.
    await vi.advanceTimersByTimeAsync(2 * CHAT_STALL.everyMs);
    expect(seen.error?.message).toBe(reason);
    expect(seen.error?.stalled).toBe(true);
  }
});

it("does not end a slow answer over a moment's failed check", async () => {
  let current = "ready";
  const seen = outcome(watchForStall(() => current));
  for (let i = 0; i < 20; i++) {
    current = "unreachable";
    await vi.advanceTimersByTimeAsync(CHAT_STALL.graceMs - 2 * CHAT_STALL.everyMs);
    current = "ready";
    await vi.advanceTimersByTimeAsync(CHAT_STALL.everyMs);
  }
  expect(seen.error).toBeUndefined();
});

it("ends a send nothing says has failed only after the notebook's own ten-minute budget", async () => {
  expect(CHAT_STALL.limitMs).toBeGreaterThan(600000);
  const seen = outcome(watchForStall(() => "ready"));
  await vi.advanceTimersByTimeAsync(600000);
  expect(seen.error).toBeUndefined();
  await vi.advanceTimersByTimeAsync(CHAT_STALL.limitMs - 600000);
  expect(seen.error?.message).toBe(AI_UNREACHABLE);
});

it("stops watching once the answer has come", async () => {
  const watch = watchForStall(() => "unreachable");
  const seen = outcome(watch);
  watch.stop();
  await vi.advanceTimersByTimeAsync(CHAT_STALL.limitMs);
  expect(seen.error).toBeUndefined();
});
