// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import TimelinePage from "./TimelinePage";
import { WAIT } from "@/test/wait-limits";

// A moment can reach the notebook with a stored date nothing can read as a
// calendar day: a word ("sometime"), a year that has not come ("20xx-05-01"),
// an impossible day ("2024-13-45"). On main such a moment sat under a year
// heading printing the raw stored text, while its card said Not set (#951).
const base = { happened_end: null, description: null, verified: false, is_potential_major: false };
const moments = [
  { ...base, id: "m-word", title: "A word instead of a day", happened_at: "sometime", status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5, source: "manual" },
  { ...base, id: "m-20xx", title: "A year that has not come", happened_at: null, moment_date: "20xx-05-01", status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5, source: "manual" },
  { ...base, id: "m-impossible", title: "An impossible day", happened_at: "2024-13-45", status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5, source: "manual" },
  { ...base, id: "m-plain", title: "A plain day", happened_at: "2024-05-01", status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5, source: "manual" },
  { ...base, id: "m-stamp", title: "A full timestamp", happened_at: "2023-11-02T10:00:00Z", status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5, source: "manual" },
  { ...base, id: "m-none", title: "Never given a day", happened_at: null, status: "unknown", impact_level: 1, confidence_truth: 0, confidence_date: 0, source: "manual" },
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

describe("the timeline with moments whose stored date cannot be read", () => {
  afterEach(() => cleanup());

  it("groups the unreadable and the dateless together under Undated, last, and keeps the readable years", async () => {
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);
    expect(await screen.findByText("A word instead of a day", undefined, WAIT)).toBeInTheDocument();

    // No year heading prints the raw stored text.
    expect(screen.queryByText("sometime")).toBeNull();
    expect(screen.queryByText("20xx-05-01")).toBeNull();
    expect(screen.queryByText("2024-13-45")).toBeNull();

    // The unreadable ones sit with the dateless one under one Undated heading.
    expect(screen.getByText("Undated")).toBeInTheDocument();
    expect(screen.getByText("4 moments")).toBeInTheDocument();
    expect(screen.getByText("A year that has not come")).toBeInTheDocument();
    expect(screen.getByText("An impossible day")).toBeInTheDocument();
    expect(screen.getByText("Never given a day")).toBeInTheDocument();

    // Readable dates keep their year, newest first, Undated last.
    const y2024 = screen.getByText("2024");
    const y2023 = screen.getByText("2023");
    const undated = screen.getByText("Undated");
    expect(y2024.compareDocumentPosition(y2023) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(y2023.compareDocumentPosition(undated) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("A plain day")).toBeInTheDocument();
    expect(screen.getByText("A full timestamp")).toBeInTheDocument();
  });

  it("never shows a rolled-over date on a card whose stored day cannot be read", async () => {
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);
    expect(await screen.findByText("An impossible day", undefined, WAIT)).toBeInTheDocument();
    // "2024-13-45" used to render as February 14, 2025 (parseDateOnly rolled
    // the impossible month and day over): a date the store never meant, under
    // a heading that did not agree with it.
    expect(screen.queryByText("Feb 14, 2025")).toBeNull();
    // The readable cards keep their dates.
    expect(screen.getByText("May 1, 2024")).toBeInTheDocument();
    // A clock time on a stored day shows beside it (#1059).
    expect(screen.getByText("Nov 2, 2023, 10:00")).toBeInTheDocument();
  });
});
