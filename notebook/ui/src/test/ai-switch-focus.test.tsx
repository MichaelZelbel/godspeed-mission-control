// @vitest-environment jsdom
// Issue #864: toggling a note's AI switch (Space, Enter or mouse) used to disable the button
// while the change saved, and an HTML-disabled button drops keyboard focus to the page body, so
// the next Tab started again from the top of the page. The switch now stays focusable while the
// save runs and says `aria-disabled` instead.
//
// jsdom does not turn a key press into the click the browser makes of it, so the test presses
// Space on the switch (keydown) and then sends the click that keyup causes in a browser, which is
// what the button's onClick receives from the keyboard.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { TEST_MS } from "./wait-limits";

let resolveSave: (() => void) | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: () =>
          new Promise<{ error: null }>((resolve) => {
            resolveSave = () => resolve({ error: null });
          }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAiFootprint", () => ({ fetchAiFootprint: async () => ({ profileEntries: [], connections: [] }) }));
vi.mock("@/components/common/AiFootprintDialog", () => ({ AiFootprintDialog: () => null }));

afterEach(() => {
  cleanup();
  resolveSave = null;
});

async function show() {
  const { AiVisibilityButton } = await import("@/components/common/AiVisibilityButton");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <div>
        <AiVisibilityButton kind="note" id="note-1" hidden={false} />
        <button>the control after the switch</button>
      </div>
    </QueryClientProvider>,
  );
}

it(
  "keeps focus on the switch while the save runs and after it settles",
  { timeout: TEST_MS },
  async () => {
    await show();
    const switchButton = screen.getByRole("button", { name: "Shown to AI. Hide from AI" });
    switchButton.focus();
    expect(document.activeElement).toBe(switchButton);

    // Space on the switch, the click a browser makes of its keyup.
    fireEvent.keyDown(switchButton, { key: " ", code: "Space", charCode: 32 });
    fireEvent.click(switchButton);
    await waitFor(() => expect(switchButton).toHaveAttribute("aria-disabled", "true"));
    expect(switchButton).toHaveAttribute("aria-busy", "true");
    expect(document.activeElement).toBe(switchButton);

    // The save finishes: the switch keeps the focus, and it no longer says it is disabled.
    resolveSave!();
    await screen.findByRole("status", {}, { timeout: TEST_MS });
    expect(document.activeElement).toBe(switchButton);
    expect(switchButton).toHaveAttribute("aria-disabled", "false");
    expect(switchButton).toHaveAttribute("aria-busy", "false");
  },
);

it(
  "keeps the switch in the tab order while the save runs, so the next Tab moves on from it",
  { timeout: TEST_MS },
  async () => {
    await show();
    const switchButton = screen.getByRole("button", { name: "Shown to AI. Hide from AI" });
    switchButton.focus();
    fireEvent.keyDown(switchButton, { key: " ", code: "Space", charCode: 32 });
    fireEvent.click(switchButton);
    await waitFor(() => expect(switchButton).toHaveAttribute("aria-disabled", "true"));

    // The switch is focusable: nothing removed it from the tab order, so the browser's next Tab
    // moves from it to the control after it.
    const after = screen.getByRole("button", { name: "the control after the switch" });
    expect(after.tabIndex).toBe(0);
    expect(switchButton.tabIndex).toBe(0);
    expect(document.activeElement).toBe(switchButton);
    resolveSave!();
  },
);
