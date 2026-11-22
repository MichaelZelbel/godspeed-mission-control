// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { GlobalAIChatFAB } from "./GlobalAIChatFAB";
import { WAIT } from "@/test/wait-limits";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" }, session: { user: { id: "owner" } } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("./ChatMarkdown", () => ({ default: ({ children }: any) => <p>{children}</p> }));
vi.mock("./ChatComposer", () => ({ default: () => <textarea aria-label="Message" /> }));
Object.defineProperty(window, "matchMedia", { writable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it.each([
  ["words", "A long note title with many normal words ".repeat(5).trim()],
  ["unbroken", "x".repeat(120)],
])("shows a whole long note title (%s) in the chat header, not cut to one line", async (_k, title) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/dashboard/chat?note=n1"]}><GlobalAIChatFAB page noteTitle={title} /></MemoryRouter>
    </QueryClientProvider>,
  );
  const heading = await screen.findByText("Godspeed / " + title, undefined, WAIT);
  expect(heading.className).not.toMatch(/\btruncate\b|whitespace-nowrap|text-ellipsis/);
  expect(heading.className).toContain("overflow-wrap:anywhere");
  // the title block is capped and scrolls inside itself, so the composer stays in the panel
  const box = screen.getByTestId("chat-header-title");
  expect(box.className).toContain("max-h-16");
  expect(box.className).toContain("sm:max-h-none"); // no cap from 640px up
  expect(box.className).toContain("overflow-y-auto");
});
