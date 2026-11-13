// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";

// A Media Library card's "Kept on this computer only" badge (top left) used to be placed on its
// own over the thumbnail, and so did the status (top right): the long badge ran under the
// "Analyzing…" chip and under the green check mark (#502, #514). They now share one row, the badge
// able to shrink and wrap beside the status, so neither can lie over the other.
// jsdom has no layout, so this checks the arrangement; the pull request's browser check measures it.

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current; } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/media/PdfThumbnail", () => ({ PdfThumbnail: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BIG = "owner/note-1/big-manual.pdf";
const OTHER = "owner/note-2/away.pdf";
function row(id: string, path: string, note: string, status: string) {
  return { id, note_id: note, storage_path: path, media_type: "pdf", page_number: null, original_filename: path.split("/").pop(), description: null, extracted_text: null, topics: [], raw_analysis: null, analysis_status: status, created_at: "2026-11-13T10:00:00Z", updated_at: "2026-11-13T10:00:00Z" };
}

async function open(status: string) {
  const supa = createFakeSupabase((q) => {
    if (q.table === "media_analysis") return { data: [row("m1", BIG, "note-1", status), row("m2", OTHER, "note-2", status)] };
    if (q.table === "notes") return { data: [{ id: "note-1", title: "Manual" }, { id: "note-2", title: "Away" }] };
    return undefined;
  });
  fake.current = {
    ...supa.client,
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/media/kept-here")) return new Response(JSON.stringify({ data: [{ path: BIG }] }));
    if (u.endsWith("/api/media/missing-here")) return new Response(JSON.stringify({ data: [OTHER] }));
    return new Response(JSON.stringify({ data: {} }));
  }));
  const { default: MediaLibrary } = await import("./MediaLibrary");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><MediaLibrary /></QueryClientProvider></MemoryRouter>);
}

// The badge and the status sit side by side in one row, neither placed over the card on its own:
// the badge can shrink, so it wraps, and the status keeps its size.
function expectSideBySide(badge: HTMLElement, status: HTMLElement) {
  const rowEl = badge.parentElement!;
  expect(status.parentElement).toBe(rowEl);
  expect(rowEl.className).toMatch(/\bflex\b/);
  expect(badge.className).not.toMatch(/\babsolute\b/);
  expect(status.className).not.toMatch(/\babsolute\b/);
  expect(badge.className).toMatch(/\bmin-w-0\b/);
  expect(status.className).toMatch(/\bshrink-0\b/);
  const order = Array.from(rowEl.children);
  expect(order.indexOf(badge)).toBeLessThan(order.indexOf(status));
}

describe("Media Library card badges and status", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("puts 'Kept on this computer only' beside the Analyzing… chip, not under it", async () => {
    await open("processing");
    const badge = await screen.findByText("Kept on this computer only");
    const chips = await screen.findAllByText("Analyzing…");
    const chip = chips.find((c) => badge.parentElement!.contains(c))!;
    expect(chip).toBeTruthy();
    expectSideBySide(badge, chip.parentElement as HTMLElement);
  });

  it("puts 'Kept on this computer only' beside the analyzed check mark, not under it", async () => {
    await open("complete");
    const badge = await screen.findByText("Kept on this computer only");
    const marks = await screen.findAllByText("✓");
    const mark = marks.find((m) => badge.parentElement!.contains(m))!;
    expect(mark).toBeTruthy();
    expectSideBySide(badge, mark.parentElement as HTMLElement);
    // Re-analyze stays where it was, under the check mark in the same status block.
    const again = within(badge.parentElement!).getByRole("button", { name: /Re-analyze/ });
    expect(again.parentElement).toBe(mark.parentElement);
  });

  it("keeps 'Kept on another computer' in the same row as its status", async () => {
    await open("complete");
    const badge = await screen.findByText("Kept on another computer");
    const mark = (await screen.findAllByText("✓")).find((m) => badge.parentElement!.contains(m))!;
    expect(mark).toBeTruthy();
    expectSideBySide(badge, mark.parentElement as HTMLElement);
  });
});
