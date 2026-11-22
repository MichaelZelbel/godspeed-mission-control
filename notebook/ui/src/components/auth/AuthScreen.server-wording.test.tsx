// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://notebook.example.com/"}
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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function open(address: string, fetcher: (url: string) => Promise<Response> | Response) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => fetcher(url)));
  render(<MemoryRouter initialEntries={[address]}><AuthProvider><AppRoutes /></AuthProvider></MemoryRouter>);
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// #991: a server notebook keeps its server wording.
describe("a server notebook, when it does not answer", () => {
  it("keeps the server wording on the setup link", async () => {
    open("/setup", () => { throw new TypeError("Failed to fetch"); });
    await screen.findByText("Cannot reach your server. Check your connection and try again.");
    expect(screen.getByText("Your server: notebook.example.com")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Setup code");
  });

  it("keeps the server wording on the dashboard path", async () => {
    open("/dashboard", () => json({ error: "boom" }, 500));
    await screen.findByText("Your server is unavailable. Try again shortly.");
    expect(screen.getByRole("heading", { name: "Let’s reconnect" })).toBeInTheDocument();
    expect(screen.getByText("Your server: notebook.example.com")).toBeInTheDocument();
  });
});
