// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import TimelinePage from "./TimelinePage";
import { WAIT } from "@/test/wait-limits";

// A moment can reach the notebook with a stored date nothing can read as a
// calendar day: a word ("sometime"), a year that has not come ("20xx-05-01"),
// an impossible day ("2024-13-45"). On main such a moment sat under a year
// heading printing the raw stored text, while its card said Not set (#951).
const base = { description: null, verified: false, is_potential_major: false, status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5, source: "manual" };
const moments = [
  { ...base, id: "m-same", title: "Same day", happened_at: "2025-03-05", happened_end: "2025-03-05" },
  { ...base, id: "m-span", title: "Several days", happened_at: "2025-03-05", happened_end: "2025-03-08" },
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

describe("a moment whose end is its start", () => {
  afterEach(() => cleanup());

  it("shows one date on the card and in the details, and keeps the range for a longer moment", async () => {
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);
    expect(await screen.findByText("Same day", undefined, WAIT)).toBeInTheDocument();
    expect(screen.getByText("Mar 5, 2025")).toBeInTheDocument();
    expect(screen.queryByText("Mar 5, 2025 – Mar 5, 2025")).toBeNull();
    expect(screen.getByText("Mar 5, 2025 – Mar 8, 2025")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Same day"));
    // The details drawer's description line (dialog description) shows one date too.
    const dialog = await screen.findByRole("dialog", undefined, WAIT);
    const desc = dialog.querySelector("p")!;
    expect(desc).toHaveTextContent(/^Mar 5, 2025$/);
  });
});
