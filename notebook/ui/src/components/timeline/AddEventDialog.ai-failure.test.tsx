// @vitest-environment jsdom
// #779: a moment is always saved, and when the AI refused the key, could not be reached or stopped answering its
// confirmation says that no facts were pulled out of it, and where to look.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AI_REFUSED_STATUS, AI_STALLED_STATUS, AI_UNREACHABLE_STATUS } from "../../../../core/no-ai.mjs";
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

const REFUSED_FACTS = "No facts were pulled out of it. " + AI_REFUSED_STATUS + ". Check it in Settings, Your AI.";
const UNREACHABLE_FACTS = "No facts were pulled out of it. " + AI_UNREACHABLE_STATUS + ". Check its connection in Settings, Your AI.";
const STALLED_FACTS = "No facts were pulled out of it. " + AI_STALLED_STATUS + ". Try again in a moment, or check it in Settings, Your AI.";
// What the server answers for the extraction (server/main.mjs plainAIFailure).
const serverSaid = (message: string) => ({ data: null, error: { message } });

async function saveMoment() {
  render(<AddEventDialog people={[]} onCreated={() => {}} open onOpenChange={() => {}} />);
  fireEvent.change(await screen.findByPlaceholderText("Short title for this moment", undefined, WAIT), { target: { value: "A saved moment" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Moment" }));
  await waitFor(() => expect(toast).toHaveBeenCalled(), WAIT);
  expect(state.inserted).toContain("moments");
}

describe("saving a moment while the AI fails", () => {
  afterEach(() => {
    cleanup();
    invoke.mockReset();
    invoke.mockResolvedValue({ data: {}, error: null });
    toast.mockClear();
    Object.assign(state, { providerConfigured: false, aiAvailability: undefined, inserted: [] });
  });

  it("says no facts were pulled out when the extraction finds the key refused", async () => {
    state.providerConfigured = true;
    invoke.mockResolvedValue(serverSaid(AI_REFUSED_STATUS + ". Check it in Settings, Your AI, then try again."));
    await saveMoment();
    expect(toast).toHaveBeenNthCalledWith(1, { title: "Moment created" });
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith({ title: "Moment created", description: REFUSED_FACTS }), WAIT);
  });

  it("says no facts were pulled out when the extraction cannot reach the AI", async () => {
    state.providerConfigured = true;
    invoke.mockResolvedValue(serverSaid(AI_UNREACHABLE_STATUS + ". Check its connection in Settings, Your AI, then try again."));
    await saveMoment();
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith({ title: "Moment created", description: UNREACHABLE_FACTS }), WAIT);
  });

  it("says the AI is not answering, not that it could not be reached, when the extraction stalls", async () => {
    state.providerConfigured = true;
    invoke.mockResolvedValue(serverSaid(AI_STALLED_STATUS + ". Try again in a moment, or check it in Settings, Your AI."));
    await saveMoment();
    await waitFor(() => expect(toast).toHaveBeenLastCalledWith({ title: "Moment created", description: STALLED_FACTS }), WAIT);
  });

  it("says it at once, without asking the AI, when the AI is already known to be refused, unreachable or stalled", async () => {
    for (const [kind, sentence] of [["refused", REFUSED_FACTS], ["unreachable", UNREACHABLE_FACTS], ["stalled", STALLED_FACTS]]) {
      state.aiAvailability = kind;
      await saveMoment();
      expect(toast).toHaveBeenCalledWith({ title: "Moment created", description: sentence });
      cleanup();toast.mockClear();
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps the plain confirmation when no AI is connected or the extraction worked", async () => {
    state.aiAvailability = "none";
    await saveMoment();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: "Moment created" });
    cleanup();toast.mockClear();
    Object.assign(state, { providerConfigured: true, aiAvailability: "ready" });
    await saveMoment();
    await waitFor(() => expect(invoke).toHaveBeenCalledOnce(), WAIT);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
