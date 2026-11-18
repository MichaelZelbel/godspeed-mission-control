// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, type Browser } from "playwright-core";
import tailwindConfig from "../../tailwind.config";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import { createFakeSupabase } from "@/test/fake-supabase";

// A Media Library card's "Kept on this computer only" badge (top left) used to be placed on its
// own over the thumbnail, and so did the status (top right): the long badge ran under the
// "Analyzing…" chip and under the green check mark (#502, #514). They now share one row, the badge
// able to shrink to two lines beside the status, and the status moving down under it when the card
// is too narrow for both (#728), so neither can lie over the other.
// jsdom has no layout, so the first tests check the arrangement, and the last one draws the card in
// a real browser at a phone's width and a desktop's width and measures it (#728).

const { fake } = vi.hoisted(() => ({ fake: { current: null as any } }));
vi.mock("@/integrations/supabase/client", () => ({ get supabase() { return fake.current; } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("@/components/media/PdfThumbnail", () => ({ PdfThumbnail: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BIG = "owner/note-1/big-manual.pdf";
const OTHER = "owner/note-2/away.pdf";
function row(id: string, path: string, note: string, status: string) {
  return { id, note_id: note, storage_path: path, media_type: "pdf", page_number: null, original_filename: path.split("/").pop(), description: null, extracted_text: null, topics: [], raw_analysis: null, analysis_status: status, created_at: "2026-11-13T10:00:00Z", updated_at: "2026-11-13T10:00:00Z" };
}

async function open(status: string) {
  const supa = createFakeSupabase((q) => {
    if (q.table === "media_analysis") return { data: [row("m1", BIG, "note-1", status), row("m2", OTHER, "note-2", status)] };
    if (q.table === "notes") return { data: [{ id: "note-1", title: "Manual" }, { id: "note-2", title: "Away" }] };
    return undefined;
  });
  fake.current = {
    ...supa.client,
    auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/media/kept-here")) return new Response(JSON.stringify({ data: [{ path: BIG }] }));
    if (u.endsWith("/api/media/presence")) return new Response(JSON.stringify({ data: { [BIG]: "present", [OTHER]: "kept_elsewhere" } }));
    return new Response(JSON.stringify({ data: {} }));
  }));
  const { default: MediaLibrary } = await import("./MediaLibrary");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><MediaLibrary /></QueryClientProvider></MemoryRouter>);
}

// The badge and the status sit side by side in one row, neither placed over the card on its own:
// the badge can shrink to two lines' width but no further, the row wraps when there is not room for
// both, and the status keeps its size.
function expectSideBySide(badge: HTMLElement, status: HTMLElement) {
  const rowEl = badge.parentElement!;
  expect(status.parentElement).toBe(rowEl);
  expect(rowEl.className).toMatch(/\bflex\b/);
  expect(rowEl.className).toMatch(/\bflex-wrap\b/);
  expect(badge.className).not.toMatch(/\babsolute\b/);
  expect(status.className).not.toMatch(/\babsolute\b/);
  expect(badge.className).not.toMatch(/\bmin-w-0\b/);
  expect(badge.className).toMatch(/\bmax-w-full\b/);
  expect(status.className).toMatch(/\bshrink-0\b/);
  const order = Array.from(rowEl.children);
  expect(order.indexOf(badge)).toBeLessThan(order.indexOf(status));
}

describe("Media Library card badges and status", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("puts 'Kept on this computer only' beside the Analyzing… chip, not under it", async () => {
    await open("processing");
    const badge = await screen.findByText("Kept on this computer only");
    const chips = await screen.findAllByText("Analyzing…");
    const chip = chips.find((c) => badge.parentElement!.contains(c))!;
    expect(chip).toBeTruthy();
    expectSideBySide(badge, chip.parentElement as HTMLElement);
  });

  it("puts 'Kept on this computer only' beside the analyzed check mark, not under it", async () => {
    await open("complete");
    const badge = await screen.findByText("Kept on this computer only");
    const marks = await screen.findAllByText("✓");
    const mark = marks.find((m) => badge.parentElement!.contains(m))!;
    expect(mark).toBeTruthy();
    expectSideBySide(badge, mark.parentElement as HTMLElement);
    // Re-analyze stays where it was, under the check mark in the same status block.
    const again = within(badge.parentElement!).getByRole("button", { name: /Re-analyze/ });
    expect(again.parentElement).toBe(mark.parentElement);
  });

  it("keeps 'Kept on another computer' in the same row as its status", async () => {
    await open("complete");
    const badge = await screen.findByText("Kept on another computer");
    const mark = (await screen.findAllByText("✓")).find((m) => badge.parentElement!.contains(m))!;
    expect(mark).toBeTruthy();
    expectSideBySide(badge, mark.parentElement as HTMLElement);
  });
});

// --- Drawn in a real browser -------------------------------------------------------------------

const UI_ROOT = resolve(__dirname, "../..");

// The app's own stylesheet, with its fonts read from node_modules and Tailwind built for this page.
async function appCss(html: string): Promise<string> {
  const source = readFileSync(join(UI_ROOT, "src/index.css"), "utf8").replace(
    /@import '(@fontsource-variable\/[^']+)';/g,
    (_all, pkg: string) => {
      const dir = join(UI_ROOT, "node_modules", pkg);
      const fonts = readFileSync(join(dir, "index.css"), "utf8");
      return fonts.replace(/url\(\.\/files\//g, `url(${pathToFileURL(join(dir, "files")).href}/`);
    },
  );
  const config = { ...tailwindConfig, content: [{ raw: html, extension: "html" }] };
  const out = await postcss([tailwindcss(config as any)]).process(source, { from: join(UI_ROOT, "src/index.css") });
  return out.css;
}

// The bundled Chromium where Playwright installed it, otherwise the runner's own Chrome. No browser
// at all is a failure, not a skip.
async function launch(): Promise<Browser> {
  try {
    return await chromium.launch();
  } catch (first) {
    try {
      return await chromium.launch({ channel: "chrome" });
    } catch {
      throw first;
    }
  }
}

type Box = { left: number; right: number; top: number; bottom: number };
type Measured = {
  label: Box; lines: number; textBoxes: Box[];
  check: Box | null; again: Box | null; againHit: boolean; thumb: Box;
};

describe("Media Library card badges drawn at a phone's width and a desktop's width", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("keeps 'Kept on this computer only' readable, on at most two lines, clear of the check mark and Re-analyze", async () => {
    await open("complete");
    await screen.findByText("Kept on this computer only");
    await screen.findAllByText("✓");
    // The page inside the app's frame: the sidebar (16rem, hidden below 768 px) and the padded main area.
    const page = `<div style="display:flex;min-height:100vh"><div class="hidden md:block w-[16rem] shrink-0"></div>`
      + `<main class="flex-1 min-w-0 overflow-auto p-6">${document.body.innerHTML}</main></div>`;
    const css = await appCss(page);
    const dir = mkdtempSync(join(tmpdir(), "media-badge-"));
    const file = join(dir, "card.html");
    writeFileSync(file, `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${page}</body></html>`);
    const browser = await launch();
    try {
      for (const width of [375, 1280]) {
        const tab = await browser.newPage({ viewport: { width, height: 900 } });
        await tab.goto(pathToFileURL(file).href);
        await tab.evaluate(() => document.fonts.ready);
        const m: Measured = await tab.evaluate(() => {
          const box = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
          const label = Array.from(document.querySelectorAll("div")).find((d) => d.textContent === "Kept on this computer only")!;
          const row = label.parentElement!;
          const range = document.createRange();
          range.selectNodeContents(label);
          const textBoxes = Array.from(range.getClientRects()).filter((r) => r.width > 0).map(box);
          const lines = new Set(textBoxes.map((r) => Math.round(r.top))).size;
          const check = Array.from(row.querySelectorAll("span")).find((s) => s.textContent?.trim() === "✓");
          const again = Array.from(row.querySelectorAll("button")).find((b) => b.textContent?.includes("Re-analyze"));
          let againHit = false;
          if (again) {
            const r = again.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            againHit = !!hit && again.contains(hit);
          }
          return {
            label: box(label.getBoundingClientRect()), lines, textBoxes,
            check: check ? box(check.getBoundingClientRect()) : null,
            again: again ? box(again.getBoundingClientRect()) : null,
            againHit, thumb: box(row.parentElement!.getBoundingClientRect()),
          };
        });
        await tab.close();
        const overlaps = (a: Box, b: Box) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        const inside = (a: Box, b: Box) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
        const at = `at ${width} px: ${JSON.stringify(m)}`;
        expect(m.lines, at).toBeGreaterThan(0);
        expect(m.lines, at).toBeLessThanOrEqual(2);
        expect(m.check, at).not.toBeNull();
        expect(m.again, at).not.toBeNull();
        for (const t of m.textBoxes) {
          expect(inside(t, m.label), `label text spills out of its pill ${at}`).toBe(true);
        }
        for (const other of [m.label, ...m.textBoxes]) {
          expect(overlaps(other, m.check!), `label lies over the check mark ${at}`).toBe(false);
          expect(overlaps(other, m.again!), `label lies over Re-analyze ${at}`).toBe(false);
        }
        for (const b of [m.check!, m.again!, m.label]) {
          expect(b.right - b.left, at).toBeGreaterThan(0);
          expect(inside(b, m.thumb), `a badge leaves the thumbnail ${at}`).toBe(true);
        }
        expect(m.againHit, `Re-analyze cannot be clicked ${at}`).toBe(true);
      }
    } finally {
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
