// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { PersonDetail } from "./PersonDetail";
import { WAIT } from "@/test/wait-limits";

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = new Proxy({}, { get: (_t, prop) => prop === "then" ? (res: any) => Promise.resolve({ data: [], error: null }).then(res) : () => chain });
  return { supabase: { rpc: vi.fn(async () => ({ data: [], error: null })), from: () => chain, functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) } } };
});
const { auth } = vi.hoisted(() => ({ auth: { user: { id: "owner" }, session: { access_token: "t", user: { id: "owner" } } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true, usePanesTogether: () => false }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/hooks/usePeople", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return { useUpdatePerson: mutation, useDeletePerson: mutation, useToggleFavoritePerson: mutation, useTouchPersonViewed: mutation };
});
vi.mock("@/components/people/ContactProfileTab", () => ({ ContactProfileTab: () => null }));
vi.mock("@/components/people/MergePersonDialog", () => ({ MergePersonDialog: () => null }));
vi.mock("@/components/people/ConversationTab", () => ({ ConversationTab: () => null }));
vi.mock("@/components/people/ProfileHealthChip", () => ({ ProfileHealthChip: () => null }));
vi.mock("@/components/people/ContactTopicsPanel", () => ({ ContactTopicsPanel: () => null }));
vi.mock("@/components/people/PersonTimeline", () => ({ PersonTimeline: () => null }));
vi.mock("@/components/people/PersonDocuments", () => ({ PersonDocuments: () => null }));
vi.mock("@/components/people/PersonGroupsTab", () => ({ PersonGroupsTab: () => null }));
vi.mock("@/components/common/AiVisibilityButton", () => ({ AiVisibilityButton: () => null }));

const words = "Maria Anna Katharina von Hohenzollern-Sigmaringen ".repeat(5).trim().slice(0, 200).trim();
const oneWord = "W".repeat(200);

function heading(name: string) {
  const person: any = { id: "p1", name, aliases: [] };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><PersonDetail person={person} people={[person]} onClose={() => {}} /></MemoryRouter></QueryClientProvider>);
  return screen.findByRole("heading", { name }, WAIT);
}

describe("a person page with a 200-character name", () => {
  afterEach(cleanup);
  it.each([["ordinary words", words], ["one unbroken word", oneWord]])("shows %s in full and wraps it", async (_l, name) => {
    const h = await heading(name);
    const text = h.querySelector("span.min-w-0")!;
    for (const el of [h, text]) {
      expect(el.className).not.toMatch(/truncate|line-clamp|whitespace-nowrap|overflow-hidden|\bh-\d|max-h-/);
    }
    expect(text.className).toMatch(/break-words|overflow-wrap:anywhere/);
    expect(h.className).not.toContain("leading-none");
    expect(h).toHaveTextContent(name);
    // A header taller than a phone screen must scroll with the page, not stay pinned.
    const header = h.closest(".bg-background")!;
    expect(header.className).not.toMatch(/(^|\s)sticky/);
    expect(header.className).not.toContain("sm:sticky");
    // Pinned only when the window is wide and tall enough (a phone held sideways is short).
    expect(header.className).toContain("min-height:600px)]:sticky");
  });
});
