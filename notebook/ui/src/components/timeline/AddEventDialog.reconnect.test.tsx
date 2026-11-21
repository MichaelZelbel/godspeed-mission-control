// @vitest-environment jsdom
// #907: after the AI is removed and connected again in Settings, Your AI, a moment saved with no
// reload still asks for its fact extraction. The tab's cached status said none while the AI was
// away, and connecting the AI again leaves that answer standing until the status poll refetches
// (#881's every-few-seconds refresh), so a save made in between decided on the older picture and
// skipped the extraction for good. Now the save reads the status afresh whenever its cached
// picture says no AI is connected, before it skips anything.
// The test drives the real status hook: /api/status answers from one state the test moves, and
// remove and reconnect are the same requests Settings, Your AI sends. No reload happens.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NO_AI_STATUS } from "../../../../core/no-ai.mjs";
import { NO_AI_FACTS } from "./moment-form.mjs";
import AddEventDialog from "./AddEventDialog";
import { WAIT } from "@/test/wait-limits";

const state = vi.hoisted(() => ({ connected: false, statusReads: 0, inserted: [] as string[] }));
const invoke = vi.hoisted(() => vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: {}, error: null })));
const toast = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let result: any = { data: [], error: null };
    const chain: any = new Proxy({}, {
      get: (_target, property) => {
        if (property === "then") return (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
        if (property === "insert") return () => {
          state.inserted.push(table);
          result = { data: table === "moments" ? { id: "moment-1" } : null, error: null };
          return chain;
        };
        return () => chain;
      },
    });
    return chain;
  };
  return { supabase: { from, functions: { invoke } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" }, session: { access_token: "token" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

class NoResize { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoResize as any;

// The notebook's own answers, from one state: what /api/status says, and what Settings, Your AI
// changes when it removes or connects the AI (server/main.mjs). The reconnect answers the way the
// server does and changes the state, but it does not refresh the tab's queries on its own, the way
// the real Settings form does not: the poll is what would carry the change to the tab.
const statusAnswer = () => ({ runtimeConfigured: state.connected, aiAvailability: state.connected ? "ready" : "none" });
globalThis.fetch = vi.fn(async (input: any, options?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = (options?.method || (options?.body ? "POST" : "GET")).toUpperCase();
  if (url.endsWith("/api/provider/remove") && method === "POST") {
    state.connected = false;
    return Response.json({ removed: true, connected: false, provider: { configured: false, key: false } });
  }
  if (url.endsWith("/api/provider") && method === "POST") {
    state.connected = true;
    return Response.json({ connected: true, provider: { configured: true, key: true }, routines: { available: false } });
  }
  if (url.endsWith("/api/status")) { state.statusReads++; return Response.json(statusAnswer()); }
  return Response.json({}, { status: 404 });
}) as any;

// The remove and the reconnect: the same two requests Settings, Your AI sends, one after the other.
const removeAI = () => fetch("/api/provider/remove", { method: "POST", body: "{}" });
const reconnectAI = () => fetch("/api/provider", { method: "POST", body: "{}" });

function renderDialog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } });
  render(
    <QueryClientProvider client={client}>
      <AddEventDialog people={[]} onCreated={() => {}} open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
  return client;
}

async function saveMoment() {
  fireEvent.change(await screen.findByPlaceholderText("Short title for this moment", undefined, WAIT), { target: { value: "A saved moment" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Moment" }));
  await waitFor(() => expect(toast).toHaveBeenCalled(), WAIT);
  expect(state.inserted).toContain("moments");
}

describe("saving a moment after the AI was removed and connected again", () => {
  afterEach(() => {
    cleanup();
    invoke.mockReset();
    invoke.mockResolvedValue({ data: {}, error: null });
    toast.mockClear();
    state.connected = false;
    state.statusReads = 0;
    state.inserted = [];
  });

  it("asks for the extraction when the save lands before the next status poll (#907)", async () => {
    // The tab opened while the AI was connected, so its status said an AI was there.
    state.connected = true;
    vi.useFakeTimers();
    renderDialog();
    await vi.advanceTimersByTimeAsync(0);
    expect(state.statusReads).toBe(1);
    // The AI is removed in Settings, Your AI, and the tab's poll reads that: its cached picture
    // now says no AI is connected.
    await removeAI();
    await vi.advanceTimersByTimeAsync(5100);
    expect(state.statusReads).toBe(2);
    // The AI is connected again, and the person saves at once, before the tab's every-few-seconds
    // poll has read the connection again.
    await reconnectAI();
    vi.useRealTimers();
    await saveMoment();
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce(), WAIT);
  });

  it("still asks the AI nothing while no AI is connected (#881 keeps holding)", async () => {
    // The AI was removed and nothing was connected again: the fresh status answer still says none.
    state.connected = false;
    invoke.mockResolvedValue({ data: null, error: { message: NO_AI_STATUS + ". Connect your AI service in Settings, Your AI, before analysis." } });
    renderDialog();
    await waitFor(() => expect(state.statusReads).toBeGreaterThan(0), WAIT);
    await removeAI();
    await saveMoment();
    // The save read the status afresh, it still said none, so no extraction was asked for and the
    // person sees the same no-AI line.
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith({ title: "Moment created", description: NO_AI_FACTS }), WAIT);
    expect(invoke).not.toHaveBeenCalled();
  });
});
