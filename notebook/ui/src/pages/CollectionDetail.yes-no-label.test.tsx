// @vitest-environment jsdom
// A collection item's yes/no field works like a checkbox (#756): the field's
// label names the switch, and clicking the label flips the switch and puts the
// focus on it.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { FieldInput } from "./CollectionDetail";
import { clickLabel } from "@/test/label-click";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
afterEach(cleanup);

function Item({ start }: { start: boolean | null }) {
  const [value, setValue] = useState<any>(start);
  return <>
    <FieldInput field={{ key: "read", label: "Read it", type: "boolean" }} value={value} onChange={setValue} collections={[]} currentCollection={null} />
    <FieldInput field={{ key: "title", label: "Title", type: "text" }} value="" onChange={() => {}} collections={[]} currentCollection={null} />
  </>;
}

it("names the switch by the field's label, and a label click toggles and focuses it", () => {
  render(<Item start={null} />);
  const toggle = screen.getByLabelText("Read it", { exact: true });
  expect(toggle).toHaveAttribute("role", "switch");
  expect(screen.getByRole("switch", { name: "Read it" })).toBe(toggle);
  expect(toggle).toHaveAttribute("aria-checked", "false");
  const label = screen.getByText("Read it", { selector: "label" });

  clickLabel(label);
  expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(document.activeElement).toBe(toggle);

  clickLabel(label);
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(document.activeElement).toBe(toggle);
});

it("toggles once per label click when the switch starts on", () => {
  render(<Item start={true} />);
  const toggle = screen.getByRole("switch", { name: "Read it" });
  expect(toggle).toHaveAttribute("aria-checked", "true");
  clickLabel(screen.getByText("Read it", { selector: "label" }));
  expect(toggle).toHaveAttribute("aria-checked", "false");
});
