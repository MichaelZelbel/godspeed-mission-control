// @vitest-environment jsdom
// The description box of Create a collection with AI has a name (#756): the
// dialog's own prompt, which is the only text that says what to type there.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { AICollectionDialog } from "./AICollectionDialog";
import { BRAND } from "@/lib/brand";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
afterEach(cleanup);

it("names the description box by the dialog's prompt", () => {
  render(<MemoryRouter><AICollectionDialog open onOpenChange={vi.fn()} /></MemoryRouter>);
  const prompt = `Describe what you want to track in one sentence. ${BRAND.name} will design the schema for you.`;
  expect(screen.getByText(prompt)).toBeVisible();
  const box = screen.getByLabelText(prompt, { exact: true });
  expect(box.tagName).toBe("TEXTAREA");
  expect(screen.getByRole("textbox", { name: prompt })).toBe(box);
});
