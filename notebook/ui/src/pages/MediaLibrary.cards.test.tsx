// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";

// #528: a Media Library card for media with no note title said "Untitled" although its file name
// was known, and the type filter had no PDF option although PDFs travel with the private copy.

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current; } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/media/PdfThumbnail", () => ({ PdfThumbnail: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// jsdom lacks what Radix's Select reaches for when it opens.
Object.assign(Element.prototype, {
  hasPointerCapture: () => false,
  releasePointerCapture: () => {},
  scrollIntoView: () => {},
});

function row(id: string, path: string, note: string | null, mediaType: string, original: string | null, contentType?: string, page: number | null = null) {
  return {
    id, note_id: note, storage_path: path, media_type: mediaType, page_number: page, original_filename: original,
    description: null, extracted_text: null, topics: [], raw_analysis: contentType ? { content_type: contentType } : null,
    analysis_status: "complete", created_at: "2026-11-13T10:00:00Z", updated_at: "2026-11-13T10:00:00Z",
  };
}

async function open(rows: ReturnType<typeof row>[], notes: { id: string; title: string }[]) {
  const supa = createFakeSupabase((q) => {
    if (q.table === "media_analysis") return { data: rows };
    if (q.table === "notes") return { data: notes };
    return undefined;
  });
  fake.current = {
    ...supa.client,
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/media/kept-here")) return new Response(JSON.stringify({ data: [] }));
    if (u.endsWith("/api/media/missing-here")) return new Response(JSON.stringify({ data: [] }));
    return new Response(JSON.stringify({ data: {} }));
  }));
  const { default: MediaLibrary } = await import("./MediaLibrary");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><MediaLibrary /></QueryClientProvider></MemoryRouter>);
}

const cardTitles = () =>
  Array.from(document.querySelectorAll('[role="button"] p.font-medium')).map((p) => p.textContent);

describe("Media Library cards", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("names a card with no note title by its file name, without the stored path", async () => {
    await open(
      [
        row("m1", "owner/inbox/holiday-photo.png", null, "image", "holiday-photo.png"),
        row("m2", "owner/notes/2026/scan.pdf", "note-untitled", "pdf", null),
        row("m3", "owner/notes/manual.pdf", "note-1", "pdf", "manual.pdf"),
      ],
      [{ id: "note-1", title: "Washing machine" }, { id: "note-untitled", title: "" }],
    );
    await waitFor(() => expect(cardTitles()).toContain("Washing machine"));
    const titles = cardTitles();
    expect(titles).toContain("holiday-photo.png");
    expect(titles).toContain("scan.pdf");
    expect(titles).not.toContain("Untitled");
    expect(titles.some((t) => t?.includes("/"))).toBe(false);
  });

  it("offers PDF in the type filter and then shows exactly the PDF items", async () => {
    await open(
      [
        row("m1", "owner/a/whiteboard.png", "note-1", "image", "whiteboard.png", "whiteboard"),
        row("m2", "owner/a/contract.pdf", "note-1", "pdf", "contract.pdf", "document"),
        row("m3", "owner/a/brochure.pdf", "note-2", "pdf_page", "brochure.pdf", "document", 1),
        row("m4", "owner/a/brochure.pdf", "note-2", "pdf_page", "brochure.pdf", "document", 2),
        row("m5", "owner/a/receipt.jpg", "note-2", "image", "receipt.jpg", "document"),
      ],
      [{ id: "note-1", title: "" }, { id: "note-2", title: "" }],
    );
    await waitFor(() => expect(cardTitles()).toHaveLength(4));
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    const pdf = await screen.findByRole("option", { name: "PDF" });
    fireEvent.click(pdf);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("PDF"));
    expect(cardTitles().sort()).toEqual(["brochure.pdf", "contract.pdf"]);
  });
});
