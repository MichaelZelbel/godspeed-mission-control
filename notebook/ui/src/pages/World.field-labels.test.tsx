// @vitest-environment jsdom
// The World page's Add a thing form names its fields (#742).
import { afterEach, describe, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { expectFieldsNamed, isTextbox } from "@/test/field-labels";
import World from "./World";

vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/world/EntityDetail", () => ({ EntityDetail: () => null }));
vi.mock("@/hooks/useEntities", () => ({
  ENTITY_TYPE_SUGGESTIONS: ["place"],
  useEntities: () => ({ data: [] }),
  useCreateEntity: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useWorld", () => ({
  useWorldEntities: () => ({ data: [{ id: "p1", kind: "place", name: "Fictional Harbour", aliases: [] }], isLoading: false }),
  useWorldEvents: () => ({ data: [], isLoading: false }),
  useWorldClaims: () => ({ data: [], isLoading: false }),
}));

describe("the World page's Add a thing form", () => {
  afterEach(cleanup);
  it("names its fields", () => {
    render(<MemoryRouter><World /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Add a thing" }));
    const form = screen.getByRole("button", { name: "Add" }).parentElement!;
    expectFieldsNamed(form, [
      { name: "Name", is: isTextbox },
      { name: "Type", is: (el) => isTextbox(el) && el.getAttribute("list") === "entity-type-suggestions" },
    ]);
  });
});
