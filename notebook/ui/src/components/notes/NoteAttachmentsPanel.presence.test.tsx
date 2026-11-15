// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";

const { createSignedUrl } = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ createSignedUrl }) } } }));
vi.mock("@/hooks/useMediaAnalysis", () => ({
  useMediaAnalysis: () => ({ data: [{
    id: "media-1", note_id: "note-1", storage_path: "notes/large.png", media_type: "image",
    page_number: null, original_filename: "large.png", description: null, extracted_text: null,
    topics: [], raw_analysis: null, analysis_status: "complete",
  }] }),
  useReanalyzeMedia: () => ({ isPathPending: () => false, mutate: vi.fn() }),
}));

describe("note attachment presence", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); createSignedUrl.mockClear(); });

  it("shows where a local-only attachment is without requesting its bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { "notes/large.png": "kept_elsewhere" } }))));
    const { NoteAttachmentsPanel } = await import("./NoteAttachmentsPanel");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><NoteAttachmentsPanel noteId="note-1" /></QueryClientProvider></MemoryRouter>);

    expect(await screen.findByText(/Open it on the computer where it was added/)).toBeInTheDocument();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});
