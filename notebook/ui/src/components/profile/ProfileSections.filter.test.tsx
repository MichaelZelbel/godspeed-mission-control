// @vitest-environment jsdom
// My Profile's Filter fields also matches category names, so "food" finds
// Food & Drink even when it is empty and (#1044).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProfileSections } from "./ProfileSections";

afterEach(cleanup);

const cat = (name: string, slug: string, i: number) => ({
  id: slug, user_id: "u", name, slug, icon: null, description: null, sort_order: i,
  is_default: true, visibility_scope: "all", created_at: "", updated_at: "",
});
const categories = [cat("Food & Drink", "food_drink", 1), cat("Travel", "travel", 2)];

function setup() {
  render(
    <ProfileSections
      categories={categories as any}
      facts={[]}
      actions={{} as any}
      showEmptyCategories
      showPinned={false}
      onUpdateCategory={vi.fn()}
      onDeleteCategory={vi.fn()}
      onAddCategory={vi.fn()}
    />,
  );
  return screen.getByRole("textbox", { name: "Filter fields" });
}

describe("Filter fields and category names", () => {
  it.each(["food", "Drink", "FOOD & dr", "ood"])("shows Food & Drink for %s and hides Travel", (q) => {
    const box = setup();
    fireEvent.change(box, { target: { value: q } });
    expect(screen.getByText("Food & Drink")).toBeInTheDocument();
    expect(screen.queryByText("Travel")).toBeNull();
  });

  it("names what was searched when nothing matches", () => {
    const box = setup();
    fireEvent.change(box, { target: { value: "zzz" } });
    expect(screen.getByText('No categories or facts match "zzz".')).toBeInTheDocument();
  });
});
