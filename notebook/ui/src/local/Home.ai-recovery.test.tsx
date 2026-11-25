// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { WAIT } from "@/test/wait-limits";
import { retryDelay } from "./chat-options.mjs";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" }, session: { user: { id: "owner" } } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: async () => ({ data: {}, error: null }) }, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }), maybeSingle: async () => ({ data: null }) }) }) }) } }));
vi.mock("@/hooks/useNotes", () => ({ useNotes: () => ({ isLoading: false, isError: false, data: [] }) }));
vi.mock("@/components/dashboard/widgets/RecentNotesCard", () => ({ RecentNotesCard: () => null }));
vi.mock("@/components/dashboard/widgets/RecentPeopleCard", () => ({ RecentPeopleCard: () => null }));
vi.mock("@/components/dashboard/widgets/ProfileWidget", () => ({ ProfileWidget: () => null }));
vi.mock("@/components/activity/ActivityFeed", () => ({ ActivityFeed: () => null }));
vi.mock("@/components/notes/CaptureEmptyState", () => ({ CaptureEmptyState: () => null }));
Object.defineProperty(window, "matchMedia", { writable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }) });
Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

// A stand-in for the server: it answers from the state its last check left, and only a ?check=1
// read looks at whether the runtime is up.
function runtime(known: "ready" | "unreachable", runtimeUp: boolean) {
  const state = { known, runtimeUp, checks: 0, plain: 0 };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    let body: unknown = { runtimeConfigured: true, show: false, count: 0, data: [] };
    if (u.startsWith("/api/chat/options")) {
      if (u.includes("check=1")) { state.checks++; state.known = state.runtimeUp ? "ready" : "unreachable"; } else state.plain++;
      body = { connected: true, usable: state.known === "ready", availability: state.known };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return state;
}
// A reload starts the page's module state again; an in-app return keeps it.
async function load(reload: boolean) {
  cleanup();
  if (reload) vi.resetModules();
  const { default: Home } = await import("./Home");
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={["/dashboard"]}><Home /></MemoryRouter></QueryClientProvider>);
}
const idle = (ms: number) => new Promise(r => setTimeout(r, ms));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the Home AI card after the assistant recovers (#918)", () => {
  it("turns ready on a reload, and nothing checks while idle", async () => {
    const rt = runtime("unreachable", false);
    await load(true);
    expect(await screen.findByText("Your AI could not be reached", undefined, WAIT)).toBeInTheDocument();
    expect(rt.checks).toBe(1);
    rt.runtimeUp = true;
    await idle(2500);
    expect(screen.getByText("Your AI could not be reached")).toBeInTheDocument();
    expect(rt.checks).toBe(1);
    await load(true);
    expect(await screen.findByText("Ready to chat", undefined, WAIT)).toBeInTheDocument();
    expect(rt.checks).toBe(2);
  });

  it("turns ready on Check again without a reload", async () => {
    const rt = runtime("unreachable", false);
    await load(true);
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }, WAIT));
    expect(await screen.findByText("Checked again just now. It still could not be reached.", undefined, WAIT)).toBeInTheDocument();
    expect(rt.checks).toBe(2);
    rt.runtimeUp = true;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Ready to chat", undefined, WAIT)).toBeInTheDocument();
    expect(rt.checks).toBe(3);
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("sends no check from an idle Dashboard that is ready", async () => {
    const rt = runtime("ready", true);
    await load(true);
    expect(await screen.findByText("Ready to chat", undefined, WAIT)).toBeInTheDocument();
    await idle(3000);
    expect(rt.checks).toBe(0);
    expect(rt.plain).toBeGreaterThanOrEqual(2);
  });

  it("does not check again when the person returns to the Dashboard in the app", async () => {
    const rt = runtime("unreachable", false);
    await load(true);
    expect(await screen.findByText("Your AI could not be reached", undefined, WAIT)).toBeInTheDocument();
    expect(rt.checks).toBe(1);
    await load(false);
    expect(await screen.findByText("Your AI could not be reached", undefined, WAIT)).toBeInTheDocument();
    await idle(1500);
    expect(rt.checks).toBe(1);
  });
});

// #1053: the page-load check keeps the last known text, as Check again does.
describe("the Home AI card during the page-load check (#1053)", () => {
  it("keeps 'could not be reached' with a disabled Checking button after a reload, then shows the result", async () => {
    sessionStorage.clear();
    runtime("unreachable", false);
    await load(true);
    expect(await screen.findByRole("button", { name: "Check again" }, WAIT)).toBeEnabled();
    // Reload: the check is held open.
    let release: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      const u = String(url);
      if (u.startsWith("/api/chat/options")) {
        const body = (a: string) => new Response(JSON.stringify({ connected: true, usable: a === "ready", availability: a }), { status: 200, headers: { "Content-Type": "application/json" } });
        if (u.includes("check=1")) return new Promise<Response>(r => { release = r; });
        return Promise.resolve(body("unreachable"));
      }
      return Promise.resolve(new Response(JSON.stringify({ runtimeConfigured: true, show: false, count: 0, data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }));
    await load(true);
    expect(screen.getByText("Your AI could not be reached")).toBeInTheDocument();
    expect(screen.getByText("Check its connection in Settings, Your AI.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    await idle(300);
    expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
    expect(screen.queryByText("Connecting…")).toBeNull();
    expect(screen.queryByText("Your AI is not answering")).toBeNull();
    release(new Response(JSON.stringify({ connected: true, usable: true, availability: "ready" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await screen.findByText("Ready to chat", undefined, WAIT)).toBeInTheDocument();
  });
});

describe("a model list that cannot load (#1124)", () => {
  it("is asked at most four times in 30 seconds, and the Home card says what is wrong", async () => {
    let asked = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/chat/options")) { asked++; return new Response(JSON.stringify({ error: "Model choices could not be loaded" }), { status: 500, headers: { "Content-Type": "application/json" } }); }
      return new Response(JSON.stringify({ runtimeConfigured: true, aiAvailability: "ready", show: false, count: 0, data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    await load(true);
    expect(await screen.findByText("The list of AI models could not be loaded.", undefined, WAIT)).toBeInTheDocument();
    expect(screen.queryByText("AI unavailable")).toBeNull();
    await idle(30000);
    expect(asked).toBeLessThanOrEqual(4);
  }, 40000);
});

describe("the pace of a failing model list (#1124)", () => {
  it("waits 5 s, 15 s, 60 s, then a minute after every further failure", () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([5000, 15000, 60000, 60000, 60000, 60000]);
  });
});
