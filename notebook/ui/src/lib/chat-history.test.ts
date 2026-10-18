import { describe, it, expect } from "vitest";
import { NOTE_MODIFYING_TOOLS } from "./chat-history";

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
