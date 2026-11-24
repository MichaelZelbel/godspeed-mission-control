// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import CollectionDetail from "./CollectionDetail";
import { WAIT } from "@/test/wait-limits";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const collection = {
  id: "c1",
  user_id: "owner",
  name: "Books",
  slug: "books",
  icon: "📚",
  description: null,
  visibility: "private",
  field_schema: [{ key: "name", label: "Name", type: "text", primary: true }],
  agent_instructions: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};
const item = {
  id: "i1",
  collection_id: "c1",
  user_id: "owner",
  data: { name: "One" },
  title: "One",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

function queryFor(table: string) {
  const result = () =>
    table === "collections"
      ? { data: [collection], error: null }
      : table === "collection_items"
        ? { data: [item], error: null, count: 1 }
        : { data: [], error: null };
  const query: Record<string, unknown> = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: () => query,
    in: () => query,
    is: () => query,
    filter: () => query,
    not: () => query,
    neq: () => query,
    ilike: () => query,
    contains: () => query,
    limit: () => query,
    or: () => query,
    maybeSingle: async () => ({
      data: table === "collection_items" ? item : collection,
      error: null,
    }),
    single: async () => ({ data: item, error: null }),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve),
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

function BrowserBackButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Browser back</button>;
}

function open(path: string, initialEntries = [path]) {
  render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      <BrowserBackButton />
      <Routes>
        <Route path="/collections/:slug" element={<CollectionDetail />} />
        <Route path="/collections/:slug/:itemId" element={<CollectionDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("a collection page at phone width", () => {
  afterEach(cleanup);

  it("lets the page scroll instead of clipping the table when no item is open", async () => {
    open("/collections/books");
    const page = await screen.findByTestId("collection-page", {}, WAIT);
    expect(page.className).toContain("max-lg:h-auto");
    expect(page.className).toContain("max-lg:overflow-visible");
    expect(page.className).toContain("lg:flex-row");
  });

  it("hides the list on phones and keeps it beside an open item on desktop", async () => {
    open("/collections/books/i1");
    const view = await screen.findByTestId("collection-item-view", {}, WAIT);
    const list = screen.getByTestId("collection-items-list");
    expect(list.className).toContain("hidden");
    expect(list.className).toContain("lg:flex");
    expect(view.parentElement?.className).toContain("lg:flex-row");
  });

  it("uses the section scroll on phones and keeps the nested field scroll on desktop", async () => {
    open("/collections/books/i1");
    const fields = await screen.findByTestId("inline-item-fields", {}, WAIT);
    const sheet = screen.getByTestId("inline-item-sheet");
    expect(fields.className).not.toMatch(/(^|\s)overflow-y-auto(\s|$)/);
    expect(fields.className).toContain("lg:overflow-y-auto");
    expect(fields.className).toContain("lg:flex-1");
    expect(sheet.className).not.toMatch(/(^|\s)h-full(\s|$)/);
    expect(sheet.className).toContain("lg:h-full");

    const save = screen.getByRole("button", { name: "Save" });
    expect(save.parentElement?.className).toContain("flex-wrap");
    expect(save.parentElement?.parentElement?.className).toContain("flex-wrap");
    const newNote = screen.getByRole("button", { name: "New note" });
    expect(newNote.parentElement?.className).toContain("flex-wrap");
  });

  it("offers a phone-only way back to the list", async () => {
    open("/collections/books/i1");
    const back = await screen.findByRole("button", { name: /Back to list/ }, WAIT);
    expect(back.className).toContain("lg:hidden");
    fireEvent.click(back);
    const list = await screen.findByTestId("collection-items-list", {}, WAIT);
    expect(list.className).not.toContain("hidden lg:flex");
    expect(screen.queryByRole("button", { name: /Back to list/ })).toBeNull();
  });

  it("returns to the list with browser Back", async () => {
    open("/collections/books/i1", ["/collections/books", "/collections/books/i1"]);
    await screen.findByTestId("inline-item-fields", {}, WAIT);
    fireEvent.click(screen.getByRole("button", { name: "Browser back" }));
    await waitFor(() => {
      expect(screen.getByTestId("collection-items-list").className).not.toContain("hidden lg:flex");
      expect(screen.queryByRole("button", { name: /Back to list/ })).toBeNull();
    }, WAIT);
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
