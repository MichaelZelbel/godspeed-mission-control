// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { AICollectionDialog } from "./AICollectionDialog";

const { insert, invoke } = vi.hoisted(() => ({
  insert: vi.fn(),
  invoke: vi.fn(async () => ({
    data: {
      collection: { name: "Reading list", icon: "📚", description: "Books", visibility: "private" },
      field_schema: [{ key: "title", label: "Title", type: "text", primary: true }],
      agent_instructions: "Capture books.",
    },
    error: null,
  })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke },
    from: () => ({
      insert: (values: unknown) => {
        insert(values);
        return { select: () => ({ single: async () => ({ data: { slug: "reading-list" }, error: null }) }) };
      },
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

describe("AI collection name", () => {
  afterEach(() => {
    cleanup();
    insert.mockClear();
    invoke.mockClear();
  });

  it("explains a blank edited name beside the field and does not save", async () => {
    render(<MemoryRouter><AICollectionDialog open onOpenChange={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Make a reading list for my books" } });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    const name = await screen.findByRole("textbox", { name: "Collection name" });
    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save Collection" }));

    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(insert).not.toHaveBeenCalled();
  });

  it("saves a name longer than the ordinary form limit", async () => {
    render(<MemoryRouter><AICollectionDialog open onOpenChange={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Make a reading list for my books" } });
    fireEvent.click(screen.getByRole("button", { name: /generate/i }));

    const longName = "A".repeat(61);
    fireEvent.change(await screen.findByRole("textbox", { name: "Collection name" }), { target: { value: longName } });
    fireEvent.click(screen.getByRole("button", { name: "Save Collection" }));

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ name: longName }));
  });
});
