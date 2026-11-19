// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import Collections from "./Collections";
import { WAIT } from "@/test/wait-limits";

// Issue #813: a workspace with a habit or tracker from tracker-list but no collection showed the
// Trackers shelf and no way to create a collection. The header's actions now show whenever the
// empty state, which has its own buttons, does not.

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });

const { listed } = vi.hoisted(() => ({ listed: { trackers: [] as unknown[] } }));

vi.mock("@/integrations/supabase/client", () => {
  const rows = { data: [], error: null };
  const query = { select: () => query, eq: () => query, in: () => query, order: async () => rows };
  return {
    supabase: {
      from: () => query,
      functions: { invoke: async () => ({ data: listed, error: null }) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));

const habit = { id: "h1", name: "Morning walk", specialist: "habit", status: "active", habit_status: "active" };

function show() {
  render(
    <TooltipProvider>
      <MemoryRouter initialEntries={["/collections"]}>
        <Routes>
          <Route path="/collections" element={<Collections />} />
          <Route path="/collections/templates" element={<p>Templates page</p>} />
        </Routes>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

describe("Collections header actions", () => {
  afterEach(() => {
    cleanup();
    listed.trackers = [];
  });

  it("shows the header actions beside the Trackers shelf when there are habits but no collections", async () => {
    listed.trackers = [habit];
    show();
    expect(await screen.findByRole("heading", { name: "Trackers" }, WAIT)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Collections", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Morning walk")).toBeInTheDocument();
    expect(screen.queryByText("No collections yet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "✨ Create with AI" }));
    expect(await screen.findByRole("dialog", { name: "Create a collection with AI" }, WAIT)).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await screen.findByRole("button", { name: "New blank collection" }, WAIT);

    fireEvent.click(screen.getByRole("button", { name: "New blank collection" }));
    expect(await screen.findByRole("dialog", { name: "New Collection" }, WAIT)).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    fireEvent.click(await screen.findByRole("button", { name: "Templates" }, WAIT));
    expect(await screen.findByText("Templates page", {}, WAIT)).toBeInTheDocument();
  });

  it("shows each button once, in the empty state only, when there is nothing at all", async () => {
    show();
    expect(await screen.findByText("No collections yet", {}, WAIT)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "✨ Create with AI" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Browse Templates" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "or create a blank collection" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Templates" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New blank collection" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Collections", level: 1 })).not.toBeInTheDocument();
  });
});
