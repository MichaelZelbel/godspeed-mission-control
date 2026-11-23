// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import CollectionDetail from "./CollectionDetail";
import { WAIT } from "@/test/wait-limits";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const collection = {
  id: "c1", user_id: "owner", name: "Books", slug: "books", icon: "📚", description: "",
  visibility: "private", field_schema: [], agent_instructions: null,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
const state = { title: "" };
const item = () => ({
  id: "i1", collection_id: "c1", user_id: "owner", data: {}, title: state.title,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
  folder_id: null, is_favorite: false, last_viewed_at: null,
});

function queryFor(table: string) {
  const rows = () => (table === "collections" ? [collection] : table === "collection_items" ? [item()] : []);
  const query: Record<string, unknown> = {
    select: () => query, eq: () => query, order: () => query, range: () => query, filter: () => query,
    is: () => query, in: () => query, limit: () => query, or: () => query, ilike: () => query,
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows(), error: null, count: rows().length }).then(resolve),
  };
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => queryFor(table) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/collections/CollectionChatPanel", () => ({ CollectionChatPanel: () => null }));
vi.mock("@/components/collections/CollectionItemsTree", () => ({ CollectionItemsTree: () => null }));
vi.mock("@/components/common/ConfirmDialog", () => ({ useConfirmDialog: () => [vi.fn(), null] }));

describe("a collection item's heading", () => {
  afterEach(() => cleanup());

  it.each([
    ["words", "A long item name with many normal words ".repeat(5).trim()],
    ["unbroken", "y".repeat(120)],
    ["short", "Short name"],
  ])("shows the whole name (%s) without a one-line cut", async (kind, name) => {
    state.title = name;
    render(
      <MemoryRouter initialEntries={["/collections/books/i1"]}>
        <Routes><Route path="/collections/:slug/:itemId" element={<CollectionDetail />} /></Routes>
      </MemoryRouter>,
    );
    const heading = await screen.findByRole("heading", { name, level: 2 }, WAIT);
    expect(heading.className).not.toMatch(/\btruncate\b|whitespace-nowrap|text-ellipsis/);
    if (kind !== "short") expect(heading.className).toContain("overflow-wrap:anywhere");
  });
});
