// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import TimelinePage from "./TimelinePage";
import { WAIT } from "@/test/wait-limits";

// The moments the page reads; the mocked database loses a row on delete.
const { seedRows, db, deleted, failDelete, toasts } = vi.hoisted(() => {
  const base = { happened_end: null, description: null, source: "manual", verified: false, is_potential_major: false };
  return {
  seedRows: [
    { ...base, id: "m-trip", title: "Old trip", happened_at: "2026-05-01", status: "past_fact", impact_level: 2, confidence_truth: 5, confidence_date: 5 },
    { ...base, id: "m-week", title: "Quiet week", happened_at: "2026-06-01", status: "past_fact", impact_level: 1, confidence_truth: 5, confidence_date: 5 },
  ] as any[],
  db: [] as any[],
  deleted: [] as string[],
  failDelete: { on: false },
  toasts: [] as string[],
  };});

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let result: any = { data: table === "moments" ? db : [], error: null };
    const chain: any = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "then") return (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
        if (table === "moments" && prop === "delete") return () => { result = { data: null, error: failDelete.on ? { message: "boom" } : null }; return chain; };
        if (table === "moments" && prop === "eq") return (_col: string, id: string) => {
          if (!failDelete.on) { const i = db.findIndex((m) => m.id === id); if (i >= 0) { db.splice(i, 1); deleted.push(id); } }
          return chain;
        };
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
vi.mock("@/lib/toast", () => ({
  showToast: {
    success: (m: string) => toasts.push(`success:${m}`),
    error: (m: string) => toasts.push(`error:${m}`),
    warning: (m: string) => toasts.push(`warning:${m}`),
    batched: { success: (m: string) => toasts.push(`success:${m}`) },
  },
}));
// The page's menus, rendered inline so the delete items are reachable.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="drawer-menu">{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}));
vi.mock("@/components/ui/context-menu", () => ({
  ContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ContextMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ContextMenuContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-menu">{children}</div>,
  ContextMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
}));

class NoResize { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= NoResize as any;
Element.prototype.scrollIntoView ??= () => {};

const page = () => render(<MemoryRouter><TimelinePage /></MemoryRouter>);
// The dialog's own Delete button, distinct from the menu items of the same name.
const confirmButton = async () => {
  const dialog = await screen.findByRole("alertdialog", undefined, WAIT);
  return within(dialog).getByRole("button", { name: "Delete" });
};

describe("deleting a timeline moment", () => {
  beforeEach(() => { db.splice(0, db.length, ...seedRows); });
  afterEach(() => { cleanup(); db.splice(0, db.length); deleted.length = 0; toasts.length = 0; failDelete.on = false; });

  it("offers Delete in the card's menu and the drawer's Moment actions menu, and cancelling keeps the moment", async () => {
    page();
    await screen.findAllByText("Old trip", undefined, WAIT);
    // Both menus offer Delete (criterion 1). With the drawer closed only the
    // card's is in the accessibility tree; the drawer's joins when it opens.
    expect(within(document.querySelector("[data-testid='card-menu']") as HTMLElement).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Old trip"));
    const drawerMenu = await waitFor(() => {
      const menu = document.querySelector("[data-testid='drawer-menu']");
      if (!menu) throw new Error("the drawer has not mounted yet");
      return menu as HTMLElement;
    }, WAIT);
    expect(within(drawerMenu).getByRole("button", { name: "Delete" })).toBeInTheDocument();
    fireEvent.click(within(drawerMenu).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText('Delete "Old trip"?', undefined, WAIT)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((await screen.findAllByText("Old trip", undefined, WAIT)).length).toBeGreaterThan(0);
    expect(deleted).toEqual([]);
  });

  it("a confirmed delete removes the moment and says it was deleted", async () => {
    page();
    fireEvent.click(await screen.findByText("Old trip", undefined, WAIT));
    const deletes = await screen.findAllByRole("button", { name: "Delete" }, WAIT);
    fireEvent.click(deletes[0]);
    fireEvent.click(await confirmButton());
    await vi.waitFor(() => { expect(deleted).toEqual(["m-trip"]); }, WAIT);
    expect(toasts).toContain("success:Moment deleted");
    await waitFor(() => expect(screen.queryByText("Old trip")).toBeNull(), WAIT);
    expect(screen.getByText("Quiet week")).toBeInTheDocument();
  });

  it("a failed delete keeps the moment and says it could not be deleted", async () => {
    failDelete.on = true;
    page();
    fireEvent.click((await screen.findAllByText("Old trip", undefined, WAIT))[0]);
    const deletes = await screen.findAllByRole("button", { name: "Delete" }, WAIT);
    fireEvent.click(deletes[0]);
    fireEvent.click(await confirmButton());
    await vi.waitFor(() => { expect(toasts.some((t) => t.startsWith("error:"))).toBe(true); }, WAIT);
    expect((await screen.findAllByText("Old trip", undefined, WAIT)).length).toBeGreaterThan(0);
    expect(toasts).not.toContain("success:Moment deleted");
    expect(deleted).toEqual([]);
  });
});
