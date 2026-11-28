// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { SidebarProvider } from "@/components/ui/sidebar";

// #1182: an add-on that answers `pages` gets its own entry; without one the menu is as it was.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "premium", signOut: async () => false }) }));
vi.mock("@/hooks/useProfileSummary", () => ({ useProfileSummary: () => ({ completeness: 50 }) }));
vi.mock("@/hooks/useReviewQueue", () => ({ useReviewQueueCount: () => 0 }));
vi.mock("@/components/settings/CreditsDisplay", () => ({ CreditsDisplay: () => null }));
vi.mock("@/components/subscription/PremiumBadge", () => ({ PremiumBadge: () => null }));

async function renderSidebar(addons: unknown[]) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }));
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ addons }) }));
  const { DashboardSidebar } = await import("./DashboardSidebar");
  render(<MemoryRouter initialEntries={["/dashboard"]}><SidebarProvider><DashboardSidebar /></SidebarProvider></MemoryRouter>);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("An add-on's menu entry", () => {
  it("shows the entry and its pages while the add-on has pages", async () => {
    await renderSidebar([{ id: "wingman", name: "the Wingman", pages: { title: "Dating", icon: "heart", pages: [{ id: "profile", title: "Profile" }, { id: "dates", title: "Dates" }] } }]);
    const entry = await screen.findByRole("link", { name: "Dating" });
    expect(entry).toHaveAttribute("href", "/dashboard/addons/wingman/profile");
    expect(screen.getByRole("link", { name: "Dates" })).toHaveAttribute("href", "/dashboard/addons/wingman/dates");
  });
  it("adds nothing for an add-on without pages", async () => {
    await renderSidebar([{ id: "video", name: "the video add-on" }, { id: "wingman", name: "the Wingman", pagesError: "No pages." }]);
    await waitFor(() => expect(screen.getByRole("link", { name: "Notes" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /video|Wingman|Dating/i })).toBeNull();
  });
});
