// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import World from "./World";

// Issue #747: on a new notebook every World tab said "Nothing matches." under an empty search box,
// which reads like a failed search and does not say how to add the first thing. An empty tab now
// says it is empty and how to fill it; "Nothing matches." answers only a search or a kind filter
// that hides everything.
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/world/EntityDetail", () => ({ EntityDetail: () => null }));
vi.mock("@/hooks/useEntities", () => ({
  ENTITY_TYPE_SUGGESTIONS: ["place"],
  useEntities: () => ({ data: [] }),
  useCreateEntity: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

const world = vi.hoisted(() => ({ entities: [] as any[], events: [] as any[], claims: [] as any[] }));
vi.mock("@/hooks/useWorld", () => ({
  useWorldEntities: () => ({ data: world.entities, isLoading: false }),
  useWorldEvents: () => ({ data: world.events, isLoading: false }),
  useWorldClaims: () => ({ data: world.claims, isLoading: false }),
}));

const openTab = (name: RegExp) => {
  const tab = screen.getByRole("tab", { name });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
};
const search = (text: string) =>
  fireEvent.change(screen.getByPlaceholderText("Search the whole world"), { target: { value: text } });
const renderWorld = () => render(<MemoryRouter><World /></MemoryRouter>);

describe("World on an empty notebook", () => {
  beforeEach(() => { world.entities = []; world.events = []; world.claims = []; });
  afterEach(cleanup);

  it("Entities says there are no things yet and opens Add a thing from there", () => {
    renderWorld();
    expect(screen.queryByText("Nothing matches.")).not.toBeInTheDocument();
    expect(screen.getByText(/No things yet\. Add your first place, project or anything else with Add a thing\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add the first thing" }));
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
  });

  it("Events says nothing has happened yet and sends you to the Timeline", () => {
    renderWorld();
    openTab(/^Events/);
    expect(screen.queryByText("Nothing matches.")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing has happened here yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/dashboard/timeline");
  });

  it("Claims says nothing is believed yet and where a fact is added", () => {
    renderWorld();
    openTab(/^Claims/);
    expect(screen.queryByText("Nothing matches.")).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing believed yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("href", "/dashboard/people");
  });

  it("answers a search on an empty tab with Nothing matches.", () => {
    renderWorld();
    search("zebra");
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    expect(screen.queryByText(/No things yet/)).not.toBeInTheDocument();
    openTab(/^Events/);
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    openTab(/^Claims/);
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
  });
});

describe("World with things in it", () => {
  beforeEach(() => {
    world.entities = [
      { id: "p1", source_table: "contact", kind: "person", name: "Ada Example", aliases: [] },
      { id: "e1", source_table: "entity", kind: "place", name: "Lisbon", aliases: [] },
    ];
    world.events = [{ id: "m1", title: "Moved house", happened_at: "2026-10-01" }];
    world.claims = [{ id: "c1", subject_kind: "self", subject_id: null, attribute: "lives in", value: "Lisbon", created_by: "user", updated_at: "2026-11-01" }];
  });
  afterEach(cleanup);

  it("says Nothing matches. on each tab when a search hides everything", () => {
    renderWorld();
    search("zebra");
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    expect(screen.queryByText(/No things yet/)).not.toBeInTheDocument();
    openTab(/^Events/);
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing has happened here yet/)).not.toBeInTheDocument();
    openTab(/^Claims/);
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing believed yet/)).not.toBeInTheDocument();
  });

  it("lists everything, with no empty message, when nothing is searched", () => {
    renderWorld();
    expect(screen.getByText("Lisbon")).toBeInTheDocument();
    expect(screen.queryByText("Nothing matches.")).not.toBeInTheDocument();
    openTab(/^Events/);
    expect(screen.getByText("Moved house")).toBeInTheDocument();
    openTab(/^Claims/);
    expect(screen.getByText("lives in")).toBeInTheDocument();
  });

  it("says Nothing matches. when the kind filter and a search together hide everything", () => {
    renderWorld();
    fireEvent.click(screen.getByRole("button", { name: /^place/ }));
    expect(screen.getByText("Lisbon")).toBeInTheDocument();
    expect(screen.queryByText("Ada Example")).not.toBeInTheDocument();
    search("ada");
    expect(screen.getByText("Nothing matches.")).toBeInTheDocument();
    expect(screen.queryByText(/No things yet/)).not.toBeInTheDocument();
  });
});
