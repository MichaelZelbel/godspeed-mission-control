// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import Control from "./Control";
import { WAIT } from "@/test/wait-limits";

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
// The Telegram status the mocked ConnectTelegram module answers with; tests that need a reason
// in it (issue #919) set telegramStatusData.value before rendering.
const telegramStatusData = vi.hoisted(() => ({ value: { available: false } as Record<string, unknown>, delayMs: 0 }));
vi.mock("./ConnectTelegram", () => ({ TelegramConnect: () => null, telegramStatus: async () => { await new Promise(resolve => setTimeout(resolve, telegramStatusData.delayMs)); return telegramStatusData.value; }, telegramUnavailable: "Telegram cannot be connected on this notebook.", telegramSwitchedOff: "The person who runs this server has switched Telegram off; asking them to switch it on is the way to get it here." }));
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
    await waitFor(() => expect(scrolled).toContain("connect-ai"), WAIT);
    expect((container.querySelector("#connect-other-assistants") as HTMLDetailsElement).open).toBe(false);
  });

  it("opens Connect other assistants for a link to it", async () => {
    const { container } = settings("/dashboard/settings#connect-other-assistants");
    await waitFor(() => expect((container.querySelector("#connect-other-assistants") as HTMLDetailsElement).open).toBe(true), WAIT);
  });

  // The Telegram section renders only once its status answers, after the first lookup has run.
  it("scrolls to Telegram when its section appears after the page opened", async () => {
    telegramStatusData.delayMs = 80;
    try {
      const { container } = settings("/dashboard/settings#telegram");
      expect(container.querySelector("#telegram")).toBeNull();
      await waitFor(() => expect(scrolled).toContain("telegram"), WAIT);
    } finally {
      telegramStatusData.delayMs = 0;
    }
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
    expect(await findByText("Open the Windows assistant", undefined, WAIT)).toBeInTheDocument();
  });

  it.each(["darwin", "linux"])("does not show Open the Windows assistant on %s", async (platform) => {
    const { queryByText, findByText } = settings("/dashboard/settings", { platform });
    await findByText("Settings", undefined, WAIT);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(queryByText("Open the Windows assistant")).toBeNull();
  });
});

// #455: whether a rule the assistant is asked for is added at once or shown first.
describe("New rules in Settings", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the stored choice and changes the same setting the chat changes", async () => {
    const { container } = settings("/dashboard/settings", { new_rules: "ask-first" });
    const section = container.querySelector("#new-rules") as HTMLElement;
    const choice = (label: string) => [...section.querySelectorAll("label")].find(l => l.textContent === label)!.querySelector("input") as HTMLInputElement;
    await waitFor(() => expect(choice("Ask first").checked).toBe(true), WAIT);
    expect(choice("Add new rules automatically").checked).toBe(false);
    choice("Add new rules automatically").click();
    await waitFor(() => expect((fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url, init]) => url === "/api/identity/rules-setting" && init?.method === "POST" && init.body === JSON.stringify({ new_rules: "automatic" }))).toBe(true), WAIT);
  });
});

// Issue #919: where the server's operator switched Telegram off, the section says to ask them
// instead of naming the installer, which would not turn Telegram on there. Where the assistant
// does not run the notebook, #917's installer sentence stays.
describe("The Telegram section where Telegram cannot be connected", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); telegramStatusData.value = { available: false }; });

  it("says the operator switched Telegram off, and not the installer advice, when the status says so", async () => {
    telegramStatusData.value = { available: false, managed: null, connected: false, phase: "none", reason: "switched-off" };
    const { findByText, queryByText } = settings("/dashboard/settings");
    expect(await findByText(/switched Telegram off/, undefined, WAIT)).toBeInTheDocument();
    expect(queryByText("Telegram cannot be connected on this notebook.")).toBeNull();
  });

  it("keeps the installer advice where the assistant does not run the notebook", async () => {
    telegramStatusData.value = { available: false, managed: null, connected: false, phase: "none", reason: "no-assistant" };
    const { findByText } = settings("/dashboard/settings");
    expect(await findByText("Telegram cannot be connected on this notebook.", undefined, WAIT)).toBeInTheDocument();
  });
});

// #506: an assistant program that is not Hermes is named on the Routines line, after "not configured".
describe("The Routines line", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("says which setting the assistant needs", async () => {
    const problem = 'The assistant program set in /state/assistant.json is "/usr/bin/python3", which is not Hermes. Set "executable" in that file to your Hermes program (its name is hermes), or run the Godspeed installer again to set up the assistant. Until then the assistant cannot answer.';
    const { findByText } = settings("/dashboard/settings", { runtimeConfigured: false, assistantProblem: problem });
    expect((await findByText(/which is not Hermes/, undefined, WAIT)).textContent).toContain("not configured. " + problem + " Account access");
  });
});

describe("Run now in Routines", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("lists Remember what you said and starts it with Run now", async () => {
    const memory = { id: "memory-daily", kind: "memory-daily", title: "Remember what you said", owner: "local", paused: false, state: "pending", interval_ms: 86400000, calendar: { time: "03:40" }, next_run: "2030-01-02T02:40:00.000Z" };
    const { findByText, findByRole } = settings("/dashboard/settings", { schedules: [memory] });
    await findByText("Remember what you said", undefined, WAIT);
    fireEvent.click(await findByRole("button", { name: "Run Remember what you said now" }));
    await waitFor(() => {
      const call = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(([url]) => String(url).endsWith("/api/jobs/run"));
      expect(call).toBeTruthy();
      expect(call![1].method).toBe("POST");
      expect(JSON.parse(call![1].body)).toEqual({ id: "memory-daily" });
    }, WAIT);
  });

  it("offers Run now on Hermes only for rows Hermes can start", async () => {
    const row = (id: string, native?: boolean) => ({ id, kind: id, title: id, owner: "local", paused: false, state: "pending", next_run: "2030-01-02T02:40:00.000Z", ...(native ? { native } : {}) });
    const { findByText, queryByRole } = settings("/dashboard/settings", { routineSwitches: { note: "n", routines: [] }, schedules: [row("hermes-task", true), row("spend-guard")] });
    await findByText("hermes-task", undefined, WAIT);
    expect(queryByRole("button", { name: "Run hermes-task now" })).toBeTruthy();
    expect(queryByRole("button", { name: "Run spend-guard now" })).toBeNull();
  });
});
