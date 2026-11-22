// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";
import { WAIT } from "@/test/wait-limits";

// Issue #791 (19 November 2026): in a new note, typing a title and pressing
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

// What typing a word does: the text goes in wherever the focus and the cursor are.
function typeInto(target: Element, editor: any, words: string) {
  if (target instanceof HTMLTextAreaElement) {
    fireEvent.change(target, { target: { value: target.value + words } });
  } else {
    act(() => { editor.view.dispatch(editor.state.tr.insertText(words)); });
  }
}

async function titleEnterText(id: string, titleWords: string, textWords: string) {
  const editor = await openNote(id);
  const title = screen.getByRole("textbox", { name: "Note title" }) as HTMLTextAreaElement;
  act(() => { title.focus(); });
  typeInto(title, editor, titleWords);

  const enter = fireEvent.keyDown(title, { key: "Enter", code: "Enter" });
  expect(enter).toBe(false); // Enter was taken by the title, not left to the browser.

  // The focus is in the note's text at once (the next key a fast typist
  // presses follows straight after Enter), with the cursor at its very start.
  const prose = document.querySelector(".ProseMirror") as HTMLElement;
  expect(prose.contains(document.activeElement)).toBe(true);
  expect(editor.state.selection.from).toBe(1);
  expect(editor.state.selection.empty).toBe(true);

  typeInto(document.activeElement as Element, editor, textWords);
  return { editor, title, prose };
}

describe("Enter in a note's title goes on in the note's text (#791)", () => {
  it("in a new note: the title keeps what was typed and the next words are the note's text", async () => {
    const id = await seedNote("", "");
    const { title, prose } = await titleEnterText(id, "Garden plan", "Plant tomatoes in May and basil beside them.");

    expect(title.value).toBe("Garden plan");
    expect(prose.textContent).toBe("Plant tomatoes in May and basil beside them.");
    await waitFor(async () => {
      const saved = await stored(id);
      expect(saved.title).toBe("Garden plan");
      expect(saved.content).toContain("Plant tomatoes in May and basil beside them.");
    }, { timeout: 15_000 });
    expect((await stored(id)).title).not.toContain("Plant");
  }, 40_000);

  it("in an existing note: the cursor goes to the start of its text", async () => {
    const id = await seedNote("Garden", "Seeds to buy.");
    const { title, prose } = await titleEnterText(id, " plan", "Compost first. ");

    expect(title.value).toBe("Garden plan");
    expect(prose.textContent).toBe("Compost first. Seeds to buy.");
  }, 40_000);
});
