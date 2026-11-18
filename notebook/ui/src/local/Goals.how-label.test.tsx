// @vitest-environment jsdom
// The "How" field of naming a goal's weekly number is found by its label alone
// (#756): its name is "How", not "How" followed by every option's text.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NameTheNumber } from "./Goals";
import { clickLabel } from "@/test/label-click";

afterEach(cleanup);

it('finds the select by getByLabelText("How", exact) and names it exactly "How"', () => {
  const goal = { id: "g1", title: "Fictional goal", lead: null } as any;
  render(<NameTheNumber goal={goal} operation={vi.fn(async () => true)} busy={false} />);
  const how = screen.getByLabelText("How", { exact: true });
  expect(how.tagName).toBe("SELECT");
  expect(screen.getByRole("combobox", { name: "How" })).toBe(how);
  expect((how as HTMLSelectElement).labels![0].textContent).toBe("How");
  clickLabel((how as HTMLSelectElement).labels![0]);
  expect(document.activeElement).toBe(how);
  // The fields beside it keep their names.
  expect(screen.getByLabelText("What is counted").tagName).toBe("INPUT");
  expect(screen.getByLabelText("Where it is read").tagName).toBe("INPUT");
});
