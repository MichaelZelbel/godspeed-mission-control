// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import Home from "./Home";
import { GlobalAIChatFAB, openFloatingChat, OPEN_CHAT_EVENT } from "@/components/chat/GlobalAIChatFAB";

// The dashboard says at a glance that Godspeed can be talked to here: one big "Chat with
// Godspeed" button near the top, opening the same floating chat as the round button (16 October
// 2026; it was a small link in the third card).
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" }, session: { user: { id: "owner" } } }) }));
const invoke = vi.fn(async () => ({ data: { reply: "Great, about five minutes." }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...args: unknown[]) => invoke(...(args as [])) }, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }), maybeSingle: async () => ({ data: null }) }) }) }) } }));
vi.mock("@/hooks/useNotes", () => ({ useNotes: () => ({ isLoading: false, isError: false, data: [] }) }));
vi.mock("@/components/dashboard/widgets/RecentNotesCard", () => ({ RecentNotesCard: () => null }));
vi.mock("@/components/dashboard/widgets/RecentPeopleCard", () => ({ RecentPeopleCard: () => null }));
vi.mock("@/components/dashboard/widgets/ProfileWidget", () => ({ ProfileWidget: () => null }));
vi.mock("@/components/activity/ActivityFeed", () => ({ ActivityFeed: () => null }));
vi.mock("@/components/notes/CaptureEmptyState", () => ({ CaptureEmptyState: () => null }));
Object.defineProperty(window, "matchMedia", { writable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }) });
Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

function page(withChat: boolean, context: { show: boolean; state?: string | null } = { show: false }) {
  const posts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url) === "/api/context-setup") {
      if (init?.method === "POST") { posts.push(JSON.parse(String(init.body))); context = { show: false, state: "skipped" }; }
      return new Response(JSON.stringify(context), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ runtimeConfigured: true, count: 0, data: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<><Home />{withChat && <GlobalAIChatFAB />}</>} />
        <Route path="/dashboard/chat" element={<p>The chat page</p>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
  return posts;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("the dashboard's chat button", () => {
  it("is a button near the top that opens the floating chat", async () => {
    page(true);
    const big = screen.getByRole("heading", { name: "Your notebook" }).parentElement!.parentElement!.querySelector("button")!;
    expect(big).toHaveTextContent("Chat with Godspeed");
    expect(screen.queryByPlaceholderText("Ask Godspeed...")).toBeNull();
    fireEvent.click(big);
    expect(await screen.findByPlaceholderText("Ask Godspeed...")).toBeInTheDocument();
    expect(screen.queryByText("The chat page")).toBeNull();
  });
  it("shows no getting-to-know-you card once that chat ended", async () => {
    page(false, { show: false, state: "done" });
    await screen.findByRole("button", { name: "Chat with Godspeed" });
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByText("Tell Godspeed about you, about five minutes")).toBeNull();
  });
  it("shows the getting-to-know-you card, whose button starts that chat with the word context", async () => {
    page(true, { show: true, state: "invited" });
    expect(await screen.findByText("Tell Godspeed about you, about five minutes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start now" }));
    expect(await screen.findByPlaceholderText("Ask Godspeed...")).toBeInTheDocument();
    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect((invoke.mock.calls.at(-1) as any)[1].body.message).toBe("context");
  });
  it("hides the card for good with Hide", async () => {
    const posts = page(false, { show: true, state: "waiting" });
    fireEvent.click(await screen.findByRole("button", { name: "Hide" }));
    await waitFor(() => expect(screen.queryByText("Tell Godspeed about you, about five minutes")).toBeNull());
    expect(posts).toEqual([{ action: "skip" }]);
  });
  it("hands the word to the floating chat, or says nobody took it", () => {
    const seen: unknown[] = [];const take = (e: Event) => { seen.push((e as CustomEvent).detail?.message); e.preventDefault(); };
    window.addEventListener(OPEN_CHAT_EVENT, take);
    expect(openFloatingChat("context")).toBe(true);
    window.removeEventListener(OPEN_CHAT_EVENT, take);
    expect(seen).toEqual(["context"]);
  });
  it("goes to the chat page where no floating chat is on the page", async () => {
    page(false);
    expect(openFloatingChat()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Godspeed" }));
    expect(await screen.findByText("The chat page")).toBeInTheDocument();
  });
});
