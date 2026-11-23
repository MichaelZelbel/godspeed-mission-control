// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
import { WAIT } from "@/test/wait-limits";

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current.client; } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/collections/AICollectionDialog", () => ({ AICollectionDialog: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

describe("blank collection validation", () => {
  afterEach(cleanup);

  it("shows the required-name error and does not insert a collection", async () => {
    fake.current = createFakeSupabase((query) => query.table === "collections" ? { data: [] } : undefined);
    const { default: Collections } = await import("./Collections");
    render(<MemoryRouter><Collections /></MemoryRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "or create a blank collection" }, WAIT));
    const name = screen.getByLabelText("Name");
    fireEvent.submit(name.closest("form")!);

    expect(await screen.findByText("Name is required", undefined, WAIT)).toBeVisible();
    await waitFor(() => expect(fake.current.on("collections", "insert")).toHaveLength(0), WAIT);
  });
});
