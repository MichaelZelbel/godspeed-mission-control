// @vitest-environment jsdom
// Every Timeline card names its moment's status the way the Add Moment and
// Edit Moment forms do (#929): the card's tag text equals the form's own label
// for that status, for every status the form offers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import TimelinePage from "./TimelinePage";
import { statusLabels } from "@/components/timeline/AddEventDialog";
import { WAIT } from "@/test/wait-limits";

const base = { happened_end: null, description: null, source: "godspeed due done", verified: false, is_potential_major: false };
const moments = Object.keys(statusLabels).map((status, i) => ({
  ...base, id: `m-${status}`, title: `A ${status} moment`, happened_at: `2026-10-${10 + i}`,
  status, impact_level: 2, confidence_truth: 5, confidence_date: 5,
}));

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

describe("the timeline's card status tags", () => {
  afterEach(() => cleanup());
  it("labels every card's status with the form's label for that status", async () => {
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText("A past_fact moment")).toBeInTheDocument(), WAIT);
    for (const [status, label] of Object.entries(statusLabels)) {
      const card = screen.getByText(`A ${status} moment`).closest("button");
      expect(card, `no card rendered for status ${status}`).not.toBeNull();
      expect(within(card!).getByText(label)).toBeInTheDocument();
      // The stored value never shows through raw.
      expect(within(card!).queryByText(status)).toBeNull();
    }
  });
});
