// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { PhoneHealth } from "./PhoneHealth";

// Health data from your phone (issue #214): a server install shows the address with its token and a
// button for a new one; a Windows or Mac notebook shows one line. Every token is made up.
function serve(routes: Record<string, () => unknown>) {
  const calls: { route: string; method?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const route = String(url).replace(/^\/api\//, "");
    calls.push({ route, method: init?.method });
    return new Response(JSON.stringify(routes[route]()), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}
const show = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><PhoneHealth /></QueryClientProvider>);

describe("Health data from your phone in Settings", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the address with its token and makes a new one after a confirmation", async () => {
    const calls = serve({
      "phone-health": () => ({ available: true, address: "https://notes.example.test/ingest/madeUpTokenOne" }),
      "phone-health/renew": () => ({ available: true, address: "https://notes.example.test/ingest/madeUpTokenTwo" }),
    });
    vi.stubGlobal("confirm", vi.fn(() => true));
    show();
    expect(await screen.findByLabelText("Address for Health Auto Export")).toHaveValue("https://notes.example.test/ingest/madeUpTokenOne");
    fireEvent.click(screen.getByRole("button", { name: "Make a new address" }));
    await waitFor(() => expect(screen.getByLabelText("Address for Health Auto Export")).toHaveValue("https://notes.example.test/ingest/madeUpTokenTwo"));
    expect(calls.filter(c => c.route === "phone-health/renew")).toEqual([{ route: "phone-health/renew", method: "POST" }]);
    expect(calls.find(c => c.route === "phone-health")?.method).toBe("GET");
  });

  it("keeps the old address when the new one is not confirmed", async () => {
    const calls = serve({ "phone-health": () => ({ available: true, address: "https://notes.example.test/ingest/madeUpTokenOne" }), "phone-health/renew": () => ({}) });
    vi.stubGlobal("confirm", vi.fn(() => false));
    show();
    expect(await screen.findByLabelText("Address for Health Auto Export")).toHaveValue("https://notes.example.test/ingest/madeUpTokenOne");
    fireEvent.click(screen.getByRole("button", { name: "Make a new address" }));
    expect(calls.some(c => c.route === "phone-health/renew")).toBe(false);
  });

  it("shows no address and no button when the server has no https address", async () => {
    serve({ "phone-health": () => ({ available: true, address: null }) });
    show();
    expect(await screen.findByText(/only for this server's https web address/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Address for Health Auto Export")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the error when the first status request fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "The notebook could not read its health setup" }), { status: 500, headers: { "Content-Type": "application/json" } })));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("The notebook could not read its health setup");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("offers a new address when the server says its key file is damaged", async () => {
    const calls = serve({ "phone-health": () => ({ available: true, address: null, damaged: true }), "phone-health/renew": () => ({ available: true, address: "https://notes.example.test/ingest/madeUpTokenTwo" }) });
    vi.stubGlobal("confirm", vi.fn(() => true));
    show();
    expect(await screen.findByText(/uploads from your phone are switched off/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Make a new address" }));
    await waitFor(() => expect(screen.getByLabelText("Address for Health Auto Export")).toHaveValue("https://notes.example.test/ingest/madeUpTokenTwo"));
    expect(calls.filter(c => c.route === "phone-health/renew")).toEqual([{ route: "phone-health/renew", method: "POST" }]);
  });

  it("says on Windows that the phone needs the server install, with no button", async () => {
    serve({ "phone-health": () => ({ available: false }) });
    show();
    expect(await screen.findByText(/needs the server install of Godspeed Mission Control/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
