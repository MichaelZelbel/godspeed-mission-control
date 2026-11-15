// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import TimelinePage from "./TimelinePage";

// A contact record with no name, as the notebook's files and store allow.
const contacts = [{ id: "c-named", name: "Ada", relationship: null }, { id: "c-nameless", relationship: null }, { id: "c-nameless-2", relationship: null }];
const { inserts } = vi.hoisted(() => ({ inserts: [] as { table: string; values: any }[] }));

vi.mock("@/integrations/supabase/client", () => {
  // Every query-builder call returns the same chain; awaiting it answers for its table.
  const from = (table: string) => {
    let result: any = { data: table === "contacts" ? contacts : [], error: null };
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

describe("the timeline with a contact that has no name", () => {
  afterEach(() => { cleanup(); inserts.length = 0; });
  it("renders, lets named and unnamed people be picked, and saves their original ids", async () => {
    render(<MemoryRouter><TimelinePage /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole("button", { name: /Add Moment/ }))[0]);
    fireEvent.change(await screen.findByPlaceholderText("Short title for this moment"), { target: { value: "Met up" } });

    await waitFor(() => expect(screen.getByText("People")).toBeInTheDocument());
    fireEvent.click(await screen.findByText("Add person"));
    fireEvent.click(await screen.findByText("Ada"));
    // The picker stays open: pick the two unnamed people, who share a label.
    const unnamed = await screen.findAllByText("Unnamed person");
    expect(unnamed).toHaveLength(2);
    fireEvent.click(unnamed[0]);
    // Picked, it moves up to "Selected"; the other is the last match, in "All people".
    const rest = await screen.findAllByText("Unnamed person");
    fireEvent.click(rest[rest.length - 1]);

    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    await waitFor(() => expect(inserts.some((i) => i.table === "moment_participants")).toBe(true));
    const saved = inserts.find((i) => i.table === "moment_participants")!.values.map((v: any) => v.person_id).sort();
    expect(saved).toEqual(["c-named", "c-nameless", "c-nameless-2"]);
  });
});
