// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase, type RecordedQuery } from "@/test/fake-supabase";
import AddEventDialog, { type EditMomentData, type TimelineContact } from "./AddEventDialog";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current.client; } }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "owner" }, session: { access_token: "token", user: { id: "owner" } } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAICreditsGate", () => ({
  useAICreditsGate: () => ({ checkCredits: () => true, providerConfigured: false }),
}));

class NoResize { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoResize as any;
Element.prototype.scrollIntoView ??= () => {};

const ada: TimelineContact = { id: "person-ada", name: "Fictional Ada", relationship: "friend" };
const bea: TimelineContact = { id: "person-bea", name: "Fictional Bea", relationship: "colleague" };
const people = [ada, bea];

const savedMoment: EditMomentData = {
  id: "moment-1",
  title: "Fictional lunch",
  description: "Discussed a fictional project",
  happened_at: "2026-11-10",
  happened_end: "2026-11-11",
  status: "past_fact",
  impact_level: 3,
  confidence_date: 8,
  confidence_truth: 9,
  participantIds: [ada.id],
};

function database(existingParticipantIds: string[] = []) {
  return createFakeSupabase((q: RecordedQuery) => {
    if (q.table === "moments" && q.op === "insert") return { data: { id: savedMoment.id } };
    if (q.table === "moment_participants" && q.op === "select") {
      return { data: existingParticipantIds.map((person_id) => ({ person_id })) };
    }
    return undefined;
  });
}

function openDialog(editEvent?: EditMomentData) {
  const onCreated = vi.fn();
  render(
    <AddEventDialog
      people={people}
      onCreated={onCreated}
      open
      onOpenChange={() => {}}
      editEvent={editEvent}
    />,
  );
  return onCreated;
}

async function choosePerson(name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: "People" }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

afterEach(cleanup);

describe("existing people on Timeline moments", () => {
  it("shows a named People control, saves a chosen person, and restores it when reopened", async () => {
    fake.current = database();
    const onCreated = openDialog();
    expect(screen.getByRole("combobox", { name: "People" })).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("Short title for this moment"), { target: { value: savedMoment.title } });
    await choosePerson(ada.name);
    expect(screen.getByRole("button", { name: `Remove ${ada.name}` })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create Moment" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(fake.current.on("moment_participants", "insert")[0].payload).toEqual([
      { moment_id: savedMoment.id, person_id: ada.id },
    ]);

    cleanup();
    fake.current = database([ada.id]);
    openDialog(savedMoment);
    expect(screen.getByRole("button", { name: `Remove ${ada.name}` })).toBeVisible();
  });

  it("creates a moment without a participant when nobody is selected", async () => {
    fake.current = database();
    const onCreated = openDialog();
    fireEvent.change(screen.getByPlaceholderText("Short title for this moment"), { target: { value: "Fictional solo walk" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Moment" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(fake.current.on("moment_participants")).toHaveLength(0);
    expect(fake.current.on("moments", "insert")[0].payload).toEqual(expect.objectContaining({ person_id: null }));
  });

  it("adds and removes existing people without changing the moment's other fields", async () => {
    fake.current = database([ada.id]);
    const onCreated = openDialog(savedMoment);
    fireEvent.click(screen.getByRole("button", { name: `Remove ${ada.name}` }));
    await choosePerson(bea.name);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(fake.current.on("moment_participants", "delete")[0].filters).toContainEqual(["in", "person_id", [ada.id]]);
    expect(fake.current.on("moment_participants", "insert")[0].payload).toEqual([
      { moment_id: savedMoment.id, person_id: bea.id },
    ]);
    expect(fake.current.on("moments", "update")[0].payload).toEqual({
      user_id: "owner",
      title: savedMoment.title,
      description: savedMoment.description,
      happened_at: savedMoment.happened_at,
      happened_end: savedMoment.happened_end,
      status: savedMoment.status,
      impact_level: savedMoment.impact_level,
      confidence_date: savedMoment.confidence_date,
      confidence_truth: savedMoment.confidence_truth,
      person_id: bea.id,
    });
  });
});
