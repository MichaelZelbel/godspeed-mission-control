// @vitest-environment jsdom
// The groups forms have every label tied to its field (#742): New Group, a
// group's About form, and its Add Goal and Edit Goal dialogs.
import { afterEach, describe, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { expectFieldsNamed, isInputOfType, isListButton, isTextbox } from "@/test/field-labels";
import { createFakeSupabase } from "@/test/fake-supabase";
import Groups from "./Groups";
import GroupDetail from "./GroupDetail";
import { GoalsTab } from "@/components/groups/GoalsTab";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
Element.prototype.scrollIntoView ??= () => {};
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as any;

const group = {
  id: "g1", user_id: "owner", slug: "fictional-club", name: "Fictional Club", description: "A club that does not exist.", purpose: "Testing",
  type: "other", sensitivity: "normal", icon: "Users", color: "text-primary", template: null, status: "active",
  stages: [{ id: "new", label: "New", color: "bg-muted" }],
  success_criteria: [{ label: "Meet twice", target: 2, current: 1, kind: "manual" }],
  attributes_schema: {}, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
} as any;

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current.client; } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/groups/InitialMigrationCard", () => ({ InitialMigrationCard: () => null }));
vi.mock("@/components/groups/BriefingTab", () => ({ BriefingTab: () => null }));
vi.mock("@/components/groups/SuggestMembersButton", () => ({ SuggestMembersButton: () => null }));
vi.mock("@/components/groups/MembershipSheet", () => ({ MembershipSheet: () => null }));
vi.mock("@/components/groups/AddMemberDialog", () => ({ AddMemberDialog: () => null }));
vi.mock("@/hooks/useGroups", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    useGroups: () => ({ data: [], isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() }),
    useGroup: () => ({ data: group, isLoading: false, isError: false, refetch: vi.fn() }),
    useCreateGroup: mutation, useUpdateGroup: mutation, useArchiveGroup: mutation, useTrashGroup: mutation, useRestoreGroup: mutation,
  };
});
vi.mock("@/hooks/useGroupMemberships", () => ({
  useAllMemberships: () => ({ data: [] }),
  useGroupMemberships: () => ({ data: [] }),
  useMoveMembershipStage: () => ({ mutate: vi.fn(), isPending: false }),
  useAddMembership: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

function wrap(children: React.ReactNode, path = "/dashboard/groups") {
  fake.current = createFakeSupabase(() => undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/groups" element={children} />
          <Route path="/dashboard/groups/:slug" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("the groups forms", () => {
  afterEach(cleanup);

  it("New Group, started from scratch, names its fields", () => {
    wrap(<Groups />);
    fireEvent.click(screen.getByRole("button", { name: "New Group" }));
    fireEvent.click(screen.getByRole("button", { name: /From Scratch/ }));
    const dialog = screen.getByRole("dialog");
    expectFieldsNamed(dialog, [
      { name: "Name", is: (el) => isTextbox(el) && el.getAttribute("placeholder") === "Dream 100" },
      { name: "Description", is: (el) => el.tagName === "TEXTAREA" },
    ]);
  });

  it("a group's About form names its fields", () => {
    wrap(<GroupDetail />, "/dashboard/groups/fictional-club");
    const about = screen.getByRole("tab", { name: "About" });
    fireEvent.mouseDown(about);
    fireEvent.click(about);
    const panel = screen.getByRole("tabpanel");
    expectFieldsNamed(panel, [
      { name: "Name", is: isTextbox },
      { name: "Type", is: isListButton },
      { name: "Description", is: (el) => el.tagName === "TEXTAREA" },
      { name: "Purpose", is: (el) => el.tagName === "TEXTAREA" },
      { name: "Sensitivity", is: isListButton },
      { name: "Icon", is: isListButton },
      { name: "Color", is: isTextbox },
    ]);
  });

  it("the Add Goal and Edit Goal dialogs name their fields", () => {
    wrap(<GoalsTab group={group} />);
    const goalFields = [
      { name: "Label", is: isTextbox },
      { name: "Target", is: isInputOfType("number") },
      { name: "Current", is: isInputOfType("number") },
      { name: "Kind", is: isListButton },
    ];
    fireEvent.click(screen.getByRole("button", { name: "Add Goal" }));
    expectFieldsNamed(screen.getByRole("dialog", { name: "Add Goal" }), goalFields);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    cleanup();
    wrap(<GoalsTab group={{ ...group, success_criteria: [{ label: "Talk often", target: 5, kind: "interaction_count", period_days: 14 }] }} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    expectFieldsNamed(screen.getByRole("dialog", { name: "Edit Goal" }), [...goalFields, { name: "Period days", is: isInputOfType("number") }]);
  });
});
