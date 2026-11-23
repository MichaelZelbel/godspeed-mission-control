// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { DashboardSidebar } from "./DashboardSidebar";
import { Header } from "./Header";

// On a local notebook the server always answers signed in, so there is nothing to sign out of and
// no sign-in protects the notebook (#959): neither the sidebar nor the header menu may offer
// Sign Out, and the server's sign-in, invite or setup screens must never appear. On a server
// install Sign Out stays. This test renders the sidebar and the header both ways.

const auth = vi.hoisted(() => ({ state: {} as any }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth.state }));
vi.mock("@/hooks/useProfileSummary", () => ({ useProfileSummary: () => ({ completeness: 50 }) }));
vi.mock("@/hooks/useReviewQueue", () => ({ useReviewQueueCount: () => 0 }));
vi.mock("@/components/settings/CreditsDisplay", () => ({ CreditsDisplay: () => null }));
vi.mock("@/components/subscription/PremiumBadge", () => ({ PremiumBadge: () => null }));
// The header's menus, rendered inline so the Sign Out items are reachable without a browser.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const signedIn = (local: boolean) => {
  auth.state = {
    user: { id: "owner" },
    session: { user: { id: "owner" } },
    profile: null,
    role: "premium",
    signOut: async () => true,
    local,
  };
};

function renderSidebar() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <SidebarProvider>
        <DashboardSidebar />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

function renderHeader() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Header />
    </MemoryRouter>,
  );
}

describe("Sign Out on a local notebook and on a server install", () => {
  // jsdom has no matchMedia; the sidebar's phone mode asks for it.
  beforeEach(() => vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })));
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("offers no Sign Out in the sidebar on a local notebook", () => {
    signedIn(true);
    renderSidebar();
    expect(screen.queryByRole("button", { name: "Sign Out" })).not.toBeInTheDocument();
  });

  it("keeps Sign Out in the sidebar on a server install", () => {
    signedIn(false);
    renderSidebar();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
  });

  it("offers no Sign Out in the header menu on a local notebook", () => {
    signedIn(true);
    renderHeader();
    expect(screen.queryByRole("button", { name: "Sign Out" })).not.toBeInTheDocument();
    // The phone menu holds the same choice.
    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    expect(screen.queryByRole("button", { name: "Sign Out" })).not.toBeInTheDocument();
  });

  it("keeps Sign Out in the header menu on a server install", () => {
    signedIn(false);
    renderHeader();
    expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle menu" }));
    expect(screen.getAllByRole("button", { name: "Sign Out" }).length).toBeGreaterThanOrEqual(1);
  });
});
