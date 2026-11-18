// @vitest-environment jsdom
// The manual Add moment dialog, opened through its own "Add Moment" button the
// way a person opens it on the Timeline page (#697). The People control must be
// there, named by its visible label, usable by mouse and keyboard, and calm
// when People is still empty.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase, type RecordedQuery } from "@/test/fake-supabase";
import AddEventDialog, { type TimelineContact } from "./AddEventDialog";

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
const bea: TimelineContact = { id: "person-bea", name: "Fictional Bea", relationship: null };

function database() {
  return createFakeSupabase((q: RecordedQuery) => {
    if (q.table === "moments" && q.op === "insert") return { data: { id: "moment-1" } };
    return undefined;
  });
}

// Opens the dialog by pressing the page's "Add Moment" button, not by a prop.
function openThroughButton(people: TimelineContact[]) {
  const onCreated = vi.fn();
  const view = render(<AddEventDialog people={people} onCreated={onCreated} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add Moment" }));
  const dialog = screen.getByRole("dialog", { name: "Add Moment" });
  return { onCreated, dialog, view };
}

// The control a person sees under the visible "People" label.
function peopleControl(dialog: HTMLElement) {
  const byLabel = within(dialog).getByLabelText("People");
  expect(byLabel).toBe(within(dialog).getByRole("combobox", { name: "People" }));
  expect(byLabel).toBeVisible();
  expect(byLabel).toBeEnabled();
  // The visible "People" text is the control's own label, not a caption beside it.
  expect(within(dialog).getByText("People", { selector: "label" })).toHaveAttribute("for", byLabel.id);
  return byLabel;
}

function pickerInput() {
  return screen.getByPlaceholderText("Search or type a new name…");
}

afterEach(cleanup);

describe("the Add Moment button's dialog has a usable People control", () => {
  it("picks an existing person with the mouse and saves exactly that one link, leaving the person alone", async () => {
    fake.current = database();
    const { dialog, onCreated } = openThroughButton([ada, bea]);
    const control = peopleControl(dialog);
    expect(control).toHaveTextContent("Add person");

    fireEvent.change(within(dialog).getByPlaceholderText("Short title for this moment"), { target: { value: "Fictional lunch" } });
    fireEvent.click(control);
    fireEvent.click(await screen.findByRole("option", { name: ada.name }));

    // Visible before saving: the chosen person's chip, and the control now offers more.
    expect(within(dialog).getByRole("button", { name: `Remove ${ada.name}` })).toBeVisible();
    expect(control).toHaveTextContent("Add more");

    fireEvent.click(within(dialog).getByRole("button", { name: "Create Moment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());

    expect(fake.current.on("moments", "insert")[0].payload).toEqual(expect.objectContaining({ person_id: ada.id, source: "manual" }));
    const links = fake.current.on("moment_participants", "insert");
    expect(links).toHaveLength(1);
    expect(links[0].payload).toEqual([{ moment_id: "moment-1", person_id: ada.id }]);
    // Picking someone who already exists never writes to People.
    expect(fake.current.on("contacts").filter((q: RecordedQuery) => q.op !== "select")).toEqual([]);
  });

  it("picks an existing person with the keyboard", async () => {
    fake.current = database();
    const { dialog, onCreated } = openThroughButton([ada, bea]);
    const control = peopleControl(dialog);
    control.focus();
    expect(control).toHaveFocus();

    fireEvent.click(control);
    const input = pickerInput();
    fireEvent.change(input, { target: { value: "Bea" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(within(dialog).getByRole("button", { name: `Remove ${bea.name}` })).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: `Remove ${ada.name}` })).toBeNull();

    fireEvent.keyDown(document.activeElement ?? input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByPlaceholderText("Search or type a new name…")).toBeNull());
    expect(screen.getByRole("dialog", { name: "Add Moment" })).toBeVisible();

    fireEvent.change(within(dialog).getByPlaceholderText("Short title for this moment"), { target: { value: "Fictional call" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Moment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(fake.current.on("moment_participants", "insert")[0].payload).toEqual([{ moment_id: "moment-1", person_id: bea.id }]);
    expect(fake.current.on("contacts").filter((q: RecordedQuery) => q.op !== "select")).toEqual([]);
  });

  it("stays calm while People is empty, then offers the first person once they exist", async () => {
    fake.current = database();
    const { dialog, view, onCreated } = openThroughButton([]);
    const control = peopleControl(dialog);

    fireEvent.click(control);
    const input = pickerInput();
    expect(input).toHaveFocus();
    expect(screen.getByText("Type a name to add a new person.")).toBeVisible();
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    // Enter with nothing typed adds nobody and closes nothing.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dialog.querySelector("[data-new-person]")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Add Moment" })).toBeVisible();

    // Escape closes only the picker; the moment dialog stays open.
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByPlaceholderText("Search or type a new name…")).toBeNull());
    expect(screen.getByRole("dialog", { name: "Add Moment" })).toBeVisible();
    expect(onCreated).not.toHaveBeenCalled();

    // The first person appears in People (the Timeline page reloads its list).
    view.rerender(<AddEventDialog people={[ada]} onCreated={onCreated} />);
    fireEvent.click(peopleControl(screen.getByRole("dialog", { name: "Add Moment" })));
    fireEvent.click(await screen.findByRole("option", { name: ada.name }));
    expect(screen.getByRole("button", { name: `Remove ${ada.name}` })).toBeVisible();
  });
});
