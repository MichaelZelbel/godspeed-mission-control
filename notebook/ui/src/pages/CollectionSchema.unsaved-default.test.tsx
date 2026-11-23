// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import CollectionSchema from "./CollectionSchema";
import { WAIT } from "@/test/wait-limits";

const row = {
  id: "c1", user_id: "owner", name: "Blank", slug: "blank", icon: null, description: null,
  visibility: "private", field_schema: [], agent_instructions: null,
  created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
};
vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {
    select: () => query, eq: () => query,
    order: async () => ({ data: [row], error: null }),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { supabase: { from: () => query } };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));

describe("Schema page of a collection saved with no fields (#1018)", () => {
  afterEach(() => cleanup());
  it("says the shown Name field is not saved yet", async () => {
    render(
      <MemoryRouter initialEntries={["/collections/blank/schema"]}>
        <Routes><Route path="/collections/:slug/schema" element={<CollectionSchema />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no fields until you press Save/, undefined, WAIT)).toBeInTheDocument();
  });
});
