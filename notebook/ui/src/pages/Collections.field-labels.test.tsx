// @vitest-environment jsdom
// The New Collection dialog's labels name its fields (#742).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { expectFieldsNamed, isTextbox } from "@/test/field-labels";
import { NewCollectionDialog } from "./Collections";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert: vi.fn() }) } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

describe("the New Collection dialog", () => {
  afterEach(cleanup);
  it("has every label tied to its field", () => {
    render(<MemoryRouter><NewCollectionDialog open onOpenChange={() => {}} /></MemoryRouter>);
    const dialog = screen.getByRole("dialog", { name: "New Collection" });
    expectFieldsNamed(dialog, [
      { name: "Name", is: (el) => isTextbox(el) && el.getAttribute("placeholder") === "Reading List" },
      { name: "Icon", is: (el) => isTextbox(el) && el.getAttribute("maxlength") === "4" },
      { name: "Description", is: (el) => el.tagName === "TEXTAREA" },
      { name: "Private (only me)", is: (el) => el.getAttribute("role") === "radio" },
      { name: "Personal (visible to my AI agents)", is: (el) => el.getAttribute("role") === "radio" },
    ]);
    expect(screen.getByRole("radiogroup", { name: "Visibility" })).toBeInTheDocument();
  });
});
