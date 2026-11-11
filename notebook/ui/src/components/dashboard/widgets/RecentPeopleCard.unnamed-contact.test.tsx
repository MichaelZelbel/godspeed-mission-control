// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { RecentPeopleCard } from "./RecentPeopleCard";

// Issue 266: Recent People listed a person saved without a name, as "Unnamed person".
const rows = [
  { id: "review-0001", name: null, aliases: [], relationship: null, updated_at: "2026-11-01T10:00:00Z" },
  { id: "blank", name: "  ", aliases: [null, ""], relationship: null, updated_at: "2026-10-31T10:00:00Z" },
  ...["Ada", "Ben", "Cleo", "Dan", "Eve", "Finn"].map((name, i) => ({ id: name, name, aliases: [], relationship: null, updated_at: `2026-10-${20 - i}T10:00:00Z` })),
];
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy({}, { get: (_t, prop) => prop === "then" ? (res: any) => Promise.resolve({ data: rows, error: null }).then(res) : () => chain });
  return { supabase: { from: () => chain } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

describe("Recent People with people saved without a name", () => {
  afterEach(cleanup);
  it("leaves them out and still shows five people", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><RecentPeopleCard /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("Unnamed person")).toBeNull();
    expect(["Ada", "Ben", "Cleo", "Dan", "Eve"].every((name) => screen.queryByText(name))).toBe(true);
    expect(screen.queryByText("Finn")).toBeNull();
  });
});
