// @vitest-environment jsdom
// #1040: a WhatsApp export read on a person's page sends nothing until the person starts it,
// suggests moments month by month, drops what the timeline already has, and saves only what is kept.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChatHistoryDialog } from "./ChatHistoryDialog";
import { NO_AI_CONNECT } from "../../../../core/no-ai.mjs";

const state = vi.hoisted(() => ({ connected: true, inserted: [] as any[], participants: [] as any[] }));
const invoke = vi.hoisted(() => vi.fn(async (_name: string, options: any): Promise<{ data: unknown; error: unknown }> => ({
  data: { moments: [
    { title: `Moving to Lisbon (${options.body.month})`, happened_at: options.body.month + "-03", quote: "We are moving", status: "past_fact", impact_level: 3, participants: ["Ben Beispiel"] },
    { title: "Birthday party", happened_at: options.body.month + "-10", quote: "Party!", status: "past_fact", impact_level: 2, participants: [] },
  ] }, error: null,
})));

vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, any[]> = {
    moments: [{ id: "m0", title: "Birthday party", happened_at: "2025-02-10T00:00:00Z", person_id: "mia" }],
    moment_participants: [], contacts: [{ id: "mia", name: "Mia Muster" }, { id: "ben", name: "Ben Beispiel" }],
  };
  const from = (table: string) => {
    let result: any = { data: rows[table] || [], error: null };
    const chain: any = new Proxy({}, {
      get: (_t, property) => {
        if (property === "then") return (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
        if (property === "insert") return (value: any) => {
          (table === "moments" ? state.inserted : state.participants).push(value);
          result = { data: table === "moments" ? { id: "new-" + state.inserted.length } : null, error: null };
          return chain;
        };
        return () => chain;
      },
    });
    return chain;
  };
  return { supabase: { from, functions: { invoke } } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/hooks/useAICreditsGate", () => ({ useAICreditsGate: () => ({ providerConfigured: state.connected }) }));

const chat = "[03.02.25, 18:04:11] Mia Muster: Wir ziehen nach Lissabon\n[03.03.25, 18:04:11] Ben Beispiel: Hallo";
const choose = (text: string, name = "_chat.txt") => fireEvent.change(screen.getByLabelText(/WhatsApp export file/), { target: { files: [new File([text], name)] } });
const open = () => render(<ChatHistoryDialog open onOpenChange={() => {}} personId="mia" personName="Mia Muster" people={[{ id: "mia", name: "Mia Muster" }, { id: "ben", name: "Ben Beispiel" }]} onSaved={() => {}} />);

afterEach(() => { cleanup(); invoke.mockClear(); state.inserted.length = 0; state.participants.length = 0; state.connected = true; });

describe("Add a chat history", () => {
  it("says what goes to the AI, sends nothing before Start, skips known moments and saves only kept ones", async () => {
    open(); choose(chat);
    expect(await screen.findByText(/sends this chat, month by month, to your connected AI. It covers 2 months/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText(/Done: all 2 months read/)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Moving to Lisbon (2025-02)")).toBeInTheDocument();
    expect(screen.getAllByText("Birthday party")).toHaveLength(1); // 2025-02-10 is on the timeline already; March's stays
    expect(state.inserted).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Keep Moving to Lisbon (2025-02)" }));
    await waitFor(() => expect(state.inserted).toHaveLength(1));
    expect(state.inserted[0]).toMatchObject({ person_id: "mia", happened_at: "2025-02-03", title: "Moving to Lisbon (2025-02)" });
    expect(state.participants[0].map((p: any) => p.person_id).sort()).toEqual(["ben", "mia"]);
  });
  it("refuses a file that is not a WhatsApp export in one sentence", async () => {
    open(); choose("milk\neggs", "list.txt");
    expect(await screen.findByRole("alert")).toHaveTextContent("This is not a WhatsApp chat export.");
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });
  it("with no AI connected says so and sends nothing", async () => {
    state.connected = false;
    open(); choose(chat);
    expect(await screen.findByText(NO_AI_CONNECT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
