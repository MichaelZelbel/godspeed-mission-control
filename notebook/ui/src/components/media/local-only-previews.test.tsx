// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";

const { createSignedUrl } = vi.hoisted(() => ({ createSignedUrl: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ createSignedUrl }) } } }));
vi.mock("@/hooks/useMediaAnalysis", () => ({ useReanalyzeMedia: () => ({ isPathPending: () => false, mutate: vi.fn() }) }));
vi.mock("@/components/media/PdfThumbnail", () => ({ PdfThumbnail: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const wrap = (child: React.ReactNode) => render(
  <MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{child}</QueryClientProvider></MemoryRouter>,
);

describe("local-only preview surfaces", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); createSignedUrl.mockClear(); });

  it("shows the explanation in the media detail dialog without signing bytes", async () => {
    const { MediaDetailDialog } = await import("./MediaDetailDialog");
    wrap(<MediaDetailDialog item={{
      id: "1", note_id: "note", storage_path: "notes/large.png", media_type: "image", page_number: null,
      original_filename: "large.png", description: null, extracted_text: null, topics: [], raw_analysis: null, analysis_status: "complete",
    }} missingHere presenceChecked onClose={() => {}} />);

    expect(screen.getByText(/Open it on the computer where it was added/)).toBeInTheDocument();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("shows the explanation in a web clip without signing or fetching bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { "notes/large.html": "kept_elsewhere" } }))));
    const { WebClipPreview } = await import("@/components/notes/WebClipPreview");
    wrap(<WebClipPreview defaultOpen webClip={{ snapshot_storage_path: "notes/large.html" }} />);

    expect(await screen.findByText(/Open it on the computer where it was added/)).toBeInTheDocument();
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
