// @vitest-environment jsdom
// #834: a group's AI Match Members button went grey with no explanation when the Dashboard's AI
// check had seen a refused key or an unreachable AI. The disabled button now says why beside
// itself, in the same plain sentences the other AI actions use (core/no-ai.mjs), each with the way
// to Settings, Your AI, and never the provider's own words ("HTTP 401", "not valid JSON").
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { AI_CONNECTION_UNREADABLE_STATUS, AI_REFUSED, AI_STALLED_STATUS, AI_UNREACHABLE, NO_AI_ANALYSIS } from "../../../../core/no-ai.mjs";
import { SuggestMembersButton } from "./SuggestMembersButton";
import { WAIT } from "@/test/wait-limits";

const state = vi.hoisted(() => ({
  providerConfigured: false,
  aiAvailability: undefined as string | undefined,
  invoke: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: { suggestions_added: 1 }, error: null })),
}));

vi.mock("@/hooks/useAICredits", () => ({
  useAICredits: () => ({ credits: null, providerConfigured: state.providerConfigured, aiAvailability: state.aiAvailability, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: state.invoke } } }));

function renderButton() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><SuggestMembersButton groupId="group-1" /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// What the notice beside the button reads, sentence and the way to Settings, Your AI.
const noticeText = (sentence: string) => sentence + " Open Settings, Your AI";

afterEach(() => {
  cleanup();
  Object.assign(state, { providerConfigured: false, aiAvailability: undefined });
  state.invoke.mockReset();
  state.invoke.mockResolvedValue({ data: { suggestions_added: 1 }, error: null });
});

describe("the AI Match Members button while the AI fails", () => {
  it("says the refused-key sentence beside the greyed button", () => {
    state.aiAvailability = "refused";
    renderButton();
    expect(screen.getByRole("button", { name: "AI Match Members" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(noticeText(AI_REFUSED));
    expect(screen.getByRole("link", { name: "Open Settings, Your AI" })).toHaveAttribute("href", "/dashboard/settings#connect-ai");
  });

  it("says the outage sentence when the AI cannot be reached", () => {
    state.aiAvailability = "unreachable";
    renderButton();
    expect(screen.getByRole("status")).toHaveTextContent(noticeText(AI_UNREACHABLE));
  });

  it("says the AI is not answering when it stalled", () => {
    state.aiAvailability = "stalled";
    renderButton();
    expect(screen.getByRole("status")).toHaveTextContent(noticeText(AI_STALLED_STATUS + ". Try again in a moment, or check it in Settings, Your AI."));
  });

  it("says no AI is connected yet instead of a silent grey button", () => {
    state.aiAvailability = "none";
    renderButton();
    expect(screen.getByRole("button", { name: "AI Match Members" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(noticeText(NO_AI_ANALYSIS));
  });

  // #826: the saved connection exists but cannot be read, so the button says what Settings says.
  it("says the saved connection cannot be read when its file is damaged", () => {
    state.aiAvailability = "unreadable";
    renderButton();
    expect(screen.getByRole("button", { name: "AI Match Members" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(noticeText(AI_CONNECTION_UNREADABLE_STATUS));
  });

  it("shows no provider's own words in any of these states", () => {
    for (const availability of ["refused", "unreachable", "stalled", "none"]) {
      state.aiAvailability = availability;
      const { unmount } = renderButton();
      expect(document.body.textContent).toMatch(/Your AI (key|could not|is not)|No AI is connected yet/);
      expect(document.body.textContent).not.toMatch(/HTTP \d{3}|not valid JSON|Incorrect API key|at .*\(/);
      unmount();
      cleanup();
    }
  });

  it("works and stays quiet with a working AI", async () => {
    state.providerConfigured = true;
    state.aiAvailability = "ready";
    renderButton();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "AI Match Members" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(state.invoke).toHaveBeenCalledTimes(1), WAIT);
    expect(state.invoke).toHaveBeenCalledWith("suggest-group-members", { body: { group_id: "group-1" } });
  });
});
