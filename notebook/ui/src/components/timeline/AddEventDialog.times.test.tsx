// @vitest-environment jsdom
// Optional Start and End times in Add and Edit Moment (#1059).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
import AddEventDialog, { type EditMomentData } from "./AddEventDialog";
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

const MESSAGE = "The end date is before the start date";


const base: EditMomentData = {
  id: "m1", title: "A call", description: null,
  happened_at: "2025-06-01T13:00:00Z", happened_end: null, status: "past_fact",
  impact_level: 2, confidence_date: 5, confidence_truth: 5, participantIds: [],
};

afterEach(() => {
  cleanup();
  fake.current?.reset();
});

const field = (dialog: HTMLElement, label: string) => within(dialog).getByLabelText(label) as HTMLInputElement;
const type = (dialog: HTMLElement, label: string, value: string) => fireEvent.change(field(dialog, label), { target: { value } });

async function saveEdit(editEvent: EditMomentData, edit: (dialog: HTMLElement) => void) {
  fake.current = createFakeSupabase();
  const onCreated = vi.fn();
  render(<AddEventDialog people={[]} onCreated={onCreated} editEvent={editEvent} open onOpenChange={() => {}} />);
  const dialog = screen.getByRole("dialog", { name: "Edit Moment" });
  edit(dialog);
  fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce(), WAIT);
  return fake.current.on("moments", "update")[0].payload as any;
}

describe("Add Moment with times", () => {
  it("saves a start and end time as full date-times, across midnight too", async () => {
    fake.current = createFakeSupabase();
    const onCreated = vi.fn();
    render(<AddEventDialog people={[]} onCreated={onCreated} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Add Moment" });
    type(dialog, "Title", "Late call");
    type(dialog, "Start Date", "2025-06-01");
    type(dialog, "Start Time", "22:00");
    type(dialog, "End Date", "2025-06-02");
    type(dialog, "End Time", "01:00");
    expect(within(dialog).queryByText("The end date is before the start date")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Moment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce(), WAIT);
    const payload = fake.current.on("moments", "insert")[0].payload as any;
    expect(payload.happened_at).toBe("2025-06-01T22:00:00Z");
    expect(payload.happened_end).toBe("2025-06-02T01:00:00Z");
  });

  it("refuses an end time before the start time on the same day", () => {
    fake.current = createFakeSupabase();
    render(<AddEventDialog people={[]} onCreated={vi.fn()} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Add Moment" });
    type(dialog, "Title", "Backwards");
    type(dialog, "Start Date", "2025-06-01");
    type(dialog, "Start Time", "13:00");
    expect(field(dialog, "End Time")).toBeDisabled();
    type(dialog, "End Date", "2025-06-01");
    type(dialog, "End Time", "12:00");
    expect(within(dialog).getByText("The end date is before the start date")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create Moment" })).toBeDisabled();
  });

  it("saves a day with no time as the bare date", async () => {
    fake.current = createFakeSupabase();
    const onCreated = vi.fn();
    render(<AddEventDialog people={[]} onCreated={onCreated} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Add Moment" });
    type(dialog, "Title", "All day");
    type(dialog, "Start Date", "2025-06-01");
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Moment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce(), WAIT);
    expect((fake.current.on("moments", "insert")[0].payload as any).happened_at).toBe("2025-06-01");
  });
});

describe("Edit Moment with times", () => {
  it("opens with the time written by another client and keeps its offset when untouched", async () => {
    const at = "2025-06-01T13:05:00+02:00";
    const payload = await saveEdit({ ...base, happened_at: at }, (dialog) => {
      expect(field(dialog, "Start Time").value).toBe("13:05");
    });
    expect(payload.happened_at).toBe(at);
  });

  it("clears the time to make the moment all day", async () => {
    const payload = await saveEdit(base, (dialog) => type(dialog, "Start Time", ""));
    expect(payload.happened_at).toBe("2025-06-01");
  });

  it("adds a time to an all-day moment, which opens with empty time inputs", async () => {
    const payload = await saveEdit({ ...base, happened_at: "2025-06-01T00:00:00Z" }, (dialog) => {
      expect(field(dialog, "Start Time").value).toBe("");
      type(dialog, "Start Time", "09:30");
    });
    expect(payload.happened_at).toBe("2025-06-01T09:30:00Z");
  });

  it("saves an untouched all-day moment as before", async () => {
    const payload = await saveEdit({ ...base, happened_at: "2025-06-01T00:00:00Z" }, () => {});
    expect(payload.happened_at).toBe("2025-06-01");
  });
});
