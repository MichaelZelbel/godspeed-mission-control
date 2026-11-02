// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import World from "./World";

// Issue #154, review of #155: World lists contacts among its entities, and searching it lower-cased
// every name and alias, so one contact without a name broke the search.
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/world/EntityDetail", () => ({ EntityDetail: () => null }));
vi.mock("@/hooks/useEntities", () => ({
  ENTITY_TYPE_SUGGESTIONS: ["place"],
  useEntities: () => ({ data: [] }),
  useCreateEntity: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useWorld", () => ({
  useWorldEntities: () => ({ data: [
    { id: "review-0001", kind: "person", name: undefined, aliases: [null, 7] },
    { id: "p2", kind: "person", name: "Ada Example", aliases: [] },
  ], isLoading: false }),
  useWorldEvents: () => ({ data: [{ id: "e1", title: undefined }], isLoading: false }),
  useWorldClaims: () => ({ data: [], isLoading: false }),
}));

describe("the World page with a contact that has no name", () => {
  afterEach(cleanup);
  it("searches without breaking and still finds the named one", () => {
    render(<MemoryRouter><World /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText("Search the whole world"), { target: { value: "ada" } });
    expect(screen.getAllByText("Ada Example").length).toBeGreaterThan(0);
  });
});
