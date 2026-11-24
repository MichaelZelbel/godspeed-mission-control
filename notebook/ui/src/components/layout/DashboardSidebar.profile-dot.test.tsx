// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { SidebarProvider } from "@/components/ui/sidebar";

// Issue #975: the coloured dot beside My Profile had no words, so on a fresh notebook it read as an error.

let completeness = 20;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "premium", signOut: async () => false }) }));
vi.mock("@/hooks/useProfileSummary", () => ({ useProfileSummary: () => ({ completeness }) }));
vi.mock("@/hooks/useReviewQueue", () => ({ useReviewQueueCount: () => 0 }));
vi.mock("@/components/settings/CreditsDisplay", () => ({ CreditsDisplay: () => null }));
vi.mock("@/components/subscription/PremiumBadge", () => ({ PremiumBadge: () => null }));

async function renderSidebar() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }));
  const { DashboardSidebar } = await import("./DashboardSidebar");
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <SidebarProvider><DashboardSidebar /></SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("The My Profile dot", () => {
  it.each([0, 20, 50, 100])("says the real completeness at %i%% and is never red", async (value) => {
    completeness = value;
    await renderSidebar();
    const dot = screen.getByRole("img", { name: `Profile ${value}% complete` });
    expect(dot).toHaveAttribute("title", `Profile ${value}% complete`);
    expect(dot.className).not.toMatch(/red|destructive/);
  });

  it("uses a blue dot for an empty profile", async () => {
    completeness = 20;
    await renderSidebar();
    expect(screen.getByRole("img", { name: "Profile 20% complete" })).toHaveClass("bg-blue-400");
  });

  it("follows the figure", async () => {
    completeness = 80;
    await renderSidebar();
    expect(screen.getByRole("img", { name: "Profile 80% complete" })).toHaveClass("bg-green-500");
  });
});
