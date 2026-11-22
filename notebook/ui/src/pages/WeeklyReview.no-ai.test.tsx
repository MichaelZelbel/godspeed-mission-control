// @vitest-environment jsdom
// #886: with no AI connected, Weekly Review's Create Review sent a request that failed with 400 and
// said "Connect a model before generating a review", which named no place. It now says the shared
// no-AI sentence (core/no-ai.mjs), which names Settings, Your AI, and sends nothing; an answer the
// server gave for a connection removed a few seconds ago is said the same way.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
import { NO_AI_CONNECT } from "../../../core/no-ai.mjs";
import WeeklyReview from "./WeeklyReview";
import { WAIT } from "@/test/wait-limits";

const state = vi.hoisted(() => ({ aiAvailability: undefined as string | undefined }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));

vi.mock("@/hooks/useAICredits", () => ({
  useAICredits: () => ({ credits: null, providerConfigured: state.aiAvailability === "ready", aiAvailability: state.aiAvailability, isLoading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current; } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/lib/toast", () => ({ showToast: toast }));

// A FunctionsHttpError as supabase.functions.invoke answers a 400: its message is always the same
// words, and the function's own answer sits in `.context`, a Response.
const httpError = (message: string) =>
  Object.assign(new Error("Edge Function returned a non-2xx status code"), {
    name: "FunctionsHttpError",
    context: new Response(JSON.stringify({ error: message }), { status: 400 }),
  });

async function openPage(invokeResult?: (name: string, body: unknown) => Promise<{ data: unknown; error: unknown }>) {
  const supa = createFakeSupabase((q) => (q.table === "weekly_reviews" ? { data: [] } : undefined));
  if (invokeResult) supa.setInvokeResult(invokeResult);
  fake.current = {
    ...supa.client,
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WeeklyReview />
    </QueryClientProvider>,
  );
  // The page's own read is done: the empty state is on the screen.
  await screen.findByText("No reviews yet", undefined, WAIT);
  return supa;
}

const createReview = () => fireEvent.click(screen.getByRole("button", { name: "Create Review" }));

afterEach(() => {
  cleanup();
  Object.assign(state, { aiAvailability: undefined });
  for (const fn of Object.values(toast)) fn.mockClear();
});

describe("Weekly Review while no AI is connected", () => {
  it("says the shared no-AI sentence and sends nothing", async () => {
    state.aiAvailability = "none";
    const supa = await openPage();
    createReview();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NO_AI_CONNECT), WAIT);
    expect(supa.invocations).toHaveLength(0);
  });

  it("says the shared sentence for the server's own answer when the connection was removed seconds ago", async () => {
    state.aiAvailability = "ready";
    const supa = await openPage(async () => ({ data: null, error: httpError("Connect a model before generating a review") }));
    createReview();
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(NO_AI_CONNECT), WAIT);
    expect(supa.invocations.map((i) => i.name)).toEqual(["weekly-review"]);
    // The server's own words, which name no place, never reach the screen.
    expect(toast.error).not.toHaveBeenCalledWith("Connect a model before generating a review");
  });

  it("asks the server for the review when an AI is connected", async () => {
    state.aiAvailability = "ready";
    const supa = await openPage(async () => ({ data: { id: "r1", review_data: {}, created_at: "" }, error: null }));
    createReview();
    await waitFor(() => expect(supa.invocations.map((i) => i.name)).toEqual(["weekly-review"]), WAIT);
    expect(toast.success).toHaveBeenCalledWith("Weekly review generated.");
  });
});
