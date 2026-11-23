// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createFakeSupabase } from "@/test/fake-supabase";
import type { GroupMembershipWithPerson } from "@/hooks/useGroupMemberships";
import type { Database } from "@/integrations/supabase/types";
import { MembershipSheet } from "./MembershipSheet";

// Below sm the List tab hides the Last Movement and Reason columns (#878), so the sheet a row
// opens is where a phone reads them. Reason was already there; the last-moved date was not, and
// for a member with no pipeline stage (or a group whose stages were edited away) the pipeline
// card that shows it never renders, so the sheet must show it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: createFakeSupabase().client }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

const group = { id: "g1", name: "Investors", stages: [{ id: "new", label: "New" }] } as unknown as Database["public"]["Tables"]["contact_groups"]["Row"];
const membership = {
  id: "m1",
  group_id: "g1",
  contact_id: "c1",
  status: null,
  priority: "high",
  reason: "Met at the conference",
  notes: null,
  attributes: {},
  joined_at: "2026-11-01",
  last_movement_at: new Date().toISOString(),
  contacts: { id: "c1", name: "Grace Hopper", aliases: null },
} as unknown as GroupMembershipWithPerson;

function renderSheet() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MembershipSheet group={group} membership={membership} notes={[]} open onOpenChange={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("the sheet a List-tab row opens at a phone's width", () => {
  afterEach(cleanup);

  it("shows the member's last-moved date", () => {
    renderSheet();
    expect(screen.getByText("Last moved today")).toBeTruthy();
  });
});
