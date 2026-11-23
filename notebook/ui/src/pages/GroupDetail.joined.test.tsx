// @vitest-environment jsdom
// #913: a member added through Add Member showed "Invalid Date" in a group's
// Joined column, because the insert wrote no joined_at and the cell formatted
// whatever came back. A member now joins on the day they were added, and a
// row with no readable joined_at reads "Not set", never "Invalid Date".
// #925: a plain-day joined_at (no time of day) must read that day, not the
// day before, west of UTC — the cell reads it through showDate in both.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase, filterValue, type RecordedQuery } from "@/test/fake-supabase";
import GroupDetail from "./GroupDetail";
import { WAIT } from "@/test/wait-limits";
import { showDate } from "@/lib/local-date";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current.client; } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner" }, session: { access_token: "token", user: { id: "owner" } } }),
}));
vi.mock("@/hooks/usePeopleSync", () => ({
  usePeopleSync: () => ({ connection: null, triggerPeopleSync: vi.fn(), deleteEntityFile: vi.fn() }),
}));

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as any;
}

const GROUP = {
  id: "book-club",
  user_id: "owner",
  name: "Fictional Book Club",
  slug: "book-club",
  type: "community",
  description: null,
  purpose: null,
  sensitivity: "normal",
  icon: null,
  color: null,
  stages: [],
  success_criteria: [],
  attributes_schema: [],
  template: null,
  parent_group_id: null,
  created_at: "2026-01-05T10:00:00.000Z",
  updated_at: "2026-01-05T10:00:00.000Z",
  is_trashed: false,
  archived_at: null,
};

const PEOPLE = [
  { id: "person-ada", name: "Fictional Ada", company: null, role: null },
  { id: "person-bea", name: "Fictional Bea", company: null, role: null },
];

type MemberRow = Record<string, any>;

function memberRow(fields: Partial<MemberRow>): MemberRow {
  return {
    id: "m-" + Math.random().toString(36).slice(2),
    user_id: "owner",
    group_id: "book-club",
    contact_id: "person-bea",
    status: "new",
    priority: "normal",
    attributes: {},
    position: 0,
    notes: null,
    reason: null,
    source_note_ids: [],
    archived_at: null,
    created_at: "2026-01-05T10:00:00.000Z",
    updated_at: "2026-01-05T10:00:00.000Z",
    last_movement_at: "2026-01-05T10:00:00.000Z",
    joined_at: null,
    ...fields,
  };
}

function database(startingMemberships: MemberRow[]) {
  const rows: MemberRow[] = [...startingMemberships];
  return createFakeSupabase((q: RecordedQuery) => {
    if (q.table === "contact_groups" && q.op === "select") {
      // The page first tries the address as an id, then as a slug.
      if (filterValue(q, "eq", "id") === GROUP.id || filterValue(q, "eq", "slug") === GROUP.slug) return { data: GROUP };
      return { data: null };
    }
    if (q.table === "contact_group_memberships" && q.op === "select") {
      return {
        data: rows
          .filter((row) => row.archived_at === null)
          .map((row) => ({ ...row, contacts: { id: row.contact_id, name: PEOPLE.find((p) => p.id === row.contact_id)?.name ?? null, aliases: null } })),
      };
    }
    if (q.table === "contact_group_memberships" && q.op === "insert") {
      const row = memberRow(q.payload as MemberRow);
      rows.push(row);
      return { data: { ...row } };
    }
    if (q.table === "contacts" && q.op === "select") return { data: PEOPLE };
    return undefined;
  });
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/dashboard/groups/book-club"]}>
        <Routes>
          <Route path="/dashboard/groups/:slug" element={<GroupDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function joinedCellOf(rowText: string) {
  const row = screen.getAllByRole("row").find((candidate) => within(candidate).queryByText(rowText));
  expect(row, `a member row for ${rowText}`).toBeDefined();
  const cells = within(row!).getAllByRole("cell");
  return cells[3];
}

afterEach(cleanup);

describe("the Joined column on a group's List tab", () => {
  it("shows the day a member added through Add Member joined", async () => {
    fake.current = database([memberRow({ contact_id: "person-bea", joined_at: "2026-01-05T10:00:00.000Z" })]);
    renderPage();
    expect(await screen.findByRole("heading", { name: "Fictional Book Club" }, WAIT)).toBeVisible();

    // Add a member the way the browser does: open the dialog, tick the person, Add Selected.
    fireEvent.click(screen.getByRole("button", { name: "Add Member" }));
    const checkbox = await screen.findByRole("checkbox", { name: /Fictional Ada/ }, WAIT);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Add Selected" }));

    // The new member appears in the list with the day they were added.
    await waitFor(() => expect(joinedCellOf("Fictional Ada").textContent).not.toBe("—"), WAIT);
    expect(joinedCellOf("Fictional Ada").textContent).toBe(showDate(new Date(), "date"));
  });

  it("reads a membership with no readable joined_at as Not set, never Invalid Date", async () => {
    fake.current = database([
      memberRow({ contact_id: "person-bea", joined_at: null }),
      memberRow({ contact_id: "person-ada", joined_at: "not-a-date" }),
    ]);
    renderPage();
    expect(await screen.findByRole("heading", { name: "Fictional Book Club" }, WAIT)).toBeVisible();

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(3), WAIT);
    expect(joinedCellOf("Fictional Bea").textContent).toBe("Not set");
    expect(joinedCellOf("Fictional Ada").textContent).toBe("Not set");
    expect(document.body.textContent).not.toContain("Invalid Date");
  });

  it("reads a plain stored day in the Joined column as that day", async () => {
    fake.current = database([memberRow({ contact_id: "person-bea", joined_at: "2025-03-05" })]);
    renderPage();
    expect(await screen.findByRole("heading", { name: "Fictional Book Club" }, WAIT)).toBeVisible();

    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(2), WAIT);
    expect(joinedCellOf("Fictional Bea").textContent).toBe("Mar 5, 2025");
  });
});
