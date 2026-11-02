// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { PersonDetail } from "./PersonDetail";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  // Older databases lack notes_mentioning_people: the page then scans the newest notes itself.
  const notes = [{ id: "n1", title: "Lunch", created_at: "2026-10-01", metadata: { people: [null, 7, "Somebody"] } }];
  const chain: any = new Proxy({}, { get: (_t, prop) => prop === "then" ? (res: any) => Promise.resolve({ data: notes, error: null }).then(res) : () => chain });
  return { supabase: { rpc, from: () => chain, functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) } } };
});
const { auth } = vi.hoisted(() => ({ auth: { user: { id: "owner" }, session: { access_token: "t", user: { id: "owner" } } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/hooks/usePeople", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return { useUpdatePerson: mutation, useDeletePerson: mutation, useToggleFavoritePerson: mutation, useTouchPersonViewed: mutation };
});
// The tabs have their own tests and queries; here they only need to receive the name safely.
vi.mock("@/components/people/ContactProfileTab", () => ({ ContactProfileTab: () => null }));
vi.mock("@/components/people/MergePersonDialog", () => ({ MergePersonDialog: () => null }));
vi.mock("@/components/people/ConversationTab", () => ({ ConversationTab: () => null }));
vi.mock("@/components/people/ProfileHealthChip", () => ({ ProfileHealthChip: () => null }));
vi.mock("@/components/people/ContactTopicsPanel", () => ({ ContactTopicsPanel: () => null }));
vi.mock("@/components/people/PersonTimeline", () => ({ PersonTimeline: () => null }));
vi.mock("@/components/people/PersonDocuments", () => ({ PersonDocuments: () => null }));
vi.mock("@/components/people/PersonGroupsTab", () => ({ PersonGroupsTab: () => null }));
vi.mock("@/components/common/AiVisibilityButton", () => ({ AiVisibilityButton: () => null }));

describe("a person page for a contact that has no name", () => {
  afterEach(cleanup);
  it("opens, shows Unnamed person, and still compares the notes' people safely", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "missing" } });
    const person: any = { id: "review-0001", aliases: ["Somebody"] };
    const other: any = { id: "x", name: "Ada", aliases: [] };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><PersonDetail person={person} people={[person, other]} onClose={() => {}} /></MemoryRouter></QueryClientProvider>);
    expect((await screen.findAllByText("Unnamed person")).length).toBeGreaterThan(0);
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(client.getQueryState(["contact_notes", undefined, ["Somebody"]])?.status).toBe("success");
  });
});
