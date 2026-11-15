// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BLOCK_TYPE_LABELS, BlockTypeGroup } from "./EditorToolbarGroups";
import { BLOCK_TYPE_WIDTH, getGroupWidth } from "./toolbarLayout";

// The note editor's text-style menu read "Normal te" (#553): its label sat in a w-28 (112px) box
// with `truncate`, and its pilcrow and "Normal text" need about 85px of the 76px left inside it. The
// label now lays every choice in one grid cell, only the current one visible, so the trigger is
// always as wide as the longest choice and the label has no box narrower than itself to be cut by.
// jsdom has no layout, so this checks that arrangement; the pull request's browser check measures it.

function editorAt(level: 0 | 1 | 2 | 3) {
  return {
    isActive: (name: string, attrs?: { level?: number }) => name === "heading" && attrs?.level === level,
    chain: () => new Proxy({}, { get: () => () => ({ run: () => true }) }),
  } as any;
}

const shown = { 0: "Normal text", 1: "Heading 1", 2: "Heading 2", 3: "Heading 3" } as const;

describe("the text-style menu's label", () => {
  afterEach(cleanup);

  for (const level of [0, 1, 2, 3] as const) {
    it(`shows "${shown[level]}" whole, sized by the longest choice`, () => {
      render(<BlockTypeGroup editor={editorAt(level)} />);
      const trigger = screen.getByTestId("block-type-trigger");
      const label = screen.getByTestId("block-type-label");
      expect(trigger).toHaveAccessibleName(shown[level]);

      // Every choice is in the same grid cell, so the cell is as wide as the longest of them.
      const cells = Array.from(label.children) as HTMLElement[];
      expect(cells.map((c) => c.textContent)).toEqual([...BLOCK_TYPE_LABELS]);
      expect(label.className).toMatch(/\bgrid\b/);
      for (const cell of cells) expect(cell.className).toMatch(/\bcol-start-1\b.*\brow-start-1\b|\brow-start-1\b.*\bcol-start-1\b/);
      const visible = cells.filter((c) => !/\binvisible\b/.test(c.className));
      expect(visible.map((c) => c.textContent)).toEqual([shown[level]]);
      expect(visible[0]).not.toHaveAttribute("aria-hidden");

      // Nothing between the label and the trigger can cut it: no truncation, no clipping, no wrapping,
      // and the trigger has a floor, not a fixed width a longer label would overflow.
      for (let el: HTMLElement | null = visible[0]; el && el !== trigger.parentElement; el = el.parentElement) {
        expect(el.className).not.toMatch(/\btruncate\b|\boverflow-(hidden|clip)\b|\btext-ellipsis\b|\bmax-w-/);
      }
      expect(label.className).toMatch(/\bwhitespace-nowrap\b/);
      expect(trigger.className).not.toMatch(/(^|\s)w-\S+/);
      expect(trigger.className).toContain("min-w-[120px]");
      expect(trigger.className).toMatch(/\bshrink-0\b/);
    });
  }

  it("is charged by the toolbar's Priority+ math at the trigger's floor (min-w-[120px])", () => {
    expect(BLOCK_TYPE_WIDTH).toBe(120);
    expect(getGroupWidth("blockType", { hasWikilink: false, hasRemoveLink: false })).toBe(BLOCK_TYPE_WIDTH);
    // With "Normal text" (67px in Plus Jakarta Sans at text-xs) the trigger renders 119px wide in Chromium,
    // inside the floor; a wider font grows the trigger instead of cutting the label.
    expect(119).toBeLessThanOrEqual(BLOCK_TYPE_WIDTH);
  });
});
