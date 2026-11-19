// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import CollectionTemplates from "./CollectionTemplates";
import { WAIT } from "@/test/wait-limits";

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));

const template = {
  agent_instructions: "Capture books.",
  category: "Personal",
  created_at: "2026-01-01T00:00:00.000Z",
  description: "Books to read",
  field_schema: [{ key: "title", label: "Title", type: "text", primary: true }],
  icon: "📚",
  id: "template-1",
  name: "Reading List",
  official: true,
  slug: "reading-list",
  usage_count: 1,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "collection_templates") {
        const query = {
          select: () => query,
          order: () => query,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [template], error: null }).then(resolve),
        };
        return query;
      }
      return { insert };
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

describe("template collection name", () => {
  afterEach(() => {
    cleanup();
    insert.mockClear();
  });

  it("explains a blank name beside the field and does not create", async () => {
    render(<MemoryRouter><CollectionTemplates /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Preview the Reading List template" }, WAIT));
    fireEvent.click(screen.getByRole("button", { name: "Use This Template" }));
    const name = screen.getByRole("textbox", { name: "Collection name" });
    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(insert).not.toHaveBeenCalled();
  });
});
