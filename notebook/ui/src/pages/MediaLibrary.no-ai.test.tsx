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

async function open(backfill: (mode: string) => Response) {
  const supa = createFakeSupabase((q) => {
    if (q.table === "media_analysis") return { data: [] };
    if (q.table === "notes") return { data: [] };
    if (q.table === "note_attachments") return { data: [upload] };
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
