// @vitest-environment jsdom
// Editing a moment another writer saved without a day or without scores
// (#920). The dialog used to open with today as the Start Date and 1/5/5 on
// the sliders, and saving a typo fix dated the moment to today and gave it
// made-up scores. Now the untouched gaps stay gaps: an empty start date and
// sliders that read Not set, and a save that writes null for them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
import AddEventDialog, { type EditMomentData, type TimelineContact } from "./AddEventDialog";
import { impactLabels } from "./ImportanceSlider";
import { WAIT } from "@/test/wait-limits";

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

// A moment an assistant or an import wrote: no day at all, no scores.
const undated: EditMomentData = {
  id: "moment-undated", title: "Written without a day", description: null,
  happened_at: null, happened_end: null, status: "unknown",
  impact_level: null, confidence_date: null, confidence_truth: null, participantIds: [],
};

// A dated moment that was saved without scores.
const scoreless: EditMomentData = {
  id: "moment-scoreless", title: "Saved without scores", description: null,
  happened_at: "2026-01-05T00:00:00Z", happened_end: null, status: "unknown",
  impact_level: null, confidence_date: null, confidence_truth: null, participantIds: [],
};

function openEdit(editEvent: EditMomentData) {
  const onCreated = vi.fn();
  render(<AddEventDialog people={[ada]} onCreated={onCreated} editEvent={editEvent} open onOpenChange={() => {}} />);
  return { dialog: screen.getByRole("dialog", { name: "Edit Moment" }), onCreated };
}

function expectScore(dialog: HTMLElement, name: string, value: string) {
  const label = within(dialog).getByText(name, { selector: "label", exact: true });
  expect(label.parentElement).toHaveTextContent(`${name}: ${value}`);
  expect(within(dialog).getByRole("slider", { name })).toHaveAttribute("aria-valuetext", value);
}

// The one moments row the save wrote, with the values it gave the moment.
async function savedPayload(editEvent: EditMomentData, onCreated: ReturnType<typeof vi.fn>) {
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce(), WAIT);
  const updates = fake.current.on("moments", "update");
  expect(updates).toHaveLength(1);
  return updates[0].payload as Record<string, unknown>;
}

afterEach(() => {
  cleanup();
  fake.current?.reset();
});

describe("editing an undated, scoreless moment", () => {
  it("opens with an empty date and Not set scores, and saving a title edit keeps the moment undated and scoreless", async () => {
    fake.current = createFakeSupabase();
    const { dialog, onCreated } = openEdit(undated);

    // Nothing is chosen for the person: the Start Date is empty and the
    // three scores read Not set, the way the drawer showed them.
    const dateInput = within(dialog).getByLabelText("Start Date", { exact: true }) as HTMLInputElement;
    expect(dateInput.value).toBe("");
    expect(dateInput).not.toBeRequired();
    expectScore(dialog, "Impact", "Not set");
    expectScore(dialog, "Confidence (Date)", "Not set");
    expectScore(dialog, "Confidence (Truth)", "Not set");

    // The person fixes only the title and saves.
    const title = within(dialog).getByLabelText("Title", { exact: true });
    fireEvent.change(title, { target: { value: "Renamed by hand" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    const payload = await savedPayload(undated, onCreated);
    expect(payload.happened_at).toBeNull();
    expect(payload.impact_level).toBeNull();
    expect(payload.confidence_date).toBeNull();
    expect(payload.confidence_truth).toBeNull();
    expect(payload.title).toBe("Renamed by hand");
    // The row is the undated moment's own.
    expect(fake.current.on("moments", "update")[0].filters).toContainEqual(["eq", "id", "moment-undated"]);
  });

  it("keeps the saved scores Not set on a dated moment too, while its own day stays", async () => {
    fake.current = createFakeSupabase();
    const { dialog, onCreated } = openEdit(scoreless);
    const dateInput = within(dialog).getByLabelText("Start Date", { exact: true });
    expect(dateInput).toHaveValue("2026-01-05");
    expect(dateInput).toBeRequired();
    expectScore(dialog, "Impact", "Not set");

    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    const payload = await savedPayload(scoreless, onCreated);
    expect(payload.happened_at).toBe("2026-01-05");
    expect(payload.impact_level).toBeNull();
    expect(payload.confidence_date).toBeNull();
    expect(payload.confidence_truth).toBeNull();
  });

  it("saves the day the person chooses, still without scores they did not set", async () => {
    fake.current = createFakeSupabase();
    const { dialog, onCreated } = openEdit(undated);

    fireEvent.change(within(dialog).getByLabelText("Start Date", { exact: true }), { target: { value: "2026-03-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    const payload = await savedPayload(undated, onCreated);
    expect(payload.happened_at).toBe("2026-03-01");
    expect(payload.impact_level).toBeNull();
    expect(payload.confidence_truth).toBeNull();
  });

  it("saves a score the person sets by hand, next to the gaps they left", async () => {
    fake.current = createFakeSupabase();
    const { dialog, onCreated } = openEdit(undated);

    const impact = within(dialog).getByRole("slider", { name: "Impact" });
    fireEvent.keyDown(impact, { key: "ArrowRight" });
    expectScore(dialog, "Impact", `2 - ${impactLabels[2]}`);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    const payload = await savedPayload(undated, onCreated);
    expect(payload.happened_at).toBeNull();
    expect(payload.impact_level).toBe(2);
    expect(payload.confidence_date).toBeNull();
    expect(payload.confidence_truth).toBeNull();
  });
});
