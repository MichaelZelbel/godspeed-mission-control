// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { AiVisibilityButton } from "./AiVisibilityButton";

// #573: the note toolbar's button read "AI", and one click hid the note from People, the Note
// Graph, AI Chat and MCP, said only in a tooltip and a short toast with no way back.
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const updates = vi.hoisted(() => [] as Array<{ table: string; values: Record<string, unknown>; id: unknown }>);
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => ({ update: (values: Record<string, unknown>) => ({ eq: async (_: string, id: unknown) => { updates.push({ table, values, id }); return { error: null }; } }) }) },
}));
vi.mock("@/hooks/useAiFootprint", () => ({ fetchAiFootprint: async () => ({ profileEntries: [], connections: [] }) }));
vi.mock("@/components/common/AiFootprintDialog", () => ({ AiFootprintDialog: () => null }));
afterEach(() => { cleanup(); updates.length = 0; vi.clearAllMocks(); });

const show = (props: Partial<React.ComponentProps<typeof AiVisibilityButton>> = {}) =>
  render(<QueryClientProvider client={new QueryClient()}><AiVisibilityButton kind="note" id="note-1" hidden={false} {...props} /></QueryClientProvider>);

it("says Hide from AI on a visible note and Hidden from AI once hidden", async () => {
  show();
  const button = screen.getByRole("button", { name: "Hide from AI" });
  fireEvent.click(button);
  expect(await screen.findByRole("button", { name: "Hidden from AI" })).toHaveAttribute("aria-pressed", "true");
  await waitFor(() => expect(updates).toEqual([{ table: "notes", values: { ai_visibility: "hidden" }, id: "note-1" }]));
});

it("icon-only, it carries the same words as its name", () => {
  show({ hidden: true, iconOnly: true });
  expect(screen.getByRole("button", { name: "Hidden from AI" })).toBeInTheDocument();
  expect(screen.queryByText("Hidden from AI")).toBeNull();
});

it("the toast that confirms hiding has an Undo that makes the note visible again", async () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Hide from AI" }));
  await waitFor(() => expect(toast.success).toHaveBeenCalled());
  const [message, options] = toast.success.mock.calls[0];
  expect(message).toMatch(/^Hidden from AI/);
  expect(options.action.label).toBe("Undo");
  options.action.onClick();
  await waitFor(() => expect(updates.at(-1)).toEqual({ table: "notes", values: { ai_visibility: "visible" }, id: "note-1" }));
  await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith("Visible to AI again", undefined));
});
