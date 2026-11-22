// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";
import { WAIT } from "@/test/wait-limits";

// Issue #809 (19 November 2026): right after typing in a new note, the footer
// said "0 words" for text with several words, and the sidebar kept showing
// "Untitled" for a note just given a title, until the save landed or the page
// was reloaded. These run the real editor and the real sidebar tree against a
// real notebook that does not answer, so no save can complete while they look.

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
  notebook.away = false;
  const { unsavedNotes } = await import("@/lib/unsaved-notes");
  unsavedNotes.shutdown();
  try { window.localStorage.clear(); } catch { /* none */ }
  vi.unstubAllGlobals();
});

const NOTE_COLUMNS = "id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, folder_path, is_external, sync_status, structured_fields, related, ai_visibility, processing_status, processed_at, processing_error, created_at, updated_at";
const stored = (id: string) => notebook.query({ table: "notes", operation: "select", selection: "id, title, content", filters: [["eq", "id", id]], single: true });

// The notes page's sidebar and editor side by side, the sidebar given the
// notes the way the page gives them (useTypedTitles over the saved list).
async function openNewNote() {
  const id = `live-counts-${Date.now().toString(36)}`;
  await notebook.query({ table: "notes", operation: "insert", values: { id, title: "", content: "", folder_path: "" }, selection: "id", single: true });
  vi.resetModules();
  vi.stubGlobal("fetch", notebook.fetch);
  const { NoteEditor } = await import("./NoteEditor");
  const { NoteTree } = await import("./NoteTree");
  const { useTypedTitles } = await import("@/hooks/useUnsavedNotes");
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.from("notes").select(NOTE_COLUMNS).eq("id", id).single();
  if (error) throw new Error(error.message);
  const saved = [data as any];
  const noop = () => {};
  function Sidebar() {
    const notes = useTypedTitles(saved);
    return (
      <nav aria-label="Notes">
        <NoteTree notes={notes} folderPaths={[]} selectedId={id} activeFolderPath={null} onSelectNote={noop} onSelectFolder={noop} onCreateNoteInFolder={noop} onCreateFolderInFolder={noop} onMoveNote={noop} />
      </nav>
    );
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Sidebar /><NoteEditor key={id} note={data as any} /></MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull(), WAIT);
  return { id, editor: (document.querySelector(".ProseMirror") as any).editor };
}

describe("a new note shows what is typed before it is saved (#809)", () => {
  it("counts the words and shows the title in the sidebar while the save has not completed", async () => {
    const { id, editor } = await openNewNote();
    const sidebar = screen.getByRole("navigation", { name: "Notes" });
    expect(within(sidebar).getByText("Untitled")).toBeInTheDocument();
    expect(screen.getByText("0 words")).toBeInTheDocument();

    // Nothing answers from here on: whatever shows next comes from the typing.
    notebook.away = true;
    fireEvent.change(screen.getByRole("textbox", { name: "Note title" }), { target: { value: "Garden plan" } });
    act(() => { editor.chain().focus("end").insertContent("Plant").run(); });
    act(() => { editor.chain().insertContent(" tomatoes").run(); });
    act(() => { editor.chain().insertContent(" in May").run(); });

    expect(screen.getByText("4 words")).toBeInTheDocument();
    expect(within(sidebar).getByText("Garden plan")).toBeInTheDocument();
    expect(within(sidebar).queryByText("Untitled")).toBeNull();

    // The save had not completed: the notebook still holds the empty note.
    const held = await stored(id);
    expect(held.title).toBe("");
    expect(held.content).toBe("");
  }, 40_000);
});

// Issue #818: a note with one word said "1 words" in the footer and in the
// note info panel.
describe("a note with one word says 'word' (#818)", () => {
  it("says 1 word in the footer and the note info, and words for other counts", async () => {
    const { editor } = await openNewNote();
    notebook.away = true;
    const more = screen.getByTitle("More actions");
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Note info/ }, WAIT));
    expect(screen.getByText("0 words · 0 characters")).toBeInTheDocument();

    act(() => { editor.chain().focus("end").insertContent("a").run(); });
    expect(screen.getByText("1 word")).toBeInTheDocument();
    expect(screen.getByText("1 word · 1 character")).toBeInTheDocument();
    expect(screen.queryByText(/\b1 words\b/)).toBeNull();

    act(() => { editor.chain().insertContent("pple").run(); });
    expect(screen.getByText("1 word")).toBeInTheDocument();
    expect(screen.getByText("1 word · 5 characters")).toBeInTheDocument();

    act(() => { editor.chain().insertContent(" tree").run(); });
    expect(screen.getByText("2 words")).toBeInTheDocument();
    expect(screen.getByText("2 words · 10 characters")).toBeInTheDocument();
  }, 40_000);
});
