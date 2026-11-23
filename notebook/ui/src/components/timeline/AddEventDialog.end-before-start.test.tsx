// @vitest-environment jsdom
// An end date before the start date is refused beside End Date in Add and in
// Edit, and everything typed stays (#1032).
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

const dated: EditMomentData = {
  id: "moment-dated", title: "A trip", description: null,
  happened_at: "2025-03-05T00:00:00Z", happened_end: "2025-03-07T00:00:00Z", status: "past_fact",
  impact_level: 2, confidence_date: 5, confidence_truth: 5, participantIds: [],
};

afterEach(() => {
  cleanup();
  fake.current?.reset();
});

describe("a moment that ends before it starts", () => {
  it("Add shows the message beside End Date, keeps what was typed and saves once the end is fixed", async () => {
    fake.current = createFakeSupabase();
    const onCreated = vi.fn();
    render(<AddEventDialog people={[]} onCreated={onCreated} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Add Moment" });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Backwards" } });
    fireEvent.change(within(dialog).getByLabelText("Start Date"), { target: { value: "2025-03-05" } });
    const end = within(dialog).getByLabelText("End Date") as HTMLInputElement;
    fireEvent.change(end, { target: { value: "2025-03-01" } });

    const message = within(dialog).getByText(MESSAGE);
    expect(end).toHaveAttribute("aria-invalid", "true");
    expect(end.getAttribute("aria-describedby")).toBe(message.id);
    const create = within(dialog).getByRole("button", { name: "Create Moment" });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(fake.current.on("moments", "insert")).toHaveLength(0);
    expect((within(dialog).getByLabelText("Title") as HTMLInputElement).value).toBe("Backwards");
    expect((within(dialog).getByLabelText("Start Date") as HTMLInputElement).value).toBe("2025-03-05");
    expect(end.value).toBe("2025-03-01");

    fireEvent.change(end, { target: { value: "2025-03-05" } });
    expect(within(dialog).queryByText(MESSAGE)).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create Moment" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce(), WAIT);
    const inserts = fake.current.on("moments", "insert");
    expect(inserts).toHaveLength(1);
    expect((inserts[0].payload as any).happened_end).toBe("2025-03-05");
  });

  it("Edit refuses an end before the start, and saves once the end is cleared", async () => {
    fake.current = createFakeSupabase();
    const onCreated = vi.fn();
    render(<AddEventDialog people={[]} onCreated={onCreated} editEvent={dated} open onOpenChange={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Edit Moment" });
    const end = within(dialog).getByLabelText("End Date") as HTMLInputElement;
    fireEvent.change(end, { target: { value: "2025-03-01" } });

    expect(within(dialog).getByText(MESSAGE)).toBeInTheDocument();
    const save = within(dialog).getByRole("button", { name: "Save Changes" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(fake.current.on("moments", "update")).toHaveLength(0);

    fireEvent.change(end, { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce(), WAIT);
    const updates = fake.current.on("moments", "update");
    expect(updates).toHaveLength(1);
    expect((updates[0].payload as any).happened_end).toBeNull();
  });
});
