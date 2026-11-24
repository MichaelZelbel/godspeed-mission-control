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
  name: "Blank",
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

describe("a collection with no fields (#1018)", () => {
  afterEach(() => cleanup());

  it("New Item says there are no fields, links to Schema and cannot save", async () => {
    render(
      <MemoryRouter initialEntries={["/collections/legacy-blank/new"]}>
        <Routes><Route path="/collections/:slug/:itemId" element={<CollectionDetail />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no fields yet/, undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Schema page/ })).toHaveAttribute("href", "/collections/legacy-blank/schema");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("the breadcrumb wraps an unbroken name inside its card", async () => {
    render(
      <MemoryRouter initialEntries={["/collections/legacy-blank/new"]}>
        <Routes><Route path="/collections/:slug/:itemId" element={<CollectionDetail />} /></Routes>
      </MemoryRouter>,
    );
    const crumb = (await screen.findByRole("link", { name: "Collections" }, WAIT)).closest("p");
    expect(crumb?.className).toContain("[overflow-wrap:anywhere]");
  });
});
