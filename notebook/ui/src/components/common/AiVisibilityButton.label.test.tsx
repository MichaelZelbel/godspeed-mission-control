// @vitest-environment jsdom
// Issue #809: the note toolbar's switch that hides a note from the AI was
// labelled just "AI", which read like an AI action, and its toast showed at
// the top right, over the toolbar. It now says what it does. Its toast moved
// to the bottom centre, where it covered the note's save status (#819), then
// to the bottom left, where it covered the note's footer (#831). What a click
// did now shows just above the switch, not as a page toast;
// AiVisibilityButton.placement.test.ts checks in a real browser that it
// covers no part of the open note.
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

it("says what a click did just above the switch, not in a page toast", async () => {
  await show(false);
  fireEvent.click(screen.getByRole("button", { name: /Hide from AI/ }));
  const status = await screen.findByRole("status", {}, WAIT);
  expect(status).toHaveTextContent(/^Hidden from AI - excluded from People, Graph, AI Chat & MCP$/);
  expect(status).toHaveAttribute("data-side", "top");
  expect(toasts).toEqual([]);
  expect(await screen.findByRole("button", { name: "Hidden from AI. Show to AI again" }, WAIT)).toBeInTheDocument();
});

// Issue #890, loop review of 6e2572e97: when the switch gained a plain title
// tooltip it lost main's explanation of what hiding does - for a person, that
// the hide spreads to their linked notes and moments. These tests keep that
// explanation in the title, for the person and for other items.
async function showPerson(hidden: boolean) {
  const { AiVisibilityButton } = await import("./AiVisibilityButton");
  render(<QueryClientProvider client={new QueryClient()}><AiVisibilityButton kind="person" id="person-1" hidden={hidden} /></QueryClientProvider>);
}

it("tells a person before the click that hiding spreads to their linked notes and moments", async () => {
  await showPerson(false);
  expect(screen.getByRole("button", { name: "Shown to AI. Hide from AI" }).getAttribute("title")).toBe("Shown to AI. Hide from AI. Click to hide this person and everything linked to them from all AI features.");
});

it("tells a hidden person before the click that their linked notes and moments are hidden too", async () => {
  await showPerson(true);
  expect(screen.getByRole("button", { name: "Hidden from AI. Show to AI again" }).getAttribute("title")).toBe("Hidden from AI. Show to AI again. Linked notes & moments are hidden too.");
});

it("keeps main's explanation of what hiding an item means in its tooltip, led by the name's words", async () => {
  await show(false);
  expect(screen.getByRole("button", { name: "Shown to AI. Hide from AI" }).getAttribute("title")).toBe("Shown to AI. Hide from AI. Used in People profiles, the Note Graph, AI Chat, and MCP clients.");
  await show(true);
  expect(screen.getByRole("button", { name: "Hidden from AI. Show to AI again" }).getAttribute("title")).toBe("Hidden from AI. Show to AI again. Excluded from People, the Note Graph, AI Chat and MCP. Local search still finds it.");
});
