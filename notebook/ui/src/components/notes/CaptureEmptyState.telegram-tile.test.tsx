// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { CaptureEmptyState } from "./CaptureEmptyState";
import Control from "@/local/Control";
import ConnectTelegram from "@/local/ConnectTelegram";
import { telegramSwitchedOff } from "@/local/ConnectTelegram";
import { WAIT } from "@/test/wait-limits";

// The one sentence the Telegram page and the Settings' Telegram section show where Telegram cannot
// be connected on this notebook (issue #915).
const TELEGRAM_UNAVAILABLE = "Telegram cannot be connected on this notebook; it becomes available once the assistant is installed and runs this notebook (run the Godspeed installer again to install it).";

// Issue #915: the Dashboard empty state's Telegram tile went to Settings, which showed no Telegram
// at all where Telegram cannot be connected on this notebook. It must lead to a page that says so
// in one sentence, and to the Telegram setup where Telegram is available.

// The components Settings renders that this page does not test: the same set Control.test.tsx mocks.
vi.mock("@/components/settings/ApiKeysManager", () => ({ ApiKeysManager: () => <p>Keys</p> }));
vi.mock("@/components/settings/AISuggestionPreferences", () => ({ AISuggestionPreferences: () => null }));
vi.mock("@/components/settings/AiVisibilitySettings", () => ({ AiVisibilitySettings: () => null }));
vi.mock("@/components/settings/NotificationPreferences", () => ({ NotificationPreferences: () => null }));
vi.mock("@/local/Notifications", () => ({ Notifications: () => null }));
vi.mock("@/components/settings/AboutTab", () => ({ AboutTab: () => null }));
vi.mock("@/local/PersonalControl", () => ({ PersonalControl: () => null }));
vi.mock("@/local/MeaningSearch", () => ({ MeaningSearch: () => null }));
vi.mock("@/local/RecordSync", () => ({ RecordSyncForm: () => null }));

function page(telegram: Record<string, unknown>, start: string) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const answer = String(url).replace(/^\/api\//, "") === "telegram" ? telegram : { data: [], schedules: [], kinds: [], problems: [], conflicts: [] };
    return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[start]}>
        <Routes>
          <Route path="/dashboard/notes" element={<CaptureEmptyState variant="full" />} />
          <Route path="/dashboard/settings" element={<Control />} />
          <Route path="/dashboard/telegram" element={<ConnectTelegram />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// jsdom has no scrollIntoView; Settings scrolls to the section a link names.
const scrolled: string[] = [];
Element.prototype.scrollIntoView = function () { scrolled.push((this as Element).id); };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); scrolled.length = 0; });

describe("The Dashboard empty state's Telegram tile", () => {
  it("leads to a page that says why Telegram cannot be connected, when it is not available", async () => {
    page({ available: false, managed: null, connected: false, phase: "none" }, "/dashboard/notes");
    fireEvent.click(await screen.findByRole("link", { name: /Telegram/ }, WAIT));
    expect(await screen.findByText(TELEGRAM_UNAVAILABLE, undefined, WAIT)).toBeInTheDocument();
  });

  // Issue #1019: the tile linked to ?tab=telegram, which Settings ignores, so Settings opened at the top.
  it("opens Settings scrolled to its Telegram section", async () => {
    page({ available: true, managed: "web", connected: false, phase: "none" }, "/dashboard/notes");
    fireEvent.click(await screen.findByRole("link", { name: /Telegram/ }, WAIT));
    await waitFor(() => expect(scrolled).toContain("telegram"), WAIT);
  });

  it("leads to the Telegram setup where Telegram is available", async () => {
    page({ available: true, managed: "web", connected: false, phase: "none" }, "/dashboard/notes");
    fireEvent.click(await screen.findByRole("link", { name: /Telegram/ }, WAIT));
    expect(await screen.findByText(/In Telegram, open/, undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText("BotFather")).toBeInTheDocument();
    expect(screen.getByLabelText("Your bot's key")).toBeInTheDocument();
  });

  it("and the Telegram page show the same setup where Telegram is available", async () => {
    page({ available: true, managed: "web", connected: false, phase: "none" }, "/dashboard/telegram");
    expect(await screen.findByText(/In Telegram, open/, undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText("BotFather")).toBeInTheDocument();
    expect(screen.getByLabelText("Your bot's key")).toBeInTheDocument();
  });
});

// Issue #975: where Telegram cannot be connected, the tile promised it worked.
describe("The tile's own words", () => {
  const PROMISE = "Send messages to your bot to capture ideas on the go.";

  it("say what the Telegram page says where Telegram cannot be connected", async () => {
    page({ available: false, managed: null, connected: false, phase: "none" }, "/dashboard/notes");
    expect(await screen.findByText(TELEGRAM_UNAVAILABLE, undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByText(PROMISE)).toBeNull();
  });

  it("say the server's operator switched Telegram off when they did", async () => {
    page({ available: false, managed: null, reason: "switched-off", connected: false, phase: "none" }, "/dashboard/notes");
    expect(await screen.findByText(telegramSwitchedOff, undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByText(PROMISE)).toBeNull();
  });

  it("stay as they were where the server settings manage Telegram", async () => {
    page({ available: false, managed: "environment", connected: false, phase: "none" }, "/dashboard/notes");
    // The promise shows before the status arrives, so let the answer land before judging the tile.
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith(expect.stringContaining("telegram"), expect.anything()), WAIT);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.getByText(PROMISE)).toBeInTheDocument();
    expect(screen.queryByText(TELEGRAM_UNAVAILABLE)).toBeNull();
  });

  it("stay as they were where Telegram can be connected", async () => {
    page({ available: true, managed: "web", connected: false, phase: "none" }, "/dashboard/notes");
    expect(await screen.findByText(PROMISE, undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByText(TELEGRAM_UNAVAILABLE)).toBeNull();
  });
});
