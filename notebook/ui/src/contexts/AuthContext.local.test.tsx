// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { AppRoutes } from "@/App";

// The pages behind the dashboard load lazily; the probe only reads where the routes land.
vi.mock("@/hooks/useUnsavedNotes", () => ({ KeepUnsavedNotes: () => null }));
vi.mock("@/components/chat/GlobalAIChatFAB", () => ({ GlobalAIChatFAB: () => null }));
vi.mock("@/components/layout/DashboardLayout", () => ({
  DashboardLayout: () => {
    const { pathname } = useLocation();
    return <p data-testid="address">{pathname}</p>;
  },
}));

// The plumbing that makes a notebook "local": the server answers /api/auth/status with
// local:true and refreshSession must carry that into the auth state everything else reads.
// Without the carry, a local notebook shows the server's sign-in screens again with every
// render gate green. The status read also decides what /setup may show, so this test covers
// the route's reconnect shell when the read fails.

vi.mock("@/local/file-chat", () => ({ hydrateFileChats: async () => {} }));
vi.mock("@/local/file-preferences", () => ({ hydrateFilePreferences: async () => {} }));

function Probe({ seen }: { seen: (value: ReturnType<typeof useAuth>) => void }) {
  seen(useAuth());
  return null;
}

const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("carries the server's local flag into the auth state", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/auth/status")) return answer({ signed_in: true, local: true, configured: false });
    if (url.includes("/api/session")) return answer({ user: { id: "owner" }, profile: { id: "owner", display_name: "Owner" } });
    return answer({});
  }));
  let latest: ReturnType<typeof useAuth> | undefined;
  render(<AuthProvider><Probe seen={(value) => { latest = value; }} /></AuthProvider>);
  await waitFor(() => expect(latest?.local).toBe(true));
  expect(latest?.user?.id).toBe("owner");
  expect(latest?.loading).toBe(false);
});

it("a stale setup link on a local notebook goes back to the dashboard, not to the server's screens", async () => {
  // The second status read is a tripwire: the /setup gate must navigate on the context's answer
  // before AuthScreen's own read runs, so a failing second read can never reach the invite screen.
  let statusReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/auth/status")) {
      if (++statusReads > 1) throw new TypeError("Failed to fetch");
      return answer({ signed_in: true, local: true, configured: false });
    }
    if (url.includes("/api/session")) return answer({ user: { id: "owner" }, profile: { display_name: "Owner" } });
    return answer({});
  }));
  render(<AuthProvider><MemoryRouter initialEntries={["/setup"]}><AppRoutes /></MemoryRouter></AuthProvider>);
  await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("/dashboard"));
  expect(screen.queryByText("Your first visit")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Setup code")).not.toBeInTheDocument();
});

it("a failed status read on /setup reconnects instead of showing the server's screens", async () => {
  // A local notebook's server always answers signed in, so a failing read means the server is
  // unreachable; the server's invite screen would ask for a setup code the person never had.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
  render(<AuthProvider><MemoryRouter initialEntries={["/setup"]}><AppRoutes /></MemoryRouter></AuthProvider>);
  await waitFor(() => expect(screen.getByText("Let’s reconnect")).toBeInTheDocument());
  expect(screen.queryByText("Your first visit")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Setup code")).not.toBeInTheDocument();
});
