// @vitest-environment jsdom
// The collection item form and the Edit Collection dialog have every label
// tied to its field (#742): one field of each kind a collection can have.
import { afterEach, describe, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { expectFieldsNamed, isButton, isInputOfType, isListButton, isSwitch, isTextbox } from "@/test/field-labels";
import CollectionDetail from "./CollectionDetail";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
Element.prototype.scrollIntoView ??= () => {};

const field = (type: string, label: string, extra: Record<string, unknown> = {}) => ({ id: type, key: type, label, type, ...extra });
const collection = {
  id: "c1", user_id: "owner", name: "Fictional Books", slug: "books", icon: "📚", description: "", visibility: "private",
  field_schema: [
    field("text", "Title", { primary: true }), field("longtext", "Notes"), field("number", "Pages"), field("currency", "Price"),
    field("date", "Read on"), field("datetime", "Started"), field("boolean", "Owned"),
    field("select", "Shelf", { options: ["To read", "Read"] }), field("multiselect", "Tags", { options: ["Fiction", "Poetry"] }),
    field("url", "Website"), field("email", "Author email"), field("phone", "Shop phone"),
    field("link_note", "Review note"), field("link_person", "Lent to"), field("link_collection_item", "Sequel", { target_collection_slug: "books" }),
  ],
  agent_instructions: null, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};

function queryFor(table: string) {
  const result = () => table === "collections" ? { data: [collection], error: null } : { data: [], error: null };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "in", "or", "ilike", "filter", "order", "range", "limit", "update", "insert"]) query[method] = () => query;
  query.maybeSingle = async () => ({ data: collection, error: null });
  query.single = async () => ({ data: collection, error: null });
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => queryFor(table) } }));
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

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/collections/:slug/:itemId" element={<CollectionDetail />} />
        <Route path="/collections/:slug" element={<CollectionDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("a collection's forms", () => {
  afterEach(cleanup);

  it("the new item form, opened with its New Item button, names every field by its label", async () => {
    renderAt("/collections/books");
    fireEvent.click((await screen.findAllByRole("button", { name: "New Item" }))[0]);
    const title = await screen.findByLabelText("Title", { exact: true });
    const form = title.closest("form") ?? document.body;
    expectFieldsNamed(form as HTMLElement, [
      { name: "Title", is: isTextbox },
      { name: "Notes", is: (el) => el.tagName === "TEXTAREA" },
      { name: "Pages", is: isInputOfType("number") },
      { name: "Price", is: isInputOfType("number") },
      { name: "Read on", is: isButton },
      { name: "Started", is: isButton },
      { name: "Started time", is: isInputOfType("time") },
      { name: "Owned", is: isSwitch },
      { name: "Shelf", is: isListButton },
      { name: "Tags", is: isButton },
      { name: "Website", is: isInputOfType("url") },
      { name: "Author email", is: isInputOfType("email") },
      { name: "Shop phone", is: isInputOfType("tel") },
      { name: "Review note", is: isButton },
      { name: "Lent to", is: isButton },
      { name: "Sequel", is: isButton },
    ]);
  });

  it("the Edit Collection dialog names every field by its label", async () => {
    renderAt("/collections/books");
    fireEvent.click(await screen.findByRole("button", { name: "Edit Collection" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit Collection" });
    expectFieldsNamed(dialog, [
      { name: "Name", is: isTextbox },
      { name: "Icon", is: isTextbox },
      { name: "Description", is: (el) => el.tagName === "TEXTAREA" },
      { name: "Private (only me)", is: (el) => el.getAttribute("role") === "radio" },
      { name: "Personal (visible to my AI agents)", is: (el) => el.getAttribute("role") === "radio" },
    ]);
  });
});
