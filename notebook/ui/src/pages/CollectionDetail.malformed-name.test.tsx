// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import CollectionDetail from "./CollectionDetail";
import { WAIT } from "@/test/wait-limits";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const { updates } = vi.hoisted(() => ({ updates: [] as unknown[] }));
const malformed = {
  id: "legacy-1",
  user_id: "owner",
  name: "",
  slug: "legacy-blank",
  icon: "📚",
  description: "Kept description",
  visibility: "private",
  field_schema: [],
  agent_instructions: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function queryFor(table: string) {
  let update: Record<string, unknown> | null = null;
  const result = () => table === "collections" ? { data: [malformed], error: null } : { data: [], error: null };
  const query: Record<string, unknown> = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: () => query,
    update: (value: Record<string, unknown>) => { update = value; updates.push(value); return query; },
    maybeSingle: async () => ({ data: malformed, error: null }),
    single: async () => ({ data: { ...malformed, ...update }, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => queryFor(table) },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/collections/CollectionChatPanel", () => ({ CollectionChatPanel: () => null }));
vi.mock("@/components/collections/CollectionItemsTree", () => ({ CollectionItemsTree: () => null }));
vi.mock("@/components/common/ConfirmDialog", () => ({ useConfirmDialog: () => [vi.fn(), null] }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => null,
}));

describe("a collection page with a legacy blank name", () => {
  afterEach(() => {
    cleanup();
    updates.length = 0;
  });

  it("opens and can be renamed", async () => {
    render(
      <MemoryRouter initialEntries={["/collections/legacy-blank"]}>
        <Routes><Route path="/collections/:slug" element={<CollectionDetail />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Collection actions" }, WAIT)).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Edit Collection" }, WAIT));
    const editDialog = await screen.findByRole("dialog", { name: "Edit Collection" }, WAIT);
    const name = within(editDialog).getAllByRole("textbox")[0];
    expect(name).toHaveValue("");
    fireEvent.change(name, { target: { value: "Recovered collection" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updates).toContainEqual(expect.objectContaining({ name: "Recovered collection" })), WAIT);
    expect(await screen.findByRole("heading", { name: /Recovered collection/ }, WAIT)).toBeInTheDocument();
  });
});
