// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import AddEventDialog from "./AddEventDialog";

const state = vi.hoisted(() => ({ providerConfigured: false }));
const invoke = vi.hoisted(() => vi.fn(async () => ({ data: {}, error: null })));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let result: any = { data: [], error: null };
    const chain: any = new Proxy({}, {
      get: (_target, property) => {
        if (property === "then") return (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
        if (property === "insert") return () => {
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

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner" }, session: { access_token: "token" } }),
}));
vi.mock("@/hooks/useAICreditsGate", () => ({
  useAICreditsGate: () => ({ checkCredits: () => true, providerConfigured: state.providerConfigured }),
}));

class NoResize { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoResize as any;

async function saveMoment() {
  render(<AddEventDialog people={[]} onCreated={() => {}} open onOpenChange={() => {}} />);
  fireEvent.change(await screen.findByPlaceholderText("Short title for this moment"), { target: { value: "A saved moment" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Moment" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Create Moment" })).not.toBeDisabled());
}

describe("moment profile extraction", () => {
  afterEach(() => {
    cleanup();
    invoke.mockClear();
    state.providerConfigured = false;
  });

  it("does not request extraction when no AI is available", async () => {
    await saveMoment();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("keeps requesting extraction when AI is available", async () => {
    state.providerConfigured = true;
    await saveMoment();
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("extract-moment-profile", { body: { moment_id: "moment-1" } });
  });
});
