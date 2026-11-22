// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import CollectionDetail from "./CollectionDetail";
import { WAIT } from "@/test/wait-limits";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const coll = {
  id: "c1", user_id: "owner", name: "Books", slug: "books", icon: "📚", description: null,
  visibility: "private", field_schema: [{ key: "name", label: "Name", type: "text", primary: true }],
  agent_instructions: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
const item = {
  id: "i1", collection_id: "c1", user_id: "owner", data: { name: "One" }, title: "One",
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};

function queryFor(table: string) {
  const result = () =>
    table === "collections" ? { data: [coll], error: null }
    : table === "collection_items" ? { data: [item], error: null, count: 1 }
    : { data: [], error: null };
  const query: Record<string, unknown> = {
    select: () => query, eq: () => query, order: () => query, range: () => query,
    in: () => query, is: () => query, filter: () => query, not: () => query, neq: () => query, ilike: () => query, contains: () => query, limit: () => query, or: () => query,
    maybeSingle: async () => ({ data: coll, error: null }),
    single: async () => ({ data: item, error: null }),
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

function open(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/collections/:slug" element={<CollectionDetail />} />
        <Route path="/collections/:slug/:itemId" element={<CollectionDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("a collection item at phone width", () => {
  afterEach(cleanup);

  it("hides the item list below the desktop width and keeps it beside the item on desktop", async () => {
    open("/collections/books/i1");
    const view = await screen.findByTestId("collection-item-view", undefined, WAIT);
    const list = screen.getByTestId("collection-items-list");
    expect(list.className).toContain("hidden");
    expect(list.className).toContain("lg:flex");
    expect(view.parentElement?.className).toContain("lg:flex-row");
  });

  it("offers a way back to the list that is only shown on phones", async () => {
    open("/collections/books/i1");
    const back = await screen.findByRole("button", { name: /Back to list/ }, WAIT);
    expect(back.className).toContain("lg:hidden");
    fireEvent.click(back);
    const list = await screen.findByTestId("collection-items-list", undefined, WAIT);
    expect(list.className).not.toContain("hidden lg:flex");
    expect(screen.queryByRole("button", { name: /Back to list/ })).toBeNull();
  });
});
