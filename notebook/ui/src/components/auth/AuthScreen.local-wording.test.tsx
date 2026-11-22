// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";

vi.mock("@/local/file-chat", () => ({ hydrateFileChats: async () => {} }));
vi.mock("@/local/file-preferences", () => ({ hydrateFilePreferences: async () => {} }));
vi.mock("@/hooks/useUnsavedNotes", () => ({ KeepUnsavedNotes: () => null }));
vi.mock("@/components/chat/GlobalAIChatFAB", () => ({ GlobalAIChatFAB: () => null }));
vi.mock("@/components/layout/DashboardLayout", () => ({ DashboardLayout: () => <p>Dashboard</p> }));
import { AuthProvider } from "@/contexts/AuthContext";
import { AppRoutes } from "@/App";
import { WAIT } from "@/test/wait-limits";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function open(address: string, fetcher: (url: string) => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => fetcher(url)));
  render(<MemoryRouter initialEntries={[address]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// #991: a notebook on this computer has no server, so its loading and reconnect screens never say so.
const aborted = () => { throw new TypeError("Failed to fetch"); };

describe("a notebook on this computer, when it does not answer", () => {
  it("never says server on the setup link, and offers Try again", async () => {
    open("/setup", aborted);
    expect(document.body.textContent).not.toMatch(/server/i);
    await screen.findByRole("heading", { name: "Let’s reconnect" }, WAIT);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/server/i);
    expect(document.body.textContent).toContain("notebook");
    expect(screen.queryByText("Setup code")).toBeNull();
  });

  it.each([["a JSON error", () => json({ error: "boom" }, 500)], ["a plain text body", () => new Response("oops", { status: 500 })]])("never says server when it answers 500 with %s", async (_n, answer) => {
    open("/setup", answer);
    await screen.findByRole("heading", { name: "Let’s reconnect" }, WAIT);
    expect(document.body.textContent).not.toMatch(/server/i);
    expect(document.body.textContent).toContain("notebook");
  });

  it("never says server on the dashboard path", async () => {
    open("/dashboard", aborted);
    await screen.findByRole("heading", { name: "Let’s reconnect" }, WAIT);
    expect(document.body.textContent).not.toMatch(/server/i);
  });

  it("Try again leads to the dashboard once it answers", async () => {
    let up = false;
    open("/setup", (url) => {
      if (!up) return aborted();
      return url.includes("/api/session") ? json({ user: { id: "owner" }, profile: {} }) : json({ configured: true, local: true, signed_in: true });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }, WAIT));
    up = true;
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }, WAIT));
    await waitFor(() => expect(screen.getByText("Dashboard")).toBeInTheDocument(), WAIT);
  });
});
