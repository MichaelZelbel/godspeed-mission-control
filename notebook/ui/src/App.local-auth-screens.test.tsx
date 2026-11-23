// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { AppRoutes } from "./App";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { WAIT } from "@/test/wait-limits";

// The two guards that keep a local notebook off the server's sign-in, invite and setup screens:
// the route into the signed-out screens (Layout) and the setup link's own redirect. A local
// notebook's server always answers signed in, so these guards look like dead code once Sign Out
// is hidden — this test pins them so a cleanup cannot restore the lockout screen (#959).

const mock = vi.hoisted(() => ({ auth: {} as any, status: {} as any }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mock.auth,
  authRequest: async () => mock.status,
}));

afterEach(cleanup);

it("a local notebook whose signed-in state is lost reconnects instead of showing the server's screens", () => {
  mock.auth = { user: null, loading: false, local: true, authError: "", refreshSession: async () => {} };
  render(<MemoryRouter initialEntries={["/"]}><AppRoutes /></MemoryRouter>);
  expect(screen.getByText("Reconnecting to your notebook")).toBeInTheDocument();
  expect(screen.queryByLabelText("Setup code")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
});

it("a direct visit to a setup link on a local notebook goes to the dashboard", async () => {
  mock.auth = { user: null, loading: false, local: false, expired: false, authError: "", signIn: async () => {}, refreshSession: async () => {} };
  mock.status = { local: true, configured: false };
  render(
    <MemoryRouter initialEntries={["/setup"]}>
      <Routes>
        <Route path="/setup" element={<AuthScreen />} />
        <Route path="/dashboard" element={<p>Dashboard</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText("Dashboard")).toBeInTheDocument(), WAIT);
  expect(screen.queryByText("Your first visit")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Setup code")).not.toBeInTheDocument();
});

it("a setup link whose status read failed shows the reconnect screen, never the invite screen", () => {
  mock.auth = { user: null, loading: false, local: false, authError: "Could not reach the server", refreshSession: async () => {} };
  render(<MemoryRouter initialEntries={["/setup"]}><AppRoutes /></MemoryRouter>);
  expect(screen.getByText("Let’s reconnect")).toBeInTheDocument();
  expect(screen.queryByText("Your first visit")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Setup code")).not.toBeInTheDocument();
});

it("a setup link on a local notebook (known from the auth state) goes to the dashboard", async () => {
  mock.auth = { user: null, loading: false, local: true, authError: "", refreshSession: async () => {} };
  render(<MemoryRouter initialEntries={["/setup"]}><AppRoutes /></MemoryRouter>);
  expect(screen.queryByLabelText("Setup code")).not.toBeInTheDocument();
  expect(screen.queryByText("Your first visit")).not.toBeInTheDocument();
});
