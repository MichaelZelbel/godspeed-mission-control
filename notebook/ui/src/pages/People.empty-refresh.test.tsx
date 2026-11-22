// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import People from "./People";

// Issue #975: "Refresh people" sat under "No people yet" on a notebook with nobody in it.

const { mutation, state } = vi.hoisted(() => ({
  mutation: () => ({ mutate: () => {}, mutateAsync: () => {}, isPending: false }),
  state: { list: [] as any[] },
}));
vi.mock("@/hooks/usePeople", () => ({
  usePeople: () => ({ data: state.list, total: state.list.length, isPending: false, isError: false, isFetching: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn() }),
  usePinnedPeople: () => ({ data: [] }),
  usePerson: () => ({ data: undefined, isPending: false, isError: false }),
  useCreatePerson: mutation, useDeletePerson: mutation, useToggleFavoritePerson: mutation,
}));
vi.mock("@/hooks/useGroups", () => ({ useGroups: () => ({ data: [] }), useCreateGroup: mutation, useUpdateGroup: mutation, useArchiveGroup: mutation, useRestoreGroup: mutation }));
vi.mock("@/hooks/useGroupMemberships", () => ({ useAllMemberships: () => ({ data: [] }), useAddMembership: mutation, useRemoveMembership: mutation }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/people/PersonDetail", () => ({ PersonDetail: () => null }));
vi.mock("@/components/people/MergePersonDialog", () => ({ MergePersonDialog: () => null }));
vi.mock("@/components/people/PeopleTree", () => ({
  PeopleTree: ({ people }: any) => (people.length ? <p>{people[0].name}</p> : <p>No people yet</p>),
}));

const view = () => render(<MemoryRouter initialEntries={["/dashboard/people"]}><People /></MemoryRouter>);
afterEach(cleanup);

describe("Refresh people", () => {
  it("is not offered under an empty list", () => {
    state.list = [];
    view();
    expect(screen.getByText("No people yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh people" })).toBeNull();
  });

  it("is offered once there is someone to refresh", () => {
    state.list = [{ id: "p1", name: "Fictional Person" }];
    view();
    expect(screen.getByText("Fictional Person")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh people" })).toBeInTheDocument();
  });
});
