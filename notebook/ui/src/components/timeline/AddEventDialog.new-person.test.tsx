// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase, filterValue, type RecordedQuery } from "@/test/fake-supabase";
import AddEventDialog, { type TimelineContact } from "./AddEventDialog";

// Adding a moment by hand can add a person who is not in People yet, right in
// the People picker (#581). Until then only a suggestion's names could be
// added, and with an empty People list the field was not shown at all.

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current.client; } }));
const { auth } = vi.hoisted(() => ({ auth: { user: { id: "owner" }, session: { access_token: "t", user: { id: "owner" } } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/hooks/useAICreditsGate", () => ({ useAICreditsGate: () => ({ checkCredits: () => true }) }));

// jsdom lacks what Radix and cmdk measure with.
class NoResize { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoResize as any;
Element.prototype.scrollIntoView ??= () => {};

// The notebook's People, as the database holds them; the lookup on save is
// without case, like the real ilike.
function notebook(rows: { id: string; name: string }[], { failInsert = false } = {}) {
  let next = 1;
  return createFakeSupabase((q: RecordedQuery) => {
    if (q.table === "contacts" && q.op === "select") {
      const name = String(filterValue(q, "ilike", "name") ?? "").replace(/\\(.)/g, "$1").toLowerCase();
      return { data: rows.filter((r) => r.name.toLowerCase() === name).map((r) => ({ id: r.id })) };
    }
    if (q.table === "contacts" && q.op === "insert") {
      if (failInsert) return { error: { message: "Fictional insert failure" } };
      const id = `c-new-${next++}`;
      rows.push({ id, name: (q.payload as any).name });
      return { data: { id } };
    }
    if (q.table === "moments" && q.op === "insert") return { data: { id: "m-new" } };
    return undefined;
  });
}

function openDialog(people: TimelineContact[]) {
  const onCreated = vi.fn();
  render(<AddEventDialog people={people} onCreated={onCreated} open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Short title for this moment"), { target: { value: "Met up" } });
  return onCreated;
}

function typeInPicker(text: string) {
  fireEvent.click(screen.getByText(/^Add (person|more)$/).closest("button")!);
  fireEvent.change(screen.getByPlaceholderText(/Search or type a new name/), { target: { value: text } });
}

// Chooses the new-person item the way a mouse user does: it must be an
// accessible option (no hidden ancestor, so the role query finds it) and
// visible, and it is clicked, not chosen with Enter. cmdk hides a group it
// counts no matching items in, and that hid this item once (#581 review).
async function clickAddNew(name: string) {
  const option = await screen.findByRole("option", { name: `Add "${name}" as a new person` });
  expect(option).toBeVisible();
  expect(option.closest("[hidden]")).toBeNull();
  fireEvent.click(option);
}

const participants = () => fake.current.on("moment_participants", "insert").flatMap((q: RecordedQuery) => (q.payload as any[]).map((r) => r.person_id));

describe("adding a new person while adding a moment by hand", () => {
  afterEach(() => cleanup());

  it("creates a brand-new name in People and links it to the moment", async () => {
    fake.current = notebook([{ id: "c-ada", name: "Fictional Ada" }]);
    const onCreated = openDialog([{ id: "c-ada", name: "Fictional Ada", relationship: null }]);
    typeInPicker("Fictional Bea");
    await clickAddNew("Fictional Bea");
    const chip = document.querySelector('[data-new-person="Fictional Bea"]') as HTMLElement;
    expect(chip).toBeInTheDocument();
    expect(within(chip).getByText("new")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(fake.current.on("contacts", "insert").map((q: RecordedQuery) => q.payload)).toEqual([{ user_id: "owner", name: "Fictional Bea" }]);
    expect(participants()).toEqual(["c-new-1"]);
    expect((fake.current.on("moments", "insert")[0].payload as any).person_id).toBe("c-new-1");
  });

  it("does not offer a name that is in People under another case, and picks that person", async () => {
    fake.current = notebook([{ id: "c-ada", name: "Fictional Ada" }]);
    const onCreated = openDialog([{ id: "c-ada", name: "Fictional Ada", relationship: null }]);
    typeInPicker("fictional ada");
    expect(screen.queryByText(/as a new person/)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("option", { name: "Fictional Ada" }));

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(fake.current.on("contacts", "insert")).toHaveLength(0);
    expect(participants()).toEqual(["c-ada"]);
  });

  it("links a person the database has under another case instead of making a second one", async () => {
    // The dialog's list is behind: the database already has "Fictional Cleo".
    fake.current = notebook([{ id: "c-cleo", name: "Fictional Cleo" }]);
    const onCreated = openDialog([]);
    typeInPicker("FICTIONAL CLEO");
    await clickAddNew("FICTIONAL CLEO");

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(fake.current.on("contacts", "insert")).toHaveLength(0);
    expect(participants()).toEqual(["c-cleo"]);
  });

  it("shows the People field with an empty People list and adds the first person", async () => {
    fake.current = notebook([]);
    const onCreated = openDialog([]);
    expect(screen.getByText("People")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/^Add (person|more)$/).closest("button")!);
    expect(await screen.findByText("Type a name to add a new person.")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Search or type a new name/), { target: { value: "Fictional Dora" } });
    await clickAddNew("Fictional Dora");

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(fake.current.on("contacts", "insert").map((q: RecordedQuery) => (q.payload as any).name)).toEqual(["Fictional Dora"]);
    expect(participants()).toEqual(["c-new-1"]);
  });

  it("creates nobody when the new chip is removed before saving", async () => {
    fake.current = notebook([]);
    const onCreated = openDialog([]);
    typeInPicker("Fictional Eli");
    await clickAddNew("Fictional Eli");
    fireEvent.keyDown(document.activeElement || document.body, { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "Remove new person Fictional Eli" }));
    expect(document.querySelector('[data-new-person="Fictional Eli"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(fake.current.on("contacts")).toHaveLength(0);
    expect(participants()).toEqual([]);
  });

  it("writes no moment when the new person cannot be created", async () => {
    fake.current = notebook([], { failInsert: true });
    const onCreated = openDialog([]);
    typeInPicker("Fictional Finn");
    await clickAddNew("Fictional Finn");

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await waitFor(() => expect(fake.current.on("contacts", "insert")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(onCreated).not.toHaveBeenCalled();
    expect(fake.current.on("moments")).toHaveLength(0);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to create moment", variant: "destructive" }));
  });

  it("adds a new person the same way when editing a moment", async () => {
    fake.current = notebook([{ id: "c-ada", name: "Fictional Ada" }]);
    const onCreated = vi.fn();
    render(
      <AddEventDialog
        people={[{ id: "c-ada", name: "Fictional Ada", relationship: null }]}
        onCreated={onCreated}
        open
        onOpenChange={() => {}}
        editEvent={{ id: "m-old", title: "Old moment", description: null, happened_at: "2026-11-01", happened_end: null, status: "past_fact", impact_level: 2, confidence_date: 5, confidence_truth: 5, participantIds: ["c-ada"] }}
      />,
    );
    typeInPicker("Fictional Gus");
    await clickAddNew("Fictional Gus");

    fireEvent.click(screen.getByRole("button", { name: /Save|Update/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(fake.current.on("contacts", "insert").map((q: RecordedQuery) => (q.payload as any).name)).toEqual(["Fictional Gus"]);
    expect(participants()).toEqual(["c-ada", "c-new-1"]);
  });
});
