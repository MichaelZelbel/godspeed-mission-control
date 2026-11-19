// @vitest-environment jsdom
// A new note's two boxes are named (#742): its title and its text, which is
// what a person fills in after pressing New Note. Runs the real editor
// against a real notebook in a process of its own.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";
import { expectFieldsNamed } from "@/test/field-labels";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" }, session: { user: { id: "owner" } } }) }));

Object.defineProperty(window, "matchMedia", { writable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }) });
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};
const noRect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) });
Range.prototype.getBoundingClientRect ??= noRect as any;
Range.prototype.getClientRects ??= (() => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] })) as any;
document.elementFromPoint ??= () => null;

let notebook: RealNotebook;
beforeAll(async () => {
  notebook = await startNotebook();
  vi.stubGlobal("fetch", notebook.fetch);
}, 120_000);
afterAll(async () => {
  cleanup();
  const { unsavedNotes } = await import("@/lib/unsaved-notes");
  unsavedNotes.shutdown();
  vi.unstubAllGlobals();
  await notebook?.stop();
});

const NOTE_COLUMNS = "id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, folder_path, is_external, sync_status, structured_fields, related, ai_visibility, processing_status, processed_at, processing_error, created_at, updated_at";

describe("a new, empty note", () => {
  it("names its title box and its text box", async () => {
    const id = `new-note-labels-${Date.now().toString(36)}`;
    // What New Note makes: a note with no title and no text.
    await notebook.query({ table: "notes", operation: "insert", values: { id, title: "", content: "" }, selection: "id", single: true });
    const { NoteEditor } = await import("./NoteEditor");
    const { supabase } = await import("@/integrations/supabase/client");
    const { data: note, error } = await supabase.from("notes").select(NOTE_COLUMNS).eq("id", id).single();
    expect(error).toBeNull();
    const { container } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><NoteEditor note={note as any} /></MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    expectFieldsNamed(container, [
      { name: "Note title", is: (el) => el.tagName === "INPUT" },
      { name: "Note text", is: (el) => el.classList.contains("ProseMirror") && el.getAttribute("contenteditable") === "true" },
    ]);
    expect(screen.getByRole("textbox", { name: "Note text" })).toHaveAttribute("aria-multiline", "true");
  }, 60_000);
});
