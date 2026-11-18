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
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { watchSidebarFit } from "@/lib/sidebar-fit";

// At 1366 x 860, a common laptop screen, the sidebar's "Godspeed chat" was drawn half under the
// footer (Sign Out and the version line), and nothing showed that the list scrolls (#747). jsdom has
// no layout, so this test renders the sidebar as the app does, draws it in a real browser at laptop
// sizes, runs the sidebar's own fitting (watchSidebarFit, which the sidebar starts when it mounts) on
// it, and measures it: with the list scrolled to the top, every entry is either wholly inside the
// list's visible part or wholly below it, and when some are below, the "more below" sign shows and
// scrolling to the end brings the last entry fully into view.

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: "premium", signOut: async () => false }) }));
vi.mock("@/hooks/useProfileSummary", () => ({ useProfileSummary: () => ({ completeness: 50 }) }));
vi.mock("@/hooks/useReviewQueue", () => ({ useReviewQueueCount: () => 3 }));
vi.mock("@/components/settings/CreditsDisplay", () => ({ CreditsDisplay: () => null }));
vi.mock("@/components/subscription/PremiumBadge", () => ({ PremiumBadge: () => null }));

const UI_ROOT = resolve(__dirname, "../../..");

async function sidebarHtml(width: number): Promise<string> {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  vi.stubGlobal("matchMedia", (query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    };
  });
  const { DashboardSidebar } = await import("./DashboardSidebar");
  const { container } = render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <SidebarProvider><DashboardSidebar /></SidebarProvider>
    </MemoryRouter>,
  );
  const html = container.innerHTML;
  cleanup();
  return html;
}

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

// No browser at all is a failure, not a skip.
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

type Entry = { name: string; top: number; bottom: number };
type Measured = {
  entries: Entry[]; listTop: number; listBottom: number; footerTop: number;
  scrolls: boolean; cueShown: boolean; lastAfterScroll: Entry; listBottomAfterScroll: number; cueAfterScroll: boolean;
};

describe("desktop sidebar drawn at laptop sizes", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("cuts no entry in half and shows when more entries are below", async () => {
    const browser = await launch();
    const dir = mkdtempSync(join(tmpdir(), "dashboard-sidebar-"));
    try {
      for (const [width, height] of [[1366, 860], [1280, 720]]) {
        const page = await sidebarHtml(width);
        const css = await appCss(page);
        const file = join(dir, `sidebar-${width}x${height}.html`);
        writeFileSync(file, `<!doctype html><html class="dark"><head><meta charset="utf-8"><style>${css}</style></head><body>${page}</body></html>`);
        const tab = await browser.newPage({ viewport: { width, height } });
        await tab.goto(pathToFileURL(file).href);
        await tab.evaluate(() => document.fonts.ready);
        await tab.addScriptTag({ content: `window.watchSidebarFit = ${watchSidebarFit.toString()};` });
        await tab.evaluate(() => {
          const list = document.querySelector<HTMLElement>('[data-sidebar="content"]')!;
          const more = document.querySelector<HTMLElement>("[data-sidebar-more]")!;
          (window as any).watchSidebarFit(list, more);
        });
        const m: Measured = await tab.evaluate(async () => {
          const list = document.querySelector<HTMLElement>('[data-sidebar="content"]')!;
          const footer = document.querySelector<HTMLElement>('[data-sidebar="footer"]')!;
          const cue = () => {
            const el = document.querySelector<HTMLElement>('[data-sidebar-more]');
            if (!el) return false;
            const s = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0.5 && r.height > 0;
          };
          const entries = () => Array.from(list.querySelectorAll<HTMLElement>('[data-sidebar="menu-button"]')).map((el) => {
            const r = el.getBoundingClientRect();
            return { name: el.textContent?.trim() ?? "", top: r.top, bottom: r.bottom };
          });
          list.scrollTop = 0;
          list.dispatchEvent(new Event("scroll"));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const atTop = entries();
          const lr = list.getBoundingClientRect();
          const scrolls = list.scrollHeight > list.clientHeight + 1;
          const cueShown = cue();
          list.scrollTop = list.scrollHeight;
          list.dispatchEvent(new Event("scroll"));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const after = entries();
          return {
            entries: atTop, listTop: lr.top, listBottom: lr.bottom, footerTop: footer.getBoundingClientRect().top,
            scrolls, cueShown, lastAfterScroll: after[after.length - 1],
            listBottomAfterScroll: list.getBoundingClientRect().bottom, cueAfterScroll: cue(),
          };
        });
        await tab.close();
        const at = `at ${width} x ${height}: ${JSON.stringify(m)}`;
        expect(m.entries.length, at).toBeGreaterThan(10);
        expect(m.listBottom, `the list runs under the footer ${at}`).toBeLessThanOrEqual(m.footerTop + 0.5);
        for (const e of m.entries) {
          const cut = e.top < m.listBottom - 0.5 && e.bottom > m.listBottom + 0.5;
          expect(cut, `"${e.name}" is drawn half under the footer ${at}`).toBe(false);
        }
        if (m.scrolls) {
          expect(m.cueShown, `entries are below the fold and nothing says so ${at}`).toBe(true);
          expect(m.lastAfterScroll.bottom, `the last entry cannot be scrolled into view ${at}`).toBeLessThanOrEqual(m.listBottomAfterScroll + 0.5);
          expect(m.cueAfterScroll, `the "more below" sign stays at the end of the list ${at}`).toBe(false);
        }
      }
    } finally {
      await browser.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
