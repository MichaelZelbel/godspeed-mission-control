// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
import { NO_AI_ANALYSIS } from "../../../core/no-ai.mjs";

// #735: with no AI connected an upload never appeared in the Media Library, because only analysis
// creates its media_analysis row, and Start analysis then reported just "1 failed".

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current; } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/media/PdfThumbnail", () => ({ PdfThumbnail: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// A row as uploadAttachment writes it: no note, no file_type, no analysis.
const upload = {
  id: "a1", user_id: "owner", filename: "holiday.png", storage_path: "owner/holiday.png", size_bytes: 1024,
  mime_type: "image/png", sha256: "abc", source: "upload", note_id: null, file_type: null, created_at: "2026-11-18T10:00:00Z",
};

const scan = (aiConnected: boolean) =>
  new Response(JSON.stringify({ total_media: 1, already_analyzed: 0, unanalyzed_total: 1, unanalyzed_images: 1, unanalyzed_pdfs: 0, ai_connected: aiConnected }));

const analysed = {
  id: "m1", note_id: null, storage_path: upload.storage_path, media_type: "image", page_number: null, original_filename: "holiday.png",
  description: "A beach", extracted_text: null, topics: [], raw_analysis: null, analysis_status: "complete",
  created_at: "2026-11-18T10:01:00Z", updated_at: "2026-11-18T10:01:00Z",
};

// `listed` answers the library's own media_analysis read; `known` answers the by-path lookup of
// which attachments have any analysis, which also reaches rows outside the library's newest 500.
async function open(
  backfill: (mode: string) => Response,
  { attachments = [upload] as object[], listed = [] as object[], known = listed } = {},
) {
  const supa = createFakeSupabase((q) => {
    if (q.table === "media_analysis") return { data: q.columns === "storage_path" ? known : listed };
    if (q.table === "notes") return { data: [] };
    if (q.table === "note_attachments") return { data: attachments };
    return undefined;
  });
  fake.current = {
    ...supa.client,
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/media/kept-here") || u.endsWith("/api/media/kept-elsewhere")) return new Response(JSON.stringify({ data: [] }));
    if (u.endsWith("/api/media/presence")) {
      const paths = JSON.parse(String(init?.body)).paths as string[];
      return new Response(JSON.stringify({ data: Object.fromEntries(paths.map((path) => [path, "present"])) }));
    }
    if (u.endsWith("/api/functions/backfill-media-analysis")) return backfill(JSON.parse(String(init?.body)).mode);
    return new Response(JSON.stringify({ data: {} }));
  }));
  const { default: MediaLibrary } = await import("./MediaLibrary");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><MediaLibrary /></QueryClientProvider></MemoryRouter>);
}

const cardTitles = () =>
  Array.from(document.querySelectorAll('[role="button"] p.font-medium')).map((p) => p.textContent);

async function expectConnectAiNotice() {
  expect(await screen.findByText(/Analysis needs a connected AI/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Settings, Your AI" })).toHaveAttribute("href", "/dashboard/settings#connect-ai");
  expect(screen.getByRole("button", { name: "Start analysis" })).toBeDisabled();
  expect(screen.queryByText(/failed/i)).toBeNull();
}

describe("Media Library with no AI connected", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("lists an upload no AI has analysed and says it is not analysed yet", async () => {
    await open(() => scan(false));
    expect(await screen.findByText("Not analyzed yet")).toBeInTheDocument();
    expect(screen.getAllByText("holiday.png").length).toBeGreaterThan(0);
  });

  it("does not list a video or audio upload as waiting for analysis, which never comes for them", async () => {
    await open(() => scan(false), { attachments: [
      upload,
      { ...upload, id: "a2", filename: "clip.mp4", storage_path: "owner/clip.mp4", mime_type: "video/mp4" },
      { ...upload, id: "a3", filename: "memo.mp3", storage_path: "owner/memo.mp3", mime_type: "audio/mpeg" },
      { ...upload, id: "a4", filename: "scan.pdf", storage_path: "owner/scan.pdf", mime_type: null, file_type: "application/pdf" },
    ] });
    await waitFor(() => expect(cardTitles().sort()).toEqual(["holiday.png", "scan.pdf"]));
  });

  it.each([
    ["in the library's own rows and in the lookup", { listed: [analysed] }],
    ["in the library's own rows only", { listed: [analysed], known: [] }],
  ])("lists an analysed upload once, with its result, when its analysis is %s", async (_, rows) => {
    await open(() => scan(true), rows);
    await waitFor(() => expect(cardTitles()).toEqual(["holiday.png"]));
    expect(screen.queryByText("Not analyzed yet")).toBeNull();
  });

  it("does not call an upload not analysed when its analysis is older than the library's newest rows", async () => {
    const fresh = { ...upload, id: "a2", filename: "sunset.png", storage_path: "owner/sunset.png" };
    await open(() => scan(true), { attachments: [upload, fresh], listed: [], known: [{ storage_path: upload.storage_path }] });
    await waitFor(() => expect(cardTitles()).toEqual(["sunset.png"]));
    expect(screen.getAllByText("Not analyzed yet")).toHaveLength(1);
  });

  it("with an AI connected, offers Start analysis and no connect-an-AI notice", async () => {
    await open(() => scan(true));
    fireEvent.click(await screen.findByRole("button", { name: "Scan" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start analysis" })).toBeEnabled());
    expect(screen.queryByText(/Analysis needs a connected AI/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Settings, Your AI" })).toBeNull();
  });

  it("says analysis needs a connected AI before starting", async () => {
    await open(() => scan(false));
    fireEvent.click(await screen.findByRole("button", { name: "Scan" }));
    await expectConnectAiNotice();
  });

  it("Start analysis with no AI gives the connect-an-AI message and no failed count", async () => {
    let scans = 0;
    await open((mode) => {
      if (mode === "scan") return scan(scans++ === 0);
      return new Response(JSON.stringify({ error: NO_AI_ANALYSIS }), { status: 400 });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Scan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start analysis" }));
    await expectConnectAiNotice();
  });
});
