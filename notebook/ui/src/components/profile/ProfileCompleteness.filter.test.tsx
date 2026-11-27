// @vitest-environment jsdom
// My Profile's progress chips follow Filter fields (#1077).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { ProfileCompleteness } from "./ProfileCompleteness";
import { ProfileSections } from "./ProfileSections";

afterEach(cleanup);

const names = ["Food & Drink", "Travel", "Health", "Work", "Music", "Books", "Sport", "Games", "Art", "Pets"];
const categories = names.map((name, i) => ({
  id: `c${i}`, user_id: "u", name, slug: name.toLowerCase().replace(/\W+/g, "_"), icon: null, description: null,
  sort_order: i, is_default: true, visibility_scope: "all", created_at: "", updated_at: "",
}));

function Page() {
  const [q, setQ] = useState("");
  return (
    <MemoryRouter>
      <ProfileCompleteness categories={categories as any} facts={[]} filterQuery={q} />
      <ProfileSections
        categories={categories as any} facts={[]} actions={{} as any} showEmptyCategories showPinned={false}
        onUpdateCategory={vi.fn()} onDeleteCategory={vi.fn()} onAddCategory={vi.fn()} onFilterChange={setQ}
      />
    </MemoryRouter>
  );
}

describe("progress chips and Filter fields", () => {
  it("lists only matching categories while filtering and restores on clear", () => {
    render(<Page />);
    expect(screen.getByText("+4 more")).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Filter fields" });
    fireEvent.change(box, { target: { value: "pets" } });
    expect(screen.queryByText(/more$/)).toBeNull();
    expect(screen.getAllByText("Pets").length).toBe(2); // chip + section
    expect(screen.queryAllByText("Travel").length).toBe(0);
    fireEvent.change(box, { target: { value: "" } });
    expect(screen.getByText("+4 more")).toBeInTheDocument();
  });
});
