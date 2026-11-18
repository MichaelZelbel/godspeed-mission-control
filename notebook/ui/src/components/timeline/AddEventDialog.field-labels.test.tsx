// @vitest-environment jsdom
// Every visible field label of the Add Moment dialog names its control (#732):
// finding a field by its label text gives exactly one enabled control, and
// clicking the label focuses that control. Opened through the dialog's own
// "Add Moment" button, the way a person opens it on the Timeline page, and as
// the dialog that edits an existing moment, which shares these fields.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
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

// Each visible label, and how to recognise the control it must name.
const fields: { label: RegExp; is: (el: HTMLElement) => boolean }[] = [
  { label: /^Title \*$/, is: (el) => el.getAttribute("placeholder") === "Short title for this moment" },
  { label: /^Start Date \*$/, is: (el) => el.tagName === "INPUT" && (el as HTMLInputElement).type === "date" },
  { label: /^End Date$/, is: (el) => el.tagName === "INPUT" && (el as HTMLInputElement).type === "date" },
  { label: /^Status$/, is: (el) => el.getAttribute("role") === "combobox" && el.tagName === "BUTTON" },
  { label: /^Confidence \(Date\): \d+$/, is: (el) => el.getAttribute("role") === "slider" && el.getAttribute("aria-valuemax") === "10" },
  { label: /^Impact: \d - /, is: (el) => el.getAttribute("role") === "slider" && el.getAttribute("aria-valuemax") === "4" },
  { label: /^Confidence \(Truth\): \d+$/, is: (el) => el.getAttribute("role") === "slider" && el.getAttribute("aria-valuemax") === "10" },
  { label: /^People$/, is: (el) => el.getAttribute("role") === "combobox" && el.textContent!.includes("Add") },
];

// The control a label names: its own (for/id or wrapped), or the element that
// points back at it with aria-labelledby.
function controlOf(label: HTMLLabelElement, dialog: HTMLElement): HTMLElement | null {
  if (label.control) return label.control as HTMLElement;
  if (!label.id) return null;
  return Array.from(dialog.querySelectorAll<HTMLElement>("[aria-labelledby]"))
    .find((el) => el.getAttribute("aria-labelledby")!.split(/\s+/).includes(label.id)) ?? null;
}

function checkEveryLabel(dialog: HTMLElement) {
  const labels = Array.from(dialog.querySelectorAll("label"));
  // No label in the dialog is a caption that names nothing.
  for (const label of labels) expect(controlOf(label, dialog), `label "${label.textContent}" names no control`).not.toBeNull();
  // Each field a person sees has its label, and the label names exactly that field.
  expect(labels).toHaveLength(fields.length);
  const seen = new Set<HTMLElement>();
  for (const field of fields) {
    const found = within(dialog).getAllByLabelText(field.label);
    expect(found, `label ${field.label}`).toHaveLength(1);
    const control = found[0];
    expect(field.is(control), `label ${field.label} names ${control.outerHTML.slice(0, 120)}`).toBe(true);
    expect(control).toBeEnabled();
    expect(seen.has(control), `label ${field.label} names a control another label names`).toBe(false);
    seen.add(control);

    // Clicking the label focuses the control, and opens no picker.
    const label = labels.find((l) => field.label.test(l.textContent!.trim()))!;
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.click(label);
    expect(document.activeElement, `clicking ${field.label} focuses its control`).toBe(control);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByPlaceholderText("Search or type a new name…")).toBeNull();
  }
}

afterEach(cleanup);

describe("the Add Moment dialog's labels name their fields", () => {
  it("in the dialog opened through its own Add Moment button", () => {
    fake.current = createFakeSupabase(() => undefined);
    render(<AddEventDialog people={[ada]} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Add Moment" }));
    const dialog = screen.getByRole("dialog", { name: "Add Moment" });
    checkEveryLabel(dialog);
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue("");
  });

  it("in the dialog that edits an existing moment", () => {
    fake.current = createFakeSupabase(() => undefined);
    render(<AddEventDialog people={[ada]} onCreated={vi.fn()} editEvent={existing} open onOpenChange={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Edit Moment" });
    checkEveryLabel(dialog);
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue("Fictional trip");
    expect(within(dialog).getByLabelText(/^Start Date/)).toHaveValue("2024-03-01");
    expect(within(dialog).getByLabelText(/^End Date/)).toHaveValue("2024-03-04");
    expect(within(dialog).getByLabelText(/^Confidence \(Date\)/)).toHaveAttribute("aria-valuenow", "7");
    expect(within(dialog).getByLabelText(/^Impact/)).toHaveAttribute("aria-valuenow", "3");
    expect(within(dialog).getByLabelText(/^Confidence \(Truth\)/)).toHaveAttribute("aria-valuenow", "9");
  });
});
