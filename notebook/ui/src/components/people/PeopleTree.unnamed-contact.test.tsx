// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { PeopleTree } from "./PeopleTree";

const noop = () => {};
const people: any[] = [
  { id: "c-named", name: "Ada Example", aliases: ["Countess"], is_favorite: false, last_viewed_at: null },
  { id: "review-0001", aliases: [] },
  { id: "c-null", name: null, aliases: [null, 7] },
];
const props = (searchQuery: string): any => ({
  people, groups: [], memberships: [], selectedPersonId: null, searchQuery,
  onSelectPerson: noop, onToggleFavorite: noop, onCreateGroup: noop, onRenameGroup: noop, onArchiveGroup: noop,
  onReparentGroup: noop, onAddToGroup: noop, onRemoveFromGroup: noop, onCreatePerson: noop, onMergePerson: noop, onDeletePerson: noop,
});
vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

describe("the people tree with contacts that have no name", () => {
  afterEach(cleanup);
  it("lists them as Unnamed person when nothing is typed", () => {
    render(<MemoryRouter><PeopleTree {...props("")} /></MemoryRouter>);
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
    expect(screen.getAllByText("Unnamed person").length).toBeGreaterThan(0);
  });
  it("searches by name and nickname without an error", () => {
    const { unmount } = render(<MemoryRouter><PeopleTree {...props("count")} /></MemoryRouter>);
    expect(screen.getByText("Ada Example")).toBeInTheDocument();
    expect(screen.queryByText("Unnamed person")).toBeNull();
    unmount();
    render(<MemoryRouter><PeopleTree {...props("zzz")} /></MemoryRouter>);
    expect(screen.queryByText("Ada Example")).toBeNull();
  });
});
