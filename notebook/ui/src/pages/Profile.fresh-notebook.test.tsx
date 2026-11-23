// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";
import { WAIT } from "@/test/wait-limits";

// My Profile on a fresh notebook (#865): the display-name read asked for the
// owner's profiles record as exactly one record, and the notebook refused it
// with "Expected one record" while no profile row exists yet. The page runs
// against a real notebook with an empty workspace — the fresh-notebook
// condition — and every request it sends is judged by the answers the notebook
// really gives: the display name is read as an optional single record and
// answered, and no request on the page is refused.
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("sonner", () => {
  const quiet = () => vi.fn(() => 0);
  return { toast: Object.assign(quiet(), { success: quiet(), error: quiet(), info: quiet(), warning: quiet(), loading: quiet(), dismiss: vi.fn() }) };
});

Object.defineProperty(window, "matchMedia", { writable: true, value: (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false }) });
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
Element.prototype.scrollIntoView ??= () => {};

const answered: Array<{ body: any; status: number }> = [];
let notebook: RealNotebook;
let Profile: (props: Record<string, unknown>) => React.ReactElement | null;

beforeAll(async () => {
  notebook = await startNotebook();
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await notebook.fetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("/api/query")) answered.push({ body: JSON.parse(String(init?.body)), status: response.status });
    return response;
  }) as typeof fetch);
  ({ default: Profile } = await import("./Profile"));
}, 120_000);
afterAll(async () => { await notebook?.stop(); });
afterEach(() => { cleanup(); answered.length = 0; });

describe("My Profile on a fresh notebook", () => {
  it("opens with no refused request and reads the display name as an optional single record", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><Profile /></MemoryRouter>
      </QueryClientProvider>,
    );
    // Seeded defaults land first on a fresh workspace; the page then shows its
    // cards, among them the relationships card whose display-name read failed.
    expect(await screen.findByText("No relationships yet. Add one.", undefined, WAIT)).toBeInTheDocument();
    const profiles = answered.find((r) => r.body.table === "profiles");
    expect(profiles?.status).toBe(200);
    expect(profiles?.body).toMatchObject({ table: "profiles", maybeSingle: true });
    expect(answered.filter((r) => r.status >= 400)).toEqual([]);
  }, 30_000);

  // Issue #1019: the defaults were seeded but none was listed, so there was nowhere to add a first fact.
  it("lists the default categories, each with a way to add a first fact", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><Profile /></MemoryRouter>
      </QueryClientProvider>,
    );
    const empty = await screen.findAllByText("No facts yet. Add one.", undefined, WAIT);
    expect(empty.length).toBeGreaterThanOrEqual(10);
    fireEvent.click(within(empty[0].parentElement as HTMLElement).getByRole("button", { name: /Add/ }));
    expect(await screen.findByRole("textbox", { name: "Value" }, WAIT)).toBeInTheDocument();
  }, 30_000);
});
