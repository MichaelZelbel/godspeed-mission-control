// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import Control from "./Control";

// The sidebar's "Connect AI" opens Settings at the AI connection (18 October 2026). It went to
// ?tab=mcp, which the notebook's Settings does not have, so it opened the top of the page.
vi.mock("@/components/settings/ApiKeysManager", () => ({ ApiKeysManager: () => <p>Keys</p> }));
vi.mock("@/components/settings/AISuggestionPreferences", () => ({ AISuggestionPreferences: () => null }));
vi.mock("@/components/settings/AiVisibilitySettings", () => ({ AiVisibilitySettings: () => null }));
vi.mock("@/components/settings/NotificationPreferences", () => ({ NotificationPreferences: () => null }));
vi.mock("./Notifications", () => ({ Notifications: () => null }));
vi.mock("@/components/settings/AboutTab", () => ({ AboutTab: () => null }));
vi.mock("./PersonalControl", () => ({ PersonalControl: () => null }));
vi.mock("./MeaningSearch", () => ({ MeaningSearch: () => null }));
vi.mock("./ConnectTelegram", () => ({ TelegramConnect: () => null, telegramStatus: async () => ({ available: false }) }));
vi.mock("./RecordSync", () => ({ RecordSyncForm: () => null }));
const scrolled: string[] = [];
Element.prototype.scrollIntoView = function () { scrolled.push((this as Element).id); };

function settings(at: string, status: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [], schedules: [], kinds: [], problems: [], conflicts: [], ...status }), { status: 200, headers: { "Content-Type": "application/json" } })));
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={[at]}>
      <Routes><Route path="/dashboard/settings" element={<Control />} /></Routes>
    </MemoryRouter>
  </QueryClientProvider>);
}

describe("Settings opened at one of its sections", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); scrolled.length = 0; });

  // Since the same day the AI connection (Your AI, ConnectAI.tsx) is a section that is always open,
  // because it says whether the routines reach the AI; the link scrolls to it.
  it("scrolls to the AI connection for the sidebar's Connect AI", async () => {
    const { container } = settings("/dashboard/settings#connect-ai");
    const section = container.querySelector("#connect-ai") as HTMLElement;
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("Your AI");
    await waitFor(() => expect(scrolled).toContain("connect-ai"));
    expect((container.querySelector("#connect-other-assistants") as HTMLDetailsElement).open).toBe(false);
  });

  it("opens Connect other assistants for a link to it", async () => {
    const { container } = settings("/dashboard/settings#connect-other-assistants");
    await waitFor(() => expect((container.querySelector("#connect-other-assistants") as HTMLDetailsElement).open).toBe(true));
  });

  it("stays at the top without a section named", async () => {
    const { container } = settings("/dashboard/settings");
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(container.querySelector("#connect-ai")).not.toBeNull();
    expect(scrolled).toEqual([]);
  });

  // Issue #4: the button started the Windows assistant and showed on every install, though it works on Windows only.
  it("shows Open the Windows assistant on Windows", async () => {
    const { findByText } = settings("/dashboard/settings", { platform: "win32" });
    expect(await findByText("Open the Windows assistant")).toBeInTheDocument();
  });

  it.each(["darwin", "linux"])("does not show Open the Windows assistant on %s", async (platform) => {
    const { queryByText, findByText } = settings("/dashboard/settings", { platform });
    await findByText("Settings");
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(queryByText("Open the Windows assistant")).toBeNull();
  });
});
