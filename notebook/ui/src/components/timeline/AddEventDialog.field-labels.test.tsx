// @vitest-environment jsdom
// Every visible field label of the Add Moment dialog names its control (#732, #742):
// finding a field by its label text gives exactly one enabled control, and
// clicking the label focuses that control. Opened through the dialog's own
// "Add Moment" button, the way a person opens it on the Timeline page, and as
// the dialog that edits an existing moment, which shares these fields.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
import { type ExpectedField, expectFieldsNamed, isInputOfType, isListButton, isSlider } from "@/test/field-labels";
import { impactLabels } from "./ImportanceSlider";
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

const existing: EditMomentData = {
  id: "moment-1", title: "Fictional trip", description: "A trip that never happened.",
  happened_at: "2024-03-01T00:00:00Z", happened_end: "2024-03-04T00:00:00Z", status: "past_fact",
  impact_level: 3, confidence_date: 7, confidence_truth: 9, participantIds: [ada.id],
};

// Each field, found by its plain label text (no required star, no live slider value), and how to recognise its control.
const fields: ExpectedField[] = [
  { name: "Describe what happened", is: (el) => el.tagName === "TEXTAREA" },
  { name: "Title", is: (el) => el.getAttribute("placeholder") === "Short title for this moment" },
  { name: "Start Date", is: isInputOfType("date") },
  { name: "End Date", is: isInputOfType("date") },
  { name: "Status", is: isListButton },
  { name: "Confidence (Date)", is: (el) => isSlider(el) && el.getAttribute("aria-valuemax") === "10" },
  { name: "Impact", is: (el) => isSlider(el) && el.getAttribute("aria-valuemax") === "4" },
  { name: "Confidence (Truth)", is: (el) => isSlider(el) && el.getAttribute("aria-valuemax") === "10" },
  { name: "People", is: (el) => el.getAttribute("role") === "combobox" && el.textContent!.includes("Add") },
];

function checkEveryLabel(dialog: HTMLElement) {
  // Every field a person sees has its label (the description box has only a placeholder, so it carries the name itself).
  expect(dialog.querySelectorAll("label")).toHaveLength(fields.length - 1);
  expectFieldsNamed(dialog, fields);
  // Each field is one a person can fill in.
  for (const field of fields) expect(within(dialog).getByLabelText(field.name, { exact: true }), `"${field.name}" is enabled`).toBeEnabled();
  expect(screen.queryByPlaceholderText("Search or type a new name…")).toBeNull();
  // The required star is beside the label, not in the name; the field says it is required.
  expect(within(dialog).getByLabelText("Title")).toHaveAttribute("aria-required", "true");
  expect(within(dialog).getByLabelText("Start Date")).toHaveAttribute("aria-required", "true");
  expect(within(dialog).getByLabelText("End Date")).not.toHaveAttribute("aria-required");
}

// A slider's value is its own, not part of its name.
function expectSliderValue(dialog: HTMLElement, name: string, now: string, text: string) {
  const slider = within(dialog).getByRole("slider", { name });
  expect(slider).toHaveAttribute("aria-valuenow", now);
  expect(slider).toHaveAttribute("aria-valuetext", text);
}

afterEach(cleanup);

describe("the Add Moment dialog's labels name their fields", () => {
  it("in the dialog opened through its own Add Moment button", () => {
    fake.current = createFakeSupabase(() => undefined);
    render(<AddEventDialog people={[ada]} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Moment" }));
    const dialog = screen.getByRole("dialog", { name: "Add Moment" });
    checkEveryLabel(dialog);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("");
  });

  it("in the dialog that edits an existing moment", () => {
    fake.current = createFakeSupabase(() => undefined);
    render(<AddEventDialog people={[ada]} onCreated={vi.fn()} editEvent={existing} open onOpenChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Edit Moment" });
    checkEveryLabel(dialog);
    expect(within(dialog).getByLabelText("Title")).toHaveValue("Fictional trip");
    expect(within(dialog).getByLabelText("Start Date")).toHaveValue("2024-03-01");
    expect(within(dialog).getByLabelText("End Date")).toHaveValue("2024-03-04");
    expectSliderValue(dialog, "Confidence (Date)", "7", "7");
    expectSliderValue(dialog, "Impact", "3", `3 - ${impactLabels[3]}`);
    expectSliderValue(dialog, "Confidence (Truth)", "9", "9");
  });
});
