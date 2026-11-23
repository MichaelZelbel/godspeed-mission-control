// @vitest-environment jsdom
// A 200-letter unbroken word in a moment's detail panel wraps inside the panel (#997).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import TimelinePage from "./TimelinePage";
import { WAIT } from "@/test/wait-limits";

const word = "a".repeat(200);
const moments = [{
  id: "m1", title: "Long word moment", description: word, source: "manual", verified: false,
  is_potential_major: false, happened_at: "2026-10-10", happened_end: null,
  status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5,
}];

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const result: any = { data: table === "moments" ? moments : [], error: null };
    const chain: any = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: any) => Promise.resolve(result).then(resolve);
        return () => chain;
      },
    });
    return chain;
  };
  return { supabase: { from, functions: { invoke: vi.fn(async () => ({ data: {}, error: null })) } } };
});
const { auth } = vi.hoisted(() => ({ auth: { user: { id: "owner" }, session: { access_token: "t", user: { id: "owner" } } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/hooks/useAICreditsGate", () => ({ useAICreditsGate: () => ({ checkCredits: () => true }) }));

class NoResize { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoResize as any;
Element.prototype.scrollIntoView ??= () => {};

describe("the moment detail panel", () => {
  afterEach(() => cleanup());
  it("wraps and width-constrains a 200-letter unbroken description", async () => {
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("Long word moment")).toBeInTheDocument(), WAIT);
    fireEvent.click(screen.getByText("Long word moment").closest("button")!);
    const el = await screen.findByText(word, undefined, WAIT);
    expect(el.className).toMatch(/overflow-wrap:anywhere|break-words/);
    expect(el.className).toContain("min-w-0");
  });
});
