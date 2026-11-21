// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";
import { WAIT } from "@/test/wait-limits";

// Issue #879 (21 November 2026): the note toolbar's icon buttons carried only
// a `title`, no `aria-label`, so tabbing to them reached a button with an
// empty name. These render the note editor and check that every button in it
// has an accessible name, and that every button with a tooltip says the same
// as its tooltip - including the tooltips that change with the note's state
// (favorited, pinned, Markdown source).
//
// The name here is what a screen reader says from the button's own markup:
// aria-labelledby, then aria-label, then the button's text. A `title` is
// deliberately not counted on its own - that is exactly the fault this fix
// removes, and assistive tech that drops tooltips read these buttons as
// empty.

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
async function seedNote(values: Record<string, unknown>) {
  const id = `toolbar-names-${Date.now().toString(36)}-${++seq}`;
  await notebook.query({ table: "notes", operation: "insert", values: { id, ...values }, selection: "id", single: true });
  return id;
}

async function openNote(id: string) {
  vi.resetModules();
  vi.stubGlobal("fetch", notebook.fetch);
  const { NoteEditor } = await import("./NoteEditor");
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await supabase.from("notes").select(NOTE_COLUMNS).eq("id", id).single();
  if (error) throw new Error(error.message);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><NoteEditor key={data.id} note={data as any} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

/** What the button's own markup gives a screen reader: labelledby, then aria-label, then text. */
function accessibleName(button: HTMLButtonElement): string {
  const labelledby = button.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby.split(/\s+/).filter(Boolean)
      .map((ref) => document.getElementById(ref)?.textContent ?? "")
      .join(" ").trim();
    if (text) return text;
  }
  const label = button.getAttribute("aria-label");
  if (label && label.trim()) return label.trim();
  return (button.textContent ?? "").trim();
}

/** Every button in scope is named; every button with a tooltip is named the same as its tooltip. */
function expectEveryTooltipNamed(scope: Element, where: string, atLeast: number) {
  const buttons = Array.from(scope.querySelectorAll<HTMLButtonElement>("button"));
  expect(buttons.length, `${where}: only ${buttons.length} buttons found`).toBeGreaterThanOrEqual(atLeast);
  for (const button of buttons) {
    const name = accessibleName(button);
    expect(name, `${where}: a button has no accessible name: ${button.outerHTML.slice(0, 200)}`).not.toBe("");
    const title = button.getAttribute("title")?.trim();
    if (title !== undefined) {
      expect(name, `${where}: the button with tooltip "${title}" says "${name}" instead: ${button.outerHTML.slice(0, 200)}`).toBe(title);
    }
  }
}

describe("Every icon button in the note toolbar has an accessible name (#879)", () => {
  it("a regular note's toolbar", async () => {
    const id = await seedNote({ title: "Garden plan", content: "Plant tomatoes." });
    const { container } = await openNote(id);
    await waitFor(() => expect(container.querySelector('button[title="More actions"]')).not.toBeNull());
    expectEveryTooltipNamed(container, "note toolbar", 6);
  }, 60_000);

  it("a note synced from another app", async () => {
    const id = await seedNote({ title: "From the mail", content: "Read this.", is_external: true, source_app: "mail", sync_status: "synced" });
    const { container } = await openNote(id);
    await waitFor(() => expect(container.querySelector('button[title="Add to favorites"]')).not.toBeNull());
    expectEveryTooltipNamed(container, "synced note toolbar", 3);
  }, 60_000);

  it("a note switched to Markdown source, with its source-mode button", async () => {
    const id = await seedNote({ title: "Raw plan", content: "## Raw notes" });
    const { container } = await openNote(id);
    const more = await waitFor(() => {
      const el = container.querySelector('button[title="More actions"]');
      expect(el).not.toBeNull();
      return el as HTMLButtonElement;
    });
    fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Markdown source" }, WAIT));
    await waitFor(() => expect(container.querySelector('button[title="Rich text mode"]')).not.toBeNull());
    expectEveryTooltipNamed(container, "Markdown-source note toolbar", 3);
  }, 60_000);

  it("a favorited, pinned note, with its state-dependent names", async () => {
    const id = await seedNote({ title: "Daily plan", content: "Water the plants.", is_favorite: true, is_pinned: true });
    const { container } = await openNote(id);
    await waitFor(() => expect(container.querySelector('button[title="Remove from favorites"]')).not.toBeNull());
    await waitFor(() => expect(container.querySelector('button[title="Unpin"]')).not.toBeNull());
    expectEveryTooltipNamed(container, "favorited note toolbar", 6);
  }, 60_000);
});
