// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { RelationshipsSection } from "./RelationshipsSection";
import { WAIT } from "@/test/wait-limits";

// My Profile on a fresh notebook (#865): the display-name read asked for the
// owner's profiles record as exactly one record, and the notebook refused it
// with "Expected one record" while no profile row exists yet. The stand-in
// below answers the way the notebook's does — a single-record read of an empty
// table is refused — so the card's own requests prove the fix: the read is
// made as an optional single record, a missing profile record is an empty
// profile, and every answer is 2xx.
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

function notebook() {
  const requests: Array<{ table: string; body: any; status: number }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    let status = 200, payload: any;
    if (!body.operation || body.operation === "select") {
      // A fresh workspace holds no rows at all, so a read that asks for exactly
      // one record finds none — exactly what the notebook refuses.
      if (body.single) { status = 400; payload = { error: "Expected one record" }; }
      else payload = { data: body.maybeSingle ? null : [], count: 0, error: null };
    } else payload = { data: [], count: 0, error: null };
    requests.push({ table: body.table, body, status });
    return new Response(JSON.stringify(payload), { status });
  }));
  return requests;
}

function page() {
  const requests = notebook();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <RelationshipsSection contactId={null} contactName="My" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return requests;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("My Profile's relationships card on a fresh notebook", () => {
  it("reads the display name as an optional single record and gets no refused answer", async () => {
    const requests = page();
    expect(await screen.findByText("No relationships yet. Add one.", undefined, WAIT)).toBeInTheDocument();
    const profiles = requests.find((r) => r.table === "profiles");
    expect(profiles).toMatchObject({ status: 200 });
    expect(profiles?.body).toMatchObject({ table: "profiles", maybeSingle: true });
    expect(requests.filter((r) => r.status >= 400)).toEqual([]);
  });
});
