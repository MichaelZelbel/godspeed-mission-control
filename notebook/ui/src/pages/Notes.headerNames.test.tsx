// @vitest-environment jsdom
// Issue #890 (21 November 2026): in the notes tree's header, two buttons were
// announced in other words than their tooltips say ("Tags and insights" over
// the tooltip "Tags & Insights"; "Sort notes by Last Edited, descending" over
// the tooltip "Sort by Last Edited: descending"). A person who uses voice
// control says what they see on screen, and the button did not answer to it
// (WCAG 2.5.3, label in name). These render the notes page and check, for
// every button in the notes tree's header, that it has an accessible name and
// a tooltip, and that the name matches the tooltip or starts with the
// tooltip's words - across the sort states whose templates differ.
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WAIT } from "@/test/wait-limits";

vi.mock("@/hooks/useNotes", () => ({ useNotes: () => ({ data: [], isLoading: false }), useNote: () => ({ data: null, isFetched: false, isError: false }), useCreateNote: () => ({ isPending: false }), useUpdateNote: () => ({}), useIlikeSearch: () => ({ isPending: false, mutate: (_: any, o: any) => o?.onSuccess([]) }), useSemanticSearch: () => ({ isPending: false, mutate: vi.fn() }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/notes/NoteTree", () => ({ NoteTree: () => null }));
vi.mock("@/components/chat/GlobalAIChatFAB", () => ({ GlobalAIChatFAB: () => null }));
vi.mock("@/components/notes/NoteEditor", () => ({ NoteEditor: () => null }));
vi.mock("@/components/notes/NoteList", () => ({ NoteList: () => null }));
vi.mock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ setOpen: vi.fn() }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false, usePanesTogether: () => true }));
vi.mock("@/lib/flags", () => ({ OFFLINE_CORE: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { const q: any = { select: () => q, order: () => q, eq: () => q, then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve) }; return q; } } }));

afterEach(() => { cleanup(); window.localStorage.clear(); });

/** What the button's own markup gives a screen reader: labelledby, then aria-label, then text. */
function accessibleName(button: HTMLButtonElement): string {
  const labelledby = button.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby.split(/\s+/).filter(Boolean)
      .map((ref) => document.getElementById(ref)?.textContent ?? "")
      .join(" ").trim();
    if (text) return text;
  }
  const label = button.getAttribute("aria-label");
  if (label && label.trim()) return label.trim();
  return (button.textContent ?? "").trim();
}

const said = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** Every button in the notes tree's header is named and titled, and its name matches its tooltip or starts with the tooltip's words. */
function expectHeaderNamedAgainstTooltips() {
  const header = screen.getByLabelText("Notes navigation");
  const buttons = Array.from(header.querySelectorAll<HTMLButtonElement>("button"));
  expect(buttons.length, `the notes tree header: only ${buttons.length} buttons found`).toBeGreaterThanOrEqual(7);
  for (const button of buttons) {
    const name = accessibleName(button);
    const where = `the notes tree header: ${button.outerHTML.slice(0, 200)}`;
    expect(name, `a button has no accessible name: ${where}`).not.toBe("");
    const title = button.getAttribute("title")?.trim();
    expect(title, `a button has no tooltip: ${where}`).toBeTruthy();
    const tooltip = said(title ?? "");
    const spoken = said(name);
    expect(spoken === tooltip || spoken.startsWith(tooltip), `the button says "${name}" but its tooltip says "${title}" (${where})`).toBe(true);
  }
}

async function openNotes() {
  vi.resetModules();
  const { default: Notes } = await import("./Notes");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/dashboard/notes"]}>
          <Routes><Route path="/dashboard/notes/*" element={<Notes />} /></Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByLabelText("Notes navigation", {}, WAIT);
}

it("every button in the notes tree's header says what its tooltip says", async () => {
  await openNotes();
  expectHeaderNamedAgainstTooltips();
}, 60_000);

it("the sort button keeps saying its tooltip's words in the other sort states too", async () => {
  for (const sort of [
    { field: "updated_at", direction: "desc", tooltip: "Sort by Last Edited: descending" },
    { field: "title", direction: "asc", tooltip: "Sort by Title: ascending" },
    { field: "manual", direction: "desc", tooltip: "Sort by Manual" },
  ]) {
    window.localStorage.clear();
    window.localStorage.setItem("menerio:notelist:sort", JSON.stringify(sort));
    await openNotes();
    expectHeaderNamedAgainstTooltips();
    expect(screen.getByLabelText(sort.tooltip)).toBeInTheDocument();
    cleanup();
  }
}, 60_000);
