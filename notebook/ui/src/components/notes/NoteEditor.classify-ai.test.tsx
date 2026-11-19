// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import http from "node:http";
import { AI_REFUSED_STATUS, AI_UNREACHABLE_STATUS, NO_AI_STATUS } from "../../../../core/no-ai.mjs";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";

// #779: "Classify with AI" in a note's menu said nothing when it failed. Against a real notebook and a
// stand-in AI on 127.0.0.1 it now says that no AI is connected, that the key was refused, or that the
// AI could not be reached, and never the provider's own words.

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

const KEY = "sk-fictional-classify-secret";
let notebook: RealNotebook, ai: http.Server, aiStatus = 401, aiUrl = "";
beforeAll(async () => {
  notebook = await startNotebook();
  ai = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(aiStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(aiStatus === 200 ? { choices: [{ message: { content: "Connected" } }] } : { error: { message: "Incorrect API key provided: " + KEY } }));
    });
  });
  await new Promise<void>((resolve) => ai.listen(0, "127.0.0.1", resolve));
  aiUrl = `http://127.0.0.1:${(ai.address() as any).port}/v1/chat/completions`;
  await import("./NoteEditor");
}, 120_000);
afterAll(async () => {
  await notebook?.stop();
  if (ai.listening) await new Promise<void>((resolve) => ai.close(() => resolve()));
});
afterEach(() => { cleanup(); toasts.length = 0; vi.unstubAllGlobals(); });

const NOTE_COLUMNS = "id, user_id, title, content, metadata, tags, is_favorite, is_pinned, is_trashed, trashed_at, entity_type, source_app, source_id, source_url, folder_path, is_external, sync_status, structured_fields, related, ai_visibility, processing_status, processed_at, processing_error, created_at, updated_at";
let seq = 0;
async function classify() {
  const id = `classify-ai-${++seq}`;
  await notebook.query({ table: "notes", operation: "insert", values: { id, title: "Lunch " + seq, content: "Lunch with Ada about the garden." }, selection: "id", single: true });
  vi.resetModules();
  vi.stubGlobal("fetch", notebook.fetch);
  const { NoteEditor } = await import("./NoteEditor");
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: note } = await supabase.from("notes").select(NOTE_COLUMNS).eq("id", id).single();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><NoteEditor note={note} /></MemoryRouter>
    </QueryClientProvider>,
  );
  const more = await screen.findByTitle("More actions");
  fireEvent.pointerDown(more, { button: 0, ctrlKey: false });
  fireEvent.keyDown(more, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Classify with AI" }));
  await waitFor(() => expect(toasts.filter((t) => t.startsWith("error: "))).toHaveLength(1), { timeout: 15_000 });
  const said = toasts.find((t) => t.startsWith("error: "))!;
  expect(said).not.toMatch(/HTTP|\b[45]\d\d\b|Model provider|Incorrect API key|127\.0\.0\.1/);
  expect(said).not.toContain(KEY);
  return said;
}
const connect = async () => {
  aiStatus = 200;
  const response = await notebook.fetch("/api/provider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: aiUrl, key: KEY, model: "fictional-model" }) });
  expect(response.status).toBe(200);
};

describe("Classify with AI when the AI fails", () => {
  it("says no AI is connected yet", async () => {
    const said = await classify();
    expect(said).toMatch(new RegExp("^error: " + NO_AI_STATUS));
    expect(said).not.toMatch(/refused|could not be reached/);
  }, 60_000);

  it("says the key was refused, then that the AI could not be reached", async () => {
    await connect();
    aiStatus = 401;
    expect(await classify()).toBe("error: " + AI_REFUSED_STATUS + ". Check it in Settings, Your AI, then try again.");
    cleanup(); toasts.length = 0;
    await new Promise<void>((resolve) => ai.close(() => resolve()));
    expect(await classify()).toBe("error: " + AI_UNREACHABLE_STATUS + ". Check its connection in Settings, Your AI, then try again.");
  }, 60_000);
});
