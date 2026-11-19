// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { NOTE_MODIFYING_TOOLS, aiWorkedAt, recordAIWorked, unansweredReason, withSummary } from "./chat-history";

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

it("a message that got no answer keeps its reason only while the AI still fails and no later message is answered", () => {
  const failed = {role: "user" as const, content: "Fictional question", lastFailure: "Your AI could not be reached.", failedAt: 2000};
  const reply = {role: "assistant" as const, content: "Fictional answer"};
  const followUp = {role: "user" as const, content: "Fictional follow-up"};
  expect(unansweredReason([failed], 0, "unreachable")).toBe("Your AI could not be reached.");
  expect(unansweredReason([failed], 0, "refused")).toBe("Your AI could not be reached.");
  expect(unansweredReason([failed, followUp], 0, "unreachable")).toBe("Your AI could not be reached.");
  expect(unansweredReason([failed, reply], 0, "unreachable")).toBeNull();
  expect(unansweredReason([failed, followUp, reply], 0, "unreachable")).toBeNull();
  for (const state of ["ready", "none", "settings-only", "checking"]) expect(unansweredReason([failed], 0, state)).toBeNull();
  expect(unansweredReason([{role: "user", content: "Fictional question"}], 0, "unreachable")).toBeNull();
  // A note belongs to its failure: once the AI has worked after it, a later outage does not bring it back (#821).
  expect(unansweredReason([failed], 0, "unreachable", 1999)).toBe("Your AI could not be reached.");
  expect(unansweredReason([failed], 0, "unreachable", 2000)).toBeNull();
  expect(unansweredReason([failed], 0, "refused", 5000)).toBeNull();
});

it("records when the AI last worked, and never moves it back", () => {
  localStorage.clear();
  expect(aiWorkedAt()).toBe(0);
  recordAIWorked(3000);
  recordAIWorked(1000);
  expect(aiWorkedAt()).toBe(3000);
  localStorage.clear();
});
