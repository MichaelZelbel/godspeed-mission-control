// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
import { MEDIA_CARRY_MAX_MB } from "../../../shared/media-limits.mjs";
import { WAIT } from "@/test/wait-limits";

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

async function open(rows: ReturnType<typeof row>[], notes: { id: string; title: string }[], localOnlyPath?: string, remoteOnly: { path: string; contentType: string; filename: string; note_id: string }[] = []) {
  const supa = createFakeSupabase((q) => {
    if (q.table === "media_analysis") return { data: rows };
    if (q.table === "notes") return { data: notes };
    if (q.table === "note_attachments") return { data: remoteOnly.map(item => ({ ...item, storage_path: item.path, file_type: item.contentType, mime_type: item.contentType, created_at: "2026-11-13T10:00:00Z" })) };
    return undefined;
  });
  fake.current = {
    ...supa.client,
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/media/kept-here")) return new Response(JSON.stringify({ data: [] }));
    if (u.endsWith("/api/media/kept-elsewhere")) return new Response(JSON.stringify({ data: remoteOnly.map(({ path, contentType }) => ({ path, contentType, size: 75 * 1024 * 1024 })) }));
    if (u.endsWith("/api/media/presence")) {
      const paths = JSON.parse(String(init?.body)).paths as string[];
      return new Response(JSON.stringify({ data: Object.fromEntries(paths.map(path => [path, path === localOnlyPath ? "kept_elsewhere" : "present"])) }));
    }
    return new Response(JSON.stringify({ data: {} }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const { default: MediaLibrary } = await import("./MediaLibrary");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><MediaLibrary /></QueryClientProvider></MemoryRouter>);
  return fetchMock;
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
    await waitFor(() => expect(cardTitles()).toContain("Washing machine"), WAIT);
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
    await waitFor(() => expect(cardTitles()).toHaveLength(4), WAIT);
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    const pdf = await screen.findByRole("option", { name: "PDF" }, WAIT);
    fireEvent.click(pdf);
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("PDF"), WAIT);
    expect(cardTitles().sort()).toEqual(["brochure.pdf", "contract.pdf"]);
  });

  it("keeps a local-only preview guarded in a library larger than one presence request", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => row(`m${index}`, `owner/${index}.png`, null, "image", `${index}.png`));
    const localOnlyPath = rows[500].storage_path;
    const fetchMock = await open(rows, [], localOnlyPath);

    expect(await screen.findByText("Kept on another computer", undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Open it on the computer where it was added, or make it smaller than ${MEDIA_CARRY_MAX_MB} MB`))).toBeInTheDocument();
    const presenceCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/api/media/presence"));
    expect(presenceCalls).toHaveLength(2);
    expect(JSON.parse(String(presenceCalls[0][1]?.body)).paths).toHaveLength(500);
    expect(document.querySelector(`img[src*="${encodeURIComponent(localOnlyPath)}"]`)).toBeNull();
  });

  it("shows and searches a carried remote-only file even without a local analysis row", async () => {
    const path = "owner/remote-id.pdf";
    await open([], [{ id: "note-remote", title: "Trip plans" }], path, [
      { path, contentType: "application/pdf", filename: "Tickets for Berlin.pdf", note_id: "note-remote" },
    ]);

    expect(await screen.findByText("Kept on another computer", undefined, WAIT)).toBeInTheDocument();
    expect(cardTitles()).toContain("Trip plans");
    expect(screen.getByText("Tickets for Berlin.pdf")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search media" }), { target: { value: "Berlin" } });
    expect(cardTitles()).toEqual(["Trip plans"]);
  });
});
