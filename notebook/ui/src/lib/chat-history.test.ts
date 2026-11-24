// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { AI_REFUSED, AI_UNREACHABLE, NO_AI_CHAT } from "../../../core/no-ai.mjs";
import { NOTE_MODIFYING_TOOLS, NO_ANSWER_AI_WORKS, unansweredNote, unansweredReason, withSummary } from "./chat-history";
import { AI_UNREADABLE } from "../../../core/no-ai.mjs";

// The note chat reports what it did by tool name (domains.mjs): update_note
// for a text change, update_note_metadata, trash_note. A name missing here
// left the editor showing the note as it was before the chat changed it.
describe("NOTE_MODIFYING_TOOLS", () => {
  it("names every change the note chat reports", () => {
    for (const tool of ["update_note", "update_note_metadata", "trash_note"]) {
      expect(NOTE_MODIFYING_TOOLS).toContain(tool);
    }
  });
});

it("a summary from an earlier session cannot return after Clear, even when the new chat is longer", () => {
  const state = {session_id: "fresh-session", messages: Array.from({length: 24}, () => ({role: "user" as const, content: "New conversation"})), summary: "", summarizedUpTo: 0};
  expect(withSummary(state, "Earlier conversation summary", 8, 20, "old-session")).toBe(state);
});

it("a message that got no answer keeps its reason until the next message is the AI's answer, whatever the AI's state", () => {
  const failed = {role: "user" as const, content: "Fictional question", lastFailure: "Your AI could not be reached."};
  const reply = {role: "assistant" as const, content: "Fictional answer"};
  const followUp = {role: "user" as const, content: "Fictional follow-up"};
  expect(unansweredReason([failed], 0, "unreachable")).toBe(AI_UNREACHABLE);
  expect(unansweredReason([failed], 0, "checking")).toBe("Your AI could not be reached.");
  expect(unansweredReason([failed], 0, "ready")).toBe(NO_ANSWER_AI_WORKS);
  expect(unansweredReason([failed, followUp], 0, "unreachable")).toBe(AI_UNREACHABLE);
  expect(unansweredReason([failed, followUp, reply], 0, "unreachable")).toBe(AI_UNREACHABLE);
  expect(unansweredReason([failed, reply], 0, "unreachable")).toBeNull();
  expect(unansweredReason([{role: "user", content: "Fictional question"}], 0, "unreachable")).toBeNull();
  expect(unansweredReason([reply], 0, "unreachable")).toBeNull();
});

it("a kept note names the AI's current state, never the state its stored reason came from", () => {
  const stored = (lastFailure: string) => ({role: "user" as const, content: "Fictional question", lastFailure});
  const reasons = [NO_AI_CHAT, AI_REFUSED, AI_UNREACHABLE];
  for (const reason of reasons) {
    const m = [stored(reason)];
    expect(unansweredNote(m, 0, "none")).toEqual({text: NO_AI_CHAT, plain: true});
    expect(unansweredNote(m, 0, "refused")).toEqual({text: AI_REFUSED, plain: false});
    expect(unansweredNote(m, 0, "unreachable")).toEqual({text: AI_UNREACHABLE, plain: false});
    expect(unansweredNote(m, 0, "ready")).toEqual({text: NO_ANSWER_AI_WORKS, plain: false});
  }
});

it("a message whose answer could not be used keeps its reason in every state, until answered", () => {
  const reason = AI_UNREADABLE;
  const failed = {role: "user" as const, content: "Fictional question", lastFailure: reason};
  const reply = {role: "assistant" as const, content: "Fictional answer"};
  for (const state of ["ready", "refused", "unreachable", "settings-only", "none", "checking"]) expect(unansweredNote([failed], 0, state)).toEqual({text: reason, plain: false});
  expect(unansweredReason([failed, reply], 0, "ready")).toBeNull();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
