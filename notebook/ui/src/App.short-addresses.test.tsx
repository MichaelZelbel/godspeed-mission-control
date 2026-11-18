// @vitest-environment jsdom
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
import "@testing-library/jest-dom/vitest";

// Every page in the sidebar also opens from its short address (#736): /timeline goes to
// /dashboard/timeline, keeping the rest of the path, the query and the # section. An address the
// notebook does not know still says the page is unavailable, with a way back to the Dashboard.
// The test reads where the notebook's own routes (AppRoutes) take each address; the pages
// themselves are not opened, only the address they land on.
vi.mock("@/contexts/AuthContext", () => ({ AuthProvider: ({ children }: { children: unknown }) => children, useAuth: () => ({ user: { id: "owner" }, loading: false }) }));
vi.mock("@/hooks/useUnsavedNotes", () => ({ KeepUnsavedNotes: () => null }));
vi.mock("@/components/chat/GlobalAIChatFAB", () => ({ GlobalAIChatFAB: () => null }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: () => {
    const { pathname, search, hash } = useLocation();
    // The pages load later (lazily), so only redirects and the unavailable message draw here.
    return <><p data-testid="address">{pathname + search + hash}</p><Suspense fallback={null}><Outlet /></Suspense></>;
  },
}));
import { AppRoutes, SHORT_ADDRESSES } from "./App";

afterEach(cleanup);

function open(address: string) {
  render(<MemoryRouter initialEntries={[address]}><AppRoutes /></MemoryRouter>);
  return screen.getByTestId("address").textContent;
}

// The pages the sidebar links to under /dashboard, as the sidebar names them.
const SIDEBAR = ["notes", "graph", "people", "world", "groups", "timeline", "media", "review-queue", "review", "goals", "profile", "brain", "activity"];

describe("short addresses", () => {
  it("covers every sidebar page", () => {
    for (const name of SIDEBAR) expect(SHORT_ADDRESSES).toContain(name);
  });

  for (const name of SHORT_ADDRESSES.filter((name) => !["settings", "identity"].includes(name))) {
    it(`/${name} opens /dashboard/${name}`, () => {
      expect(open(`/${name}`)).toBe(`/dashboard/${name}`);
    });
  }

  it("keeps the rest of the path, the query and the # section", () => {
    expect(open("/people/abc?tab=notes#facts")).toBe("/dashboard/people/abc?tab=notes#facts");
    cleanup();
    expect(open("/notes/123?q=milk")).toBe("/dashboard/notes/123?q=milk");
    cleanup();
    expect(open("/goals?week=2")).toBe("/dashboard/goals?week=2");
  });

  it("takes the brain page's old short address to the brain page", () => {
    expect(open("/identity#rules")).toBe("/dashboard/brain#rules");
  });

  it("still opens Settings, Collections and the Dashboard where they were", () => {
    expect(open("/settings")).toBe("/settings");
    cleanup();
    expect(open("/settings/import")).toBe("/dashboard/settings/import");
    cleanup();
    expect(open("/collections")).toBe("/collections");
    cleanup();
    expect(open("/")).toBe("/dashboard");
  });

  for (const address of ["/no-such-page", "/timelines", "/dashboard/no-such-page"]) {
    it(`${address} says the page is unavailable, with a link to the Dashboard`, async () => {
      expect(open(address)).toBe(address);
      expect(screen.getByText("This page is unavailable.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Go to the Dashboard" })).toHaveAttribute("href", "/dashboard");
    });
  }
});
