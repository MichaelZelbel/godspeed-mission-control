// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakeSupabase, type RecordedQuery } from "@/test/fake-supabase";
import type { Database } from "@/integrations/supabase/types";
import { WAIT } from "@/test/wait-limits";
import { AddMemberDialog } from "./AddMemberDialog";

// The group's Add Members dialog offers "Add a new person", which creates the person and adds
// them to the open group in one confirmed step (#1041). Cancelling creates and changes nothing.

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current.client; } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/hooks/usePeopleSync", () => ({ usePeopleSync: () => ({ triggerPeopleSync: () => {} }) }));
vi.mock("@/lib/toast", () => ({ showToast: { success: vi.fn(), error: vi.fn() } }));

const group = { id: "g1", name: "Investors", stages: [] } as unknown as Database["public"]["Tables"]["contact_groups"]["Row"];

function notebook() {
  return createFakeSupabase((q: RecordedQuery) => {
    if (q.table === "contacts" && q.op === "select") return { data: [{ id: "c-ada", name: "Ada Lovelace", company: null, role: null }] };
    if (q.table === "contacts" && q.op === "insert") return { data: { id: "c-new", name: (q.payload as any).name } };
    if (q.table === "contact_groups") return { data: { stages: [] } };
    if (q.table === "contact_group_memberships" && q.op === "insert") return { data: { id: "m-new" } };
    return undefined;
  });
}

function open() {
  fake.current = notebook();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AddMemberDialog group={group} existingPersonIds={new Set()} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Add Member/ }));
}

const inserts = (table: string) => fake.current.on(table, "insert");

describe("Add Members: Add a new person", () => {
  afterEach(() => cleanup());

  it("creates the person and adds them to the group on confirm", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Add a new person/ }, WAIT));
    fireEvent.change(screen.getByLabelText("New person's name"), { target: { value: "  Grace Hopper " } });
    expect(inserts("contacts")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Add person to group" }));
    await vi.waitFor(() => expect(inserts("contact_group_memberships")).toHaveLength(1), WAIT);
    expect((inserts("contacts")[0].payload as any).name).toBe("Grace Hopper");
    expect((inserts("contact_group_memberships")[0].payload as any)).toMatchObject({ group_id: "g1", contact_id: "c-new" });
  });

  it("cancelling creates no person and changes no membership", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Add a new person/ }, WAIT));
    fireEvent.change(screen.getByLabelText("New person's name"), { target: { value: "Grace Hopper" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("New person's name")).toBeNull();
    expect(inserts("contacts")).toHaveLength(0);
    expect(inserts("contact_group_memberships")).toHaveLength(0);
  });

  it("does not create a person from a blank name", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: /Add a new person/ }, WAIT));
    fireEvent.change(screen.getByLabelText("New person's name"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Add person to group" })).toBeDisabled();
  });
});
