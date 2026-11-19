// @vitest-environment jsdom
// The fields of a person's page while it is being edited can be found by their
// labels (#756): the New topic box, the Notes box and the box next to Facts.
// Clicking the visible New topic label puts the cursor in its box.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { ContactProfileTab } from "./ContactProfileTab";
import { ContactTopicsPanel } from "./ContactTopicsPanel";
import { clickLabel } from "@/test/label-click";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" }, session: { user: { id: "owner" } } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/hooks/useContactProfile", () => ({
  useContactProfile: () => ({ categories: [], isLoading: false, upsertCategory: { mutate: vi.fn() }, deleteCategory: { mutate: vi.fn() } }),
}));
vi.mock("@/hooks/useFacts", async (original) => ({
  ...(await original<typeof import("@/hooks/useFacts")>()),
  useFacts: () => ({ facts: [], isLoading: false, actions: {}, addFact: { mutateAsync: vi.fn() } }),
}));
vi.mock("@/hooks/useContactTopics", () => ({
  useContactTopics: () => ({ data: [], isPending: false, isError: false, online: true, refetch: vi.fn() }),
  useContactTopicCommand: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/components/people/RelationshipsSection", () => ({ RelationshipsSection: () => null }));
vi.mock("@/components/people/LifeEventsStrip", () => ({ LifeEventsStrip: () => null }));

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
}

afterEach(cleanup);

describe("a person's page, being edited", () => {
  it("names the Notes box by its visible label and the box next to Facts by what it is for", () => {
    wrap(<ContactProfileTab contactId="ada" contactName="Fictional Ada" notes="Likes tea." isEditingNotes onChangeNotes={vi.fn()} />);

    const notes = screen.getByLabelText("Notes", { exact: true });
    expect(notes.tagName).toBe("TEXTAREA");
    expect(notes).toHaveValue("Likes tea.");
    // Its name comes from the label, not only the placeholder.
    expect((notes as HTMLTextAreaElement).labels?.[0]).toHaveTextContent(/^Notes$/);
    clickLabel((notes as HTMLTextAreaElement).labels![0]);
    expect(document.activeElement).toBe(notes);

    expect(screen.getByRole("heading", { name: "Facts" })).toBeInTheDocument();
    const fact = screen.getByLabelText("Add a fact", { exact: true });
    expect(fact.tagName).toBe("INPUT");
    expect(fact).toHaveAttribute("placeholder", 'Add a fact, like "loves hotpot"');
  });

  it("puts the cursor in the New topic box when its visible label is clicked", () => {
    wrap(<ContactTopicsPanel contactId="ada" contactName="Fictional Ada" />);

    const box = screen.getByLabelText("New topic", { exact: true });
    expect(box.tagName).toBe("INPUT");
    expect(box).toHaveAttribute("placeholder", "Add a topic...");
    const label = (box as HTMLInputElement).labels![0];
    expect(label).toHaveTextContent(/^New topic$/);
    expect(label).not.toHaveClass("sr-only");

    clickLabel(label);
    expect(document.activeElement).toBe(box);
  });
});
