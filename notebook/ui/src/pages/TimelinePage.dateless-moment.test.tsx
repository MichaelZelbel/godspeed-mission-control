// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import TimelinePage from "./TimelinePage";
import { WAIT } from "@/test/wait-limits";

// A moment can reach the notebook without happened_at (an assistant or an
// import writes only moment_date) and without impact, confidence or source.
// On main the whole page crashed on the dateless one and the sparse one's
// drawer showed blank tiles ("/4", "/10", "Source: ").
const base = { happened_end: null, description: null, verified: false, is_potential_major: false };
const moments = [
  { ...base, id: "m-normal", title: "A normal moment", happened_at: "2026-03-10", status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5, source: "manual" },
  { ...base, id: "m-dateless", title: "Written without a date", happened_at: null, moment_date: "2026-03-14", status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5, source: "manual" },
  { ...base, id: "m-sparse", title: "Saved without scores", happened_at: "2026-01-05", status: "unknown", impact_level: null, confidence_truth: null, confidence_date: null, source: null },
  { ...base, id: "m-undated", title: "No day at all", happened_at: null, status: "unknown", impact_level: 1, confidence_truth: 0, confidence_date: 0, source: "manual" },
];

vi.mock("@/integrations/supabase/client", () => {
  // Every query-builder call returns the same chain; awaiting it answers for its table.
  const from = (table: string) => {
    const result: any = { data: table === "moments" ? moments : [], error: null };
    const chain: any = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
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

describe("the timeline with a dateless and a sparse moment", () => {
  afterEach(() => cleanup());

  it("loads the page, shows the dateless moment under Undated, and opens it without crashing", async () => {
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);
    expect(await screen.findByText("A normal moment", undefined, WAIT)).toBeInTheDocument();
    // With a moment_date the dateless moment still shows, in the year it names.
    expect(screen.getByText("Written without a date")).toBeInTheDocument();
    expect(screen.getByText("Mar 14, 2026")).toBeInTheDocument();
    // Without any day it stays reachable under Undated.
    expect(screen.getByText("Undated")).toBeInTheDocument();
    expect(screen.getByText("No day at all")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Written without a date"));
    // The drawer names the same day in full: it did not crash.
    expect(await screen.findByText("March 14, 2026", undefined, WAIT)).toBeInTheDocument();

    fireEvent.click(screen.getByText("No day at all"));
    // A moment with no day at all opens too, described as Undated.
    expect(await screen.findByText("Undated", { selector: "p, span" }, WAIT)).toBeInTheDocument();
  });

  it("opens a moment with no impact, confidence or source and shows Not set, not blank tiles", async () => {
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);
    fireEvent.click(await screen.findByText("Saved without scores", undefined, WAIT));
    // The three score tiles and the source badge all say Not set; none is blank.
    expect(await screen.findAllByText("Not set", undefined, WAIT)).toHaveLength(3);
    expect(screen.getByText("Source: Not set")).toBeInTheDocument();
    expect(screen.queryByText("/4")).toBeNull();
    expect(screen.queryByText("/10")).toBeNull();
  });
});
