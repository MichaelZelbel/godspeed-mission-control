// @vitest-environment jsdom
// Add an instruction on Godspeed's brain (#756): the "Which apps" select is
// found by its label, and the label, which a person can see, puts the focus on
// it when clicked.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InstructionForm } from "./Identity";
import { clickLabel } from "@/test/label-click";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
afterEach(cleanup);

it('finds the select by "Which apps", and its visible label focuses it', () => {
  render(<InstructionForm value={{ instruction: "", applies_to: "all" }} onSave={vi.fn()} onCancel={vi.fn()} />);
  const apps = screen.getByLabelText("Which apps", { exact: true });
  expect(apps.tagName).toBe("SELECT");
  expect(screen.getByRole("combobox", { name: "Which apps" })).toBe(apps);
  const label = (apps as HTMLSelectElement).labels![0];
  expect(label).not.toHaveClass("sr-only");
  clickLabel(label);
  expect(document.activeElement).toBe(apps);
  expect(screen.getByLabelText("Instruction", { exact: true }).tagName).toBe("TEXTAREA");
});
