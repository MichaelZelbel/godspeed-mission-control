// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { NewCollectionDialog } from "./Collections";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const { insert } = vi.hoisted(() => ({ insert: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ insert }) },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

describe("ordinary collection creation", () => {
  afterEach(() => {
    cleanup();
    insert.mockClear();
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", "   "],
  ])("explains a %s name beside the field and does not create", (_label, value) => {
    render(<MemoryRouter><NewCollectionDialog open onOpenChange={() => {}} /></MemoryRouter>);
    const name = screen.getByRole("textbox", { name: "Name" });
    fireEvent.change(name, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(screen.getByText("Name is required")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Name is required");
    expect(insert).not.toHaveBeenCalled();
  });
});
