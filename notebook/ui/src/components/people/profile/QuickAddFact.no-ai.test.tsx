// @vitest-environment jsdom
// #886: with no AI connected, a person's "Add a fact" sent a classification request that failed
// with 400 and said "Connect an assistant before classifying a fact", which named no place, and
// the typed fact went nowhere. It now says the shared no-AI sentence (core/no-ai.mjs), which names
// Settings, Your AI, sends nothing, and keeps what was typed in the box.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NO_AI_CONNECT } from "../../../../../core/no-ai.mjs";
import { QuickAddFact } from "./QuickAddFact";
import { WAIT } from "@/test/wait-limits";

const state = vi.hoisted(() => ({
  aiAvailability: undefined as string | undefined,
  committed: [] as string[],
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const invoke = vi.hoisted(() => vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: {}, error: null })));

vi.mock("@/hooks/useAICredits", () => ({
  useAICredits: () => ({ credits: null, providerConfigured: state.aiAvailability === "ready", aiAvailability: state.aiAvailability, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/lib/toast", () => ({ showToast: toast }));

// A FunctionsHttpError as supabase.functions.invoke answers a 400: its message is always the same
// words, and the function's own answer sits in `.context`, a Response.
const httpError = (message: string) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify({ error: message }), { status: 400 }),
  });

function typeFact(value = "loves hotpot") {
  const box = screen.getByRole("textbox", { name: "Add a fact" });
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: "Enter" });
  return box;
}

afterEach(() => {
  cleanup();
  Object.assign(state, { aiAvailability: undefined, committed: [] });
  invoke.mockReset();
  invoke.mockResolvedValue({ data: {}, error: null });
  for (const fn of Object.values(toast)) fn.mockClear();
});

describe("a person's Add a fact box while no AI is connected", () => {
  it("says the shared no-AI sentence, sends nothing and keeps what was typed", async () => {
    state.aiAvailability = "none";
    render(<QuickAddFact contactId="contact-1" onCommit={async () => {}} />);
    const box = typeFact();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NO_AI_CONNECT), WAIT);
    expect(invoke).not.toHaveBeenCalled();
    expect(box).toHaveValue("loves hotpot");
  });

  it("says the shared sentence for the server's own answer when the connection was removed seconds ago", async () => {
    state.aiAvailability = "ready";
    invoke.mockResolvedValue({ data: null, error: httpError("Connect an assistant before classifying a fact") });
    render(<QuickAddFact contactId="contact-1" onCommit={async () => {}} />);
    const box = typeFact();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NO_AI_CONNECT), WAIT);
    // The server's own words, which name no place, never reach the screen.
    expect(toast.error).not.toHaveBeenCalledWith("Connect an assistant before classifying a fact");
    expect(box).toHaveValue("loves hotpot");
  });

  it("classifies and files the fact when an AI is connected", async () => {
    state.aiAvailability = "ready";
    invoke.mockResolvedValue({ data: { label: "Favourite food", value: "Fictional ramen", category_slug: "preferences", category_name: "Preferences" }, error: null });
    const onCommit = vi.fn(async (fact: { category_slug: string }) => { state.committed.push(fact.category_slug); });
    render(<QuickAddFact contactId="contact-1" onCommit={onCommit} />);
    const box = typeFact();
    await waitFor(() => expect(screen.getByRole("button", { name: "Filing under Preferences as Favourite food. Click to re-file." })).toBeInTheDocument(), WAIT);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(state.committed).toEqual(["preferences"]), WAIT);
    // A saved fact leaves the box empty again.
    expect(box).toHaveValue("");
  });
});
