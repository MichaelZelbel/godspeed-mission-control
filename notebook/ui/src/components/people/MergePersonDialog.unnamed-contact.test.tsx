// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { MergePersonDialog } from "./MergePersonDialog";

// Issue #154, review of #155: merging a contact that has no name named it nowhere.
const nameless: any = { id: "review-0001", aliases: [] };
const candidate: any = { id: "review-0002", name: null, aliases: [null, "  "] };
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy({}, { get: (_t, prop) => prop === "then" ? (res: any) => Promise.resolve({ count: 0, data: [], error: null }).then(res) : () => chain });
  return { supabase: { rpc: vi.fn(async () => ({ data: null, error: null })), from: () => chain } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/hooks/usePeopleSync", () => ({ usePeopleSync: () => ({ triggerPeopleSync: vi.fn() }) }));
vi.mock("@/hooks/usePeople", () => ({
  usePeople: () => ({ data: [candidate], isLoading: false }),
  usePerson: () => ({ data: null }),
}));

describe("the merge dialog for a contact that has no name", () => {
  afterEach(cleanup);
  it("names it, and a nameless candidate, as Unnamed person", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MergePersonDialog open onOpenChange={() => {}} sourcePerson={nameless}
      allPeople={[nameless, candidate]} onMergeComplete={() => {}} /></QueryClientProvider>);
    expect(await screen.findByText("Merge Unnamed person")).toBeInTheDocument();
    expect(screen.getAllByText("Unnamed person").length).toBeGreaterThan(0);
  });
});
