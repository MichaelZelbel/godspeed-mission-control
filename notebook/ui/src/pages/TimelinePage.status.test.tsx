// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import TimelinePage from "./TimelinePage";

// A contact record with no name, as the notebook's files and store allow.
const contacts: any[] = [];
const base = { happened_end: null, description: null, source: "godspeed due done", verified: false, is_potential_major: false };
const moments = [
  { ...base, id: "m-elsewhere", title: "From elsewhere", happened_at: "2026-10-20", status: "confirmed", impact_level: 2, confidence_truth: 5, confidence_date: 5 },
  { ...base, id: "m-due", title: "Done: See the dentist", happened_at: "2026-10-30", status: "past_fact", impact_level: 1, confidence_truth: 10, confidence_date: 10 },
];
const { inserts } = vi.hoisted(() => ({ inserts: [] as { table: string; values: any }[] }));

vi.mock("@/integrations/supabase/client", () => {
  // Every query-builder call returns the same chain; awaiting it answers for its table.
  const from = (table: string) => {
    let result: any = { data: table === "contacts" ? contacts : table === "moments" ? moments : [], error: null };
    const chain: any = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
        if (prop === "insert") return (values: any) => { inserts.push({ table, values }); result = { data: table === "moments" ? { id: "m-new" } : null, error: null }; return chain; };
        return () => chain;
      },
    });
    return chain;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) } } };
});
// One object every call: a fresh user each render would reload the page forever.
const { auth } = vi.hoisted(() => ({ auth: { user: { id: "owner" }, session: { access_token: "t", user: { id: "owner" } } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/hooks/useAICreditsGate", () => ({ useAICreditsGate: () => ({ checkCredits: () => true }) }));

// jsdom lacks what Radix and cmdk measure with.
class NoResize { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoResize as any;
Element.prototype.scrollIntoView ??= () => {};

describe("the timeline's status and scores", () => {
  afterEach(() => cleanup());
  it("shows a status it does not know as unknown, and a corrected due moment's three numbers", async () => {
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);
    expect(await screen.findByText("From elsewhere")).toBeInTheDocument();
    expect(screen.queryByText("confirmed")).toBeNull();
    expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
    expect(screen.getByText("past fact", { selector: "div" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Done: See the dentist"));
    expect(await screen.findByText("1/4")).toBeInTheDocument();
    expect(screen.getAllByText("10/10")).toHaveLength(2);
  });
});
