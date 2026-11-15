import { describe, it, expect } from "vitest";
import { NOTE_MODIFYING_TOOLS, withSummary } from "./chat-history";

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
