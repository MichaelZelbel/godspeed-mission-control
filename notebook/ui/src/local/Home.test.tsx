// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import Home from "./Home";
import { GlobalAIChatFAB, openFloatingChat } from "@/components/chat/GlobalAIChatFAB";

// The dashboard says at a glance that Godspeed can be talked to here: one big "Chat with
// Godspeed" button near the top, opening the same floating chat as the round button (16 October
// 2026; it was a small link in the third card).
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" }, session: { user: { id: "owner" } } }) }));
vi.mock("@/hooks/useNotes", () => ({ useNotes: () => ({ isLoading: false, isError: false, data: [] }) }));
vi.mock("@/components/dashboard/widgets/RecentNotesCard", () => ({ RecentNotesCard: () => null }));
vi.mock("@/components/dashboard/widgets/RecentPeopleCard", () => ({ RecentPeopleCard: () => null }));
vi.mock("@/components/dashboard/widgets/ProfileWidget", () => ({ ProfileWidget: () => null }));
vi.mock("@/components/activity/ActivityFeed", () => ({ ActivityFeed: () => null }));
vi.mock("@/components/notes/CaptureEmptyState", () => ({ CaptureEmptyState: () => null }));
Object.defineProperty(window, "matchMedia", { writable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }) });
Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;

function page(withChat: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ runtimeConfigured: true, count: 0, data: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route path="/dashboard" element={<><Home />{withChat && <GlobalAIChatFAB />}</>} />
        <Route path="/dashboard/chat" element={<p>The chat page</p>} />
      </Routes>
    </MemoryRouter>
  </QueryClientProvider>);
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
  it("goes to the chat page where no floating chat is on the page", async () => {
    page(false);
    expect(openFloatingChat()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Chat with Godspeed" }));
    expect(await screen.findByText("The chat page")).toBeInTheDocument();
  });
});
