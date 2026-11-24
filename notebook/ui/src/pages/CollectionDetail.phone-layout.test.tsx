// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import CollectionDetail from "./CollectionDetail";
import { WAIT } from "@/test/wait-limits";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const updates: unknown[] = [];
const malformed = {
  id: "legacy-1",
  user_id: "owner",
  name: "Books",
  slug: "books",
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
vi.mock("@/components/collections/CollectionItemsTree", () => ({ CollectionItemsTree: () => <aside /> }));
vi.mock("@/components/common/ConfirmDialog", () => ({ useConfirmDialog: () => [vi.fn(), null] }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => null,
}));


// #1020: with no item open on a phone the page scrolls itself; a fixed-height
// overflow-hidden column squeezed search, New Item and the table into a ~32 px strip.
describe("a collection page with no item open, phone width", () => {
  afterEach(cleanup);

  const open = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/collections/:slug" element={<CollectionDetail />} />
        <Route path="/collections/:slug/:itemId" element={<CollectionDetail />} />
      </Routes>
    </MemoryRouter>,
  );

  it("lets the page scroll instead of clipping the table below the list", async () => {
    open("/collections/books");
    const page = await screen.findByTestId("collection-page", {}, WAIT);
    expect(page.className).toContain("max-lg:h-auto");
    expect(page.className).toContain("max-lg:overflow-visible");
    expect(page.className).toContain("lg:flex-row");
  });

  it("leaves the open-item layout alone", async () => {
    open("/collections/books/new");
    const page = await screen.findByTestId("collection-page", {}, WAIT);
    expect(page.className).not.toContain("max-lg:");
  });
});

// #1045: jsdom has no layout, so the classes that keep these inside a 320 px window are asserted.
describe("collection page phone fit (#1045)", () => {
  afterEach(cleanup);
  it("lets the action row wrap so '…' is not cut off", async () => {
    render(
      <MemoryRouter initialEntries={["/collections/books"]}>
        <Routes><Route path="/collections/:slug" element={<CollectionDetail />} /></Routes>
      </MemoryRouter>,
    );
    const row = await screen.findByTestId("collection-actions", {}, WAIT);
    expect(row.className).toContain("flex-wrap");
  });
});
