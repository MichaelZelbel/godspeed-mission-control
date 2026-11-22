// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { chromium, type Browser } from "playwright-core";
import tailwindConfig from "../../../tailwind.config";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createFakeSupabase } from "@/test/fake-supabase";

// On a phone the header's search box read "Search nc": the placeholder "Search notes…" did not fit
// between the sidebar toggle and the New Note button (#733). jsdom has no layout, so this test
// renders the header the way it is at each width, draws it in a real browser at a phone's width and
// a desktop's width, and measures it: the placeholder and the button labels must not be clipped, and
// New Note, notifications and the theme switch must stay on screen and clickable.

vi.mock("@/integrations/supabase/client", () => ({ supabase: createFakeSupabase().client }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
vi.mock("./DashboardSidebar", () => ({ DashboardSidebar: () => null }));
vi.mock("./CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/chat/GlobalAIChatFAB", () => ({ GlobalAIChatFAB: () => null }));

const UI_ROOT = resolve(__dirname, "../../..");

// The header as React renders it in a window of this width (the New Note label and the sidebar's
// phone mode both follow the window's width).
async function headerAt(width: number): Promise<string> {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  vi.stubGlobal("matchMedia", (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    };
  });
  const { DashboardLayout } = await import("./DashboardLayout"); 
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <QueryClientProvider client={client}><DashboardLayout /></QueryClientProvider>
    </MemoryRouter>,
  );
  
  const header = document.getElementsByTagName("header")[0];
  // The header sits in the layout's main column beside the sidebar (16rem, hidden below 768 px), as
  // it does in the app.
  const html = `<div style="display:flex;min-height:100vh;width:100%"><div class="hidden md:block w-[16rem] shrink-0"></div>`
    + `<div class="flex-1 min-w-0 flex flex-col">${header.outerHTML}</div></div>`;
  cleanup(); 
  return html;
}

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
type Control = { name: string; box: Box; hit: boolean; clipped: boolean };
type Measured = {
  placeholder: string; placeholderWidth: number; room: number;
  search: Box; header: Box; scrollWidth: number; controls: Control[];
};

const CONTROLS = ["Toggle Sidebar", "New note", "Create another item", "Notifications", "Toggle theme"];

describe("dashboard header drawn at a phone's width and a desktop's width", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("shows the whole search placeholder and keeps New Note, notifications and the theme switch usable", async () => {
    const browser = await launch();
    const dir = mkdtempSync(join(tmpdir(), "dashboard-header-"));
    try {
      for (const width of [320, 375, 1280]) {
        const page = await headerAt(width); 
        const css = await appCss(page);
        const file = join(dir, `header-${width}.html`);
        writeFileSync(file, `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${page}</body></html>`);
        const tab = await browser.newPage({ viewport: { width, height: 800 } });
        await tab.goto(pathToFileURL(file).href);
        await tab.evaluate(() => document.fonts.ready); 
        const m: Measured = await tab.evaluate((names) => {
          const box = (r: DOMRect) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
          const input = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')!;
          const style = getComputedStyle(input);
          const ctx = document.createElement("canvas").getContext("2d")!;
          ctx.font = style.font;
          // The width the text gets: the box less its borders and padding (the search icon and the
          // spinner sit in the padding).
          const room = input.getBoundingClientRect().width
            - ["borderLeftWidth", "paddingLeft", "paddingRight", "borderRightWidth"].reduce((sum, k) => sum + parseFloat((style as any)[k]), 0);
          const header = document.querySelector("header")!;
          const controls = names.map((name) => {
            const el = Array.from(header.querySelectorAll("button")).find(
              (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name,
            )!;
            if (!el) return { name, box: { left: 0, right: 0, top: 0, bottom: 0 }, hit: false, clipped: true };
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            const clipped = Array.from(el.querySelectorAll("span")).some((s) => !s.classList.contains("sr-only") && s.scrollWidth > s.clientWidth + 0.5)
              || el.scrollWidth > el.clientWidth + 0.5;
            return { name, box: box(r), hit: !!hit && el.contains(hit), clipped };
          });
          return {
            placeholder: input.placeholder,
            placeholderWidth: ctx.measureText(input.placeholder).width,
            room,
            search: box(input.getBoundingClientRect()),
            header: box(header.getBoundingClientRect()),
            scrollWidth: document.documentElement.scrollWidth,
            controls,
          };
        }, CONTROLS);
        await tab.close();
        const at = `at ${width} px: ${JSON.stringify(m)}`;
        const overlaps = (a: Box, b: Box) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        // A whole word or phrase, not a fragment of one.
        expect(m.placeholder, at).toMatch(/^Search( notes…)?$/);
        expect(m.placeholderWidth, `the search placeholder is clipped ${at}`).toBeLessThanOrEqual(m.room);
        expect(m.scrollWidth, `the page scrolls sideways ${at}`).toBeLessThanOrEqual(width);
        for (const c of m.controls) {
          const of = `${c.name} ${at}`;
          expect(c.box.right - c.box.left, of).toBeGreaterThan(0);
          expect(c.box.left, `${c.name} is off screen ${at}`).toBeGreaterThanOrEqual(0);
          expect(c.box.right, `${c.name} is off screen ${at}`).toBeLessThanOrEqual(width);
          expect(c.hit, `${c.name} cannot be clicked ${at}`).toBe(true);
          expect(c.clipped, `${c.name}'s label is clipped ${at}`).toBe(false);
          expect(overlaps(c.box, m.search), `${c.name} lies over the search box ${at}`).toBe(false);
        }
      }
    } finally {
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
