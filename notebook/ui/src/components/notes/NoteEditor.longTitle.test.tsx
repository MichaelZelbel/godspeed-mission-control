// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";
import { WAIT } from "@/test/wait-limits";

// Issue #987 / #791 (19 November 2026): in a new note, typing a title and pressing
// Enter did not move on to the note's text; the next words joined the title
// ("Garden planPlant tomatoes in May…"). These run the real editor against a
// real notebook: a title is typed, Enter pressed, text typed where the cursor
// then is, and the title and the text must come out separate.

vi.mock("sonner", () => {
  const quiet = () => vi.fn(() => 0);
  return { toast: Object.assign(quiet(), { success: quiet(), error: quiet(), info: quiet(), warning: quiet(), loading: quiet(), dismiss: vi.fn() }) };
});
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
  await import("./NoteEditor");
}, 120_000);
afterAll(async () => { await notebook?.stop(); });
afterEach(async () => {
  act(() => { window.dispatchEvent(new Event("pagehide")); });
  cleanup();
  const { unsavedNotes } = await import("@/lib/unsaved-notes");
  unsavedNotes.shutdown();
  try { window.localStorage.clear(); } catch { /* none */ }
  vi.unstubAllGlobals();
});

const NOTE_COLUMNS = "id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, folder_path, is_external, sync_status, structured_fields, related, ai_visibility, processing_status, processed_at, processing_error, created_at, updated_at";
let seq = 0;
async function seedNote(title: string, content: string) {
  const id = `title-enter-${Date.now().toString(36)}-${++seq}`;
  await notebook.query({ table: "notes", operation: "insert", values: { id, title, content, folder_path: "Garden" }, selection: "id", single: true });
  return id;
}
const stored = (id: string) => notebook.query({ table: "notes", operation: "select", selection: "id, title, content", filters: [["eq", "id", id]], single: true });

async function openNote(id: string) {
  vi.resetModules();
  vi.stubGlobal("fetch", notebook.fetch);
  const { NoteEditor } = await import("./NoteEditor");
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.from("notes").select(NOTE_COLUMNS).eq("id", id).single();
  if (error) throw new Error(error.message);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><NoteEditor key={data.id} note={data as any} /></MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull(), WAIT);
  return (document.querySelector(".ProseMirror") as any).editor;
}

const LONG = "Zebrafinch meeting with Anna Lindqvist about the garden project";

// jsdom has no layout, so the wrapped height is stood in for by a scrollHeight
// that grows as the title's text is longer than one line of `width` px.
function stubLayout(width: number) {
  const perLine = Math.max(8, Math.floor(width / 14));
  Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLTextAreaElement) { return Math.ceil(Math.max(1, this.value.length) / perLine) * 32; },
  });
}

describe("A note's long title is shown in full (#987)", () => {
  for (const width of [320, 1280]) {
    it(`at ${width}px the title wraps and the field grows to show every line`, async () => {
      stubLayout(width);
      const id = await seedNote(LONG, "Body.");
      await openNote(id);
      const title = screen.getByRole("textbox", { name: "Note title" });
      // A one-line input cuts the title mid-word; a wrapping field does not.
      expect(title.tagName).toBe("TEXTAREA");
      expect((title as HTMLTextAreaElement).value).toBe(LONG);
      const lines = Math.ceil(LONG.length / Math.max(8, Math.floor(width / 14)));
      await waitFor(() => expect(parseInt((title as HTMLElement).style.height, 10)).toBe(lines * 32));
      expect(title.className).toContain("overflow-hidden");
      expect(title.className).toContain("break-words");
    }, 40_000);
  }
});
