// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { RecentPeopleCard } from "./RecentPeopleCard";
import { WAIT } from "@/test/wait-limits";

// Issue 960: the empty Recent People card said "to start cherishing", wording
// from the Cherishly skin that Godspeed never uses elsewhere. The Godspeed
// wording is "No one here yet. Add your first person."
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy({}, { get: (_t, prop) => prop === "then" ? (res: any) => Promise.resolve({ data: [], error: null }).then(res) : () => chain });
  return { supabase: { from: () => chain } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

describe("Recent People with no people yet", () => {
  afterEach(cleanup);
  it("uses the Godspeed empty-state wording", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><RecentPeopleCard /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText(/No one here yet\./, undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText(/Add your first person\./)).toBeInTheDocument();
    expect(screen.queryByText(/cherishing/i)).toBeNull();
  });
});
