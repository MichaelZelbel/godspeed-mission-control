// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";

// Issue #29 (23 October 2026): text typed in a note was lost for good. The
// notebook restarted for about 80 seconds, the person switched to another note,
// the one save sent on leaving the note failed, and nothing kept a copy. These
// run the real editor against a real notebook in a process of its own; "away"
// fails the screen's requests the way a browser's fail while nothing answers.

const toasts = vi.hoisted(() => [] as string[]);
vi.mock("sonner", () => {
  const record = (kind: string) => vi.fn((message: unknown) => { toasts.push(`${kind}: ${String(message)}`); return toasts.length; });
  return { toast: Object.assign(record("plain"), { success: record("success"), error: record("error"), info: record("info"), warning: record("warning"), loading: record("loading"), dismiss: vi.fn() }) };
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
  // The editor's modules are prepared once here, not inside the first test's time.
  await import("./NoteEditor");
}, 120_000);
afterAll(async () => { await notebook?.stop(); });
afterEach(async () => {
  await closePage();
  notebook.away = false;
  toasts.length = 0;
  try { window.localStorage.clear(); } catch { /* none */ }
  vi.unstubAllGlobals();
});

const NOTE_COLUMNS = "id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, folder_path, is_external, sync_status, structured_fields, related, ai_visibility, processing_status, processed_at, processing_error, created_at, updated_at";
let seq = 0;
async function seedNote(title: string, content: string) {
  const id = `unsaved-text-${Date.now().toString(36)}-${++seq}`;
  await notebook.query({ table: "notes", operation: "insert", values: { id, title, content, folder_path: "Garden" }, selection: "id", single: true });
  return id;
}
const stored = (id: string) => notebook.query({ table: "notes", operation: "select", selection: "id, title, content, _hash", filters: [["eq", "id", id]], single: true });

// One page of the dashboard: a fresh copy of every screen module (a reload),
// the same browser storage. The open note is read the way the notes page reads
// it (useNote), which is also how the page learns the note's version.
async function openPage() {
  vi.resetModules();
  vi.stubGlobal("fetch", notebook.fetch);
  const { NoteEditor } = await import("./NoteEditor");
  const { supabase } = await import("@/integrations/supabase/client");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const read = async (id: string) => {
    const { data, error } = await supabase.from("notes").select(NOTE_COLUMNS).eq("id", id).single();
    if (error) throw new Error(error.message);
    return data;
  };
  const view = (note: any) => (
    <QueryClientProvider client={client}>
      <MemoryRouter><NoteEditor key={note.id} note={note} /></MemoryRouter>
    </QueryClientProvider>
  );
  return { NoteEditor, read, view };
}

// The page goes away: what a closed or reloaded tab does, then nothing of it is left running.
async function closePage() {
  act(() => { window.dispatchEvent(new Event("pagehide")); });
  cleanup();
  // What the closing page sent while nothing answered dies with the page.
  if (notebook.away) await new Promise((resolve) => setTimeout(resolve, 500));
  const { unsavedNotes } = await import("@/lib/unsaved-notes");
  unsavedNotes.shutdown();
}

async function openEditor() {
  await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
  return (document.querySelector(".ProseMirror") as any).editor;
}
function type(editor: any, words: string) {
  act(() => { editor.chain().insertContentAt(editor.state.doc.content.size, `<p>${words}</p>`).run(); });
}
const comeBack = () => act(() => { notebook.away = false; window.dispatchEvent(new Event("online")); });

describe("text typed in a note while the notebook does not answer (#29)", () => {
  it("survives a failed save while switching notes, and is saved once the notebook answers", async () => {
    const gardenId = await seedNote("Garden plan", "Seeds to buy.");
    const otherId = await seedNote("Reading list", "A book about ferns.");
    const page = await openPage();
    const garden = await page.read(gardenId), other = await page.read(otherId);
    const { rerender } = render(page.view(garden));
    const editor = await openEditor();

    notebook.away = true;
    type(editor, "Also tulips by the fence.");
    // Another note is opened straight away, inside the autosave's pause: the
    // save sent on leaving the note is the one that fails.
    rerender(page.view(other));
    await waitFor(() => expect(document.querySelector(".ProseMirror")?.textContent).toContain("A book about ferns."));
    await new Promise((r) => setTimeout(r, 300));
    expect((await stored(gardenId)).content).not.toContain("Also tulips");

    comeBack();
    await waitFor(async () => expect((await stored(gardenId)).content).toContain("Also tulips by the fence."), { timeout: 15_000 });
    expect((await stored(gardenId)).content).toContain("Seeds to buy.");
  }, 40_000);

  it("says plainly that the text is not saved yet, and closing the tab asks first", async () => {
    const id = await seedNote("Garden plan", "Seeds to buy.");
    const page = await openPage();
    render(page.view(await page.read(id)));
    const editor = await openEditor();

    notebook.away = true;
    type(editor, "Water the beans.");
    expect(await screen.findByText(/Not saved yet\. Trying again/, undefined, { timeout: 8_000 })).toBeInTheDocument();
    const leave = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);

    comeBack();
    await waitFor(async () => expect((await stored(id)).content).toContain("Water the beans."), { timeout: 15_000 });
    await waitFor(() => expect(screen.queryByText(/Not saved yet/)).toBeNull());
    expect(screen.getByText(/^Saved ·/)).toBeInTheDocument();
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  }, 40_000);

  it("is restored and saved when the note is opened after a reload", async () => {
    const id = await seedNote("Garden plan", "Seeds to buy.");
    let page = await openPage();
    render(page.view(await page.read(id)));
    let editor = await openEditor();
    notebook.away = true;
    type(editor, "Compost in spring.");
    await closePage();

    // The notebook is back; the tab is opened again and the note with it.
    notebook.away = false;
    expect((await stored(id)).content).not.toContain("Compost in spring.");
    page = await openPage();
    render(page.view(await page.read(id)));
    editor = await openEditor();
    await waitFor(() => expect(document.querySelector(".ProseMirror")?.textContent).toContain("Compost in spring."));
    await waitFor(async () => expect((await stored(id)).content).toContain("Compost in spring."), { timeout: 15_000 });
    expect(notebook.conflicts().filter((c) => c.record_id === id)).toEqual([]);
  }, 40_000);

  it("never writes silently over a version saved elsewhere in the meantime: both are kept", async () => {
    const id = await seedNote("Garden plan", "Seeds to buy.");
    let page = await openPage();
    const opened = await page.read(id);
    render(page.view(opened));
    const editor = await openEditor();
    notebook.away = true;
    type(editor, "Compost in spring.");
    await closePage();

    // Meanwhile the same note is changed on another device.
    notebook.away = false;
    const current = await stored(id);
    await notebook.query({ table: "notes", operation: "update", values: { content: "Seeds to buy. Water on Sunday." }, filters: [["eq", "id", id]], selection: "id", single: true, expected: { [id]: current._hash } });

    page = await openPage();
    render(page.view(await page.read(id)));
    await openEditor();
    await waitFor(async () => expect((await stored(id)).content).toContain("Compost in spring."), { timeout: 15_000 });
    // The text was sent as typed on the version it was typed on, so the
    // notebook saw the overlap and kept the other version for review.
    const updates = notebook.sent.filter((s) => s.operation === "update" && s.filters?.[0]?.[2] === id);
    expect(updates[0]?.expected?.[id]).toBe(opened._hash);
    const kept = notebook.conflicts().filter((c) => c.record_id === id);
    expect(kept).toHaveLength(1);
    expect(kept[0].remote.content).toContain("Water on Sunday.");
    await waitFor(() => expect(toasts.some((t) => t.includes('Review conflicting edits'))).toBe(true));
  }, 40_000);
});
