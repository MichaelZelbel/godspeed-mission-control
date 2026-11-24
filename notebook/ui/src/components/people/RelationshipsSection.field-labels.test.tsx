// @vitest-environment jsdom
// The person relationship form names each of its fields (#742): it has no
// visible labels, so each list button and the custom label box carries its own name.
import { afterEach, describe, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { expectFieldsNamed, isListButton, isTextbox } from "@/test/field-labels";
import { createFakeSupabase } from "@/test/fake-supabase";
import { RelationshipsSection } from "./RelationshipsSection";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current.client; } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/hooks/useContactRelationships", () => ({
  isDuplicateRelationshipError: () => false,
  useContactRelationships: () => ({ relationships: [], isLoading: false, upsertRelationship: { mutateAsync: vi.fn(), isPending: false }, deleteRelationship: { mutateAsync: vi.fn(), isPending: false } }),
}));

describe("the add relationship form", () => {
  afterEach(cleanup);
  it("names every field", () => {
    fake.current = createFakeSupabase(() => undefined);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><RelationshipsSection contactId="person-ada" contactName="Fictional Ada" /></MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add relationship" }));
    const form = screen.getByLabelText("Custom label (optional)").closest("div.space-y-2") as HTMLElement;
    expectFieldsNamed(form, [
      { name: "Relationship", is: isListButton },
      { name: "Custom label (optional)", is: isTextbox },
      { name: "Related to", is: isListButton },
      { name: "Person", is: isListButton },
    ]);
  });
});
