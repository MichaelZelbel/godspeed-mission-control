// @vitest-environment jsdom
// #812: a moment saved by hand while no AI is connected says so and points to Settings, Your AI,
// the way the refused and unreachable cases already do (#796). The decision is made when the
// moment is saved, from the extraction's own answer, not from the state the tab cached when it
// opened: the connection may have been removed while the tab was open, so the cached picture can
// still say an AI is connected.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NO_AI_STATUS } from "../../../../core/no-ai.mjs";
import { NO_AI_FACTS } from "./moment-form.mjs";
import AddEventDialog from "./AddEventDialog";
import { WAIT } from "@/test/wait-limits";

const state = vi.hoisted(() => ({ providerConfigured: false, aiAvailability: undefined as string | undefined, inserted: [] as string[] }));
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
vi.mock("@/hooks/useAICreditsGate", () => ({
  useAICreditsGate: () => ({ checkCredits: () => true, providerConfigured: state.providerConfigured, aiAvailability: state.aiAvailability }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

class NoResize { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoResize as any;

// What the server answers for the extraction when no AI is connected (core/domains.mjs).
const serverSaid = (message: string) => ({ data: null, error: { message } });

async function saveMoment() {
  render(<AddEventDialog people={[]} onCreated={() => {}} open onOpenChange={() => {}} />);
  fireEvent.change(await screen.findByPlaceholderText("Short title for this moment", undefined, WAIT), { target: { value: "A saved moment" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Moment" }));
  await waitFor(() => expect(toast).toHaveBeenCalled(), WAIT);
  expect(state.inserted).toContain("moments");
}

describe("saving a moment by hand while no AI is connected", () => {
  afterEach(() => {
    cleanup();
    invoke.mockReset();
    invoke.mockResolvedValue({ data: {}, error: null });
    toast.mockClear();
    Object.assign(state, { providerConfigured: false, aiAvailability: undefined, inserted: [] });
  });

  it("says no AI is connected when the connection was removed while the tab was open", async () => {
    // The tab opened while an AI was connected, so its cached picture still says one is; the
    // connection was removed in Settings, Your AI, and the extraction answers for itself.
    state.providerConfigured = true;
    invoke.mockResolvedValue(serverSaid(NO_AI_STATUS + ". Connect your AI service in Settings, Your AI, before analysis."));
    await saveMoment();
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith({ title: "Moment created", description: NO_AI_FACTS }), WAIT);
  });

  it("gives a tab that opened with no AI connected the same answer, decided when the moment is saved", async () => {
    state.providerConfigured = false;
    state.aiAvailability = "none";
    invoke.mockResolvedValue(serverSaid(NO_AI_STATUS + ". Connect your AI service in Settings, Your AI, before analysis."));
    await saveMoment();
    // The answer came from the extraction asked at save time, not from the cached state.
    expect(invoke).toHaveBeenCalledWith("extract-moment-profile", { body: { moment_id: "moment-1" } });
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith({ title: "Moment created", description: NO_AI_FACTS }), WAIT);
  });

  it("keeps the plain confirmation when the AI works", async () => {
    state.providerConfigured = true;
    await saveMoment();
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce(), WAIT);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Moment created" });
  });
});
