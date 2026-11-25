// @vitest-environment jsdom
// The plain Add form on My Profile keeps its entry open until the save has finished, so a
// reload right after Save cannot drop it, and a failed save is said in the form (#1089).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MemoryRouter } from "react-router-dom";
import { ProfileSections } from "./ProfileSections";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" }, loading: false }) }));

afterEach(cleanup);

const category = {
  id: "travel", user_id: "u", name: "Travel", slug: "travel", icon: null, description: null, sort_order: 1,
  is_default: true, visibility_scope: "all", created_at: "", updated_at: "",
};

function setup(add: (input: unknown) => Promise<unknown>) {
  render(
    <ProfileSections
      categories={[category] as any}
      facts={[]}
      actions={{ add } as any}
      showEmptyCategories
      showPinned={false}
      onUpdateCategory={vi.fn()}
      onDeleteCategory={vi.fn()}
      onAddCategory={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Value" }), { target: { value: "Dune" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
}

describe("plain Add form on My Profile", () => {
  it("stays open until the save has finished", async () => {
    let finish!: () => void;
    const add = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setup(add);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ value: "Dune", category_slug: "travel" }));
    // Still saving: the form is there, so nothing looks saved yet.
    expect(screen.getByRole("textbox", { name: "Value" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    finish();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull(), { timeout: 5000 });
  });

  it("says a failed save in the form and keeps the words", async () => {
    setup(vi.fn(() => Promise.reject(new Error("Nothing was saved. Try again."))));
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent("Nothing was saved. Try again.");
    expect(screen.getByRole("textbox", { name: "Value" })).toHaveValue("Dune");
  });

  it("keeps an entry across a reload: nothing shows as saved until the server has it, then it is there", async () => {
    // A server that commits the fact only after a delay, and a page that is its view.
    const server: any[] = [];
    let commit!: () => void;
    const add = (input: any) =>
      new Promise<void>((resolve) => {
        commit = () => {
          server.push({
            claim_id: "c1", user_id: "u", subject_type: "self", subject_id: null, contact_id: null,
            attribute: input.label, value: input.value, valid_from: null, valid_to: null, is_current: true,
            confidence: null, cardinality: null, origin: "user", rank: null, evidence_quote: null,
            source_type: null, source_id: null, review_by: null, created_at: "", updated_at: "",
            slot_id: "s1", label: input.label, category_slug: "travel", category_name: "Travel",
            visibility_scope: "all", is_pinned: false, show_to_agent: true, has_conflict: false,
          });
          resolve();
        };
      });
    setup(add);
    // Save was clicked, the server has nothing yet: the page must not look saved.
    expect(server).toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "Value" })).toBeInTheDocument();
    commit();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull(), { timeout: 5000 });
    // Reload: a fresh page built from what the server holds shows the entry.
    cleanup();
    render(
      <MemoryRouter><TooltipProvider>
      <ProfileSections
        categories={[category] as any}
        facts={server}
        actions={{ add } as any}
        showEmptyCategories
        showPinned={false}
        onUpdateCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
        onAddCategory={vi.fn()}
      />
      </TooltipProvider></MemoryRouter>,
    );
    expect(await screen.findByText("Dune")).toBeInTheDocument();
  });
});
