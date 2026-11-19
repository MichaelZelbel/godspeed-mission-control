// @vitest-environment jsdom
// Issue #809: the note toolbar's switch that hides a note from the AI was
// labelled just "AI", which read like an AI action, and its toast showed at
// the top right, over the toolbar. It now says what it does, and its toast
// shows at the bottom of the screen.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { WAIT } from "@/test/wait-limits";

const toasts = vi.hoisted(() => [] as { message: string; options: any }[]);
vi.mock("sonner", () => {
  const record = vi.fn((message: string, options?: unknown) => { toasts.push({ message, options }); return toasts.length; });
  return { toast: Object.assign(record, { success: record, error: record, info: record, warning: record, loading: record, dismiss: vi.fn() }) };
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) },
}));
vi.mock("@/hooks/useAiFootprint", () => ({ fetchAiFootprint: async () => ({ profileEntries: [], connections: [] }) }));
vi.mock("@/components/common/AiFootprintDialog", () => ({ AiFootprintDialog: () => null }));

afterEach(() => { cleanup(); toasts.length = 0; });

async function show(hidden: boolean) {
  const { AiVisibilityButton } = await import("./AiVisibilityButton");
  render(<QueryClientProvider client={new QueryClient()}><AiVisibilityButton kind="note" id="note-1" hidden={hidden} /></QueryClientProvider>);
}

it("says a note is shown to the AI and that a click hides it", async () => {
  await show(false);
  const button = screen.getByRole("button", { name: "Shown to AI. Hide from AI" });
  expect(button).toHaveTextContent(/^Shown to AI$/);
});

it("says a hidden note is hidden from the AI and that a click shows it again", async () => {
  await show(true);
  const button = screen.getByRole("button", { name: "Hidden from AI. Show to AI again" });
  expect(button).toHaveTextContent(/^Hidden from AI$/);
});

it("shows its toast at the bottom, away from the note toolbar", async () => {
  await show(false);
  fireEvent.click(screen.getByRole("button", { name: /Hide from AI/ }));
  await waitFor(() => expect(toasts.length).toBe(1), WAIT);
  expect(toasts[0].message).toMatch(/^Hidden from AI/);
  expect(toasts[0].options?.position).toMatch(/^bottom/);
  expect(await screen.findByRole("button", { name: "Hidden from AI. Show to AI again" }, WAIT)).toBeInTheDocument();
});
