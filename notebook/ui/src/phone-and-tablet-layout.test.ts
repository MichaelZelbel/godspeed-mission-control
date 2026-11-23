import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright-core";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";
import { WAIT } from "@/test/wait-limits";

// Chat and header search at phone and tablet widths (#1017), read the way a person sees them in a
// real browser: jsdom has no layout, so a class assertion would prove nothing here. The test
// notebook has no AI connected, so a sent message is answered with the "No AI is connected yet" state.

const UI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PHONES = [{ width: 375, height: 667 }, { width: 320, height: 640 }];
const DESKTOP = { width: 1280, height: 900 };
const LONG_TITLE = "Reunion: an afternoon canoe trip on the lake";

// In a process of its own, so Vite's build stays out of this test's module graph.
function buildUi(outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const vite = join(UI_ROOT, "node_modules/vite/bin/vite.js");
    const child = spawn(process.execPath, [vite, "build", "--outDir", outDir, "--emptyOutDir"], { cwd: UI_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`vite build stopped (${code}): ${output.slice(-2000)}`))));
  });
}

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

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.body.innerText.includes("Checking your sign-in…") && !document.body.innerText.includes("Opening...") && !document.querySelector(".animate-spin"));
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
}

const messageBox = (page: Page) => page.getByRole("textbox", { name: "Message", exact: true });

async function send(page: Page, text: string) {
  const before = await page.getByText("No AI is connected yet").count();
  await messageBox(page).fill(text);
  await page.keyboard.press("Enter");
  await page.waitForFunction((n) => [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent?.includes("No AI is connected yet")).length > n, before, { timeout: 10_000 }).catch(() => {});
  await settle(page);
}

// The panel's header, messages scroller and composer wrapper, read from the message box up.
const PANEL = `(() => {
  const box = document.querySelector("textarea[aria-label=Message]");
  const panel = box && box.closest(".flex.flex-col.h-full");
  if (!panel) return null;
  const [header, scroller, composerWrap] = panel.children;
  return { panel, header, scroller, composerWrap };
})()`;

describe("chat and search at phone and tablet widths", () => {
  let browser: Browser;
  let dist: string;
  let notebook: RealNotebook;
  let noteId: string;
  // A note keeps its chat, so a test that sends messages takes a note of its own.
  const insertNote = (title: string) => notebook.query({ table: "notes", operation: "insert", values: { title, content: "<p>Short body.</p>" }, selection: "id", single: true });

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "phone-tablet-layout-"));
    await buildUi(join(dist, "dist"));
    browser = await launch();
    notebook = await startNotebook({ uiRoot: join(dist, "dist") });
    noteId = (await insertNote("Reunion: an evening plan")).id;
    await insertNote(LONG_TITLE);
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await notebook?.stop();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  async function inPage(options: BrowserContextOptions, path: string, run: (page: Page) => Promise<void>) {
    const context = await browser.newContext(options);
    try {
      const page = await context.newPage();
      await page.goto(`${notebook.base}${path}`);
      await settle(page);
      await run(page);
    } finally {
      await context.close();
    }
  }

  const openNoteChat = async (page: Page) => {
    await page.getByRole("button", { name: "Chat with Godspeed" }).first().click();
    await messageBox(page).waitFor(WAIT);
    await settle(page);
  };

  for (const viewport of PHONES) {
    it(`a note's chat shows the newest message and its reply in full above the composer at ${viewport.width}x${viewport.height}`, async () => {
      const { id } = await insertNote("A note to ask about");
      await inPage({ viewport }, `/dashboard/notes/${id}`, async (page) => {
        await openNoteChat(page);
        const read = (fits: boolean) => page.evaluate(`(() => {
          const p = ${PANEL};
          if (!p) return ["no chat panel"];
          const wrong = [];
          const s = p.scroller.getBoundingClientRect();
          if (${fits} && p.scroller.scrollHeight > p.scroller.clientHeight + 1) wrong.push("the conversation scrolls inside a strip: " + p.scroller.scrollHeight + " px of content in " + p.scroller.clientHeight);
          const inside = (label, el) => {
            if (!el) return wrong.push(label + " is missing");
            const r = el.getBoundingClientRect();
            if (r.top < s.top - 1 || r.bottom > s.bottom + 1) wrong.push(label + " spans " + Math.round(r.top) + " to " + Math.round(r.bottom) + " outside the conversation " + Math.round(s.top) + " to " + Math.round(s.bottom));
          };
          const hint = [...p.scroller.querySelectorAll("*")].reverse().find((e) => e.textContent.includes("No AI is connected yet") && ![...e.children].some((c) => c.textContent.includes("No AI is connected yet")));
          inside("the connection hint", hint);
          const composer = p.panel.querySelector(".chat-composer").getBoundingClientRect();
          const panel = p.panel.getBoundingClientRect();
          if (composer.top < panel.top || composer.bottom > panel.bottom + 1 || composer.bottom > window.innerHeight) wrong.push("the composer spans " + Math.round(composer.top) + " to " + Math.round(composer.bottom) + " in a panel ending at " + Math.round(panel.bottom) + " on a " + window.innerHeight + " px window");
          return wrong;
        })()`);
        // The first exchange fits without scrolling; a longer one may scroll, with its newest end in view.
        let problems = (await read(true)) as string[];
        await send(page, "Hello there, what is this note about?");
        problems = problems.concat((await read(true)) as string[]);
        await send(page, "And a second question?");
        problems = problems.concat((await read(false)) as string[]);
        expect(problems, problems.join("\n")).toEqual([]);
      });
    }, 120_000);

    // Guards, not a reproduction: on main focusing the box moves nothing. The failure was seen on
    // #1001's candidate, and the taller panel meets it where an on-screen keyboard covers the box.
    it(`focusing the message box keeps the chat header on screen at ${viewport.width}x${viewport.height}`, async () => {
      await inPage({ viewport, isMobile: true, hasTouch: true }, `/dashboard/notes/${noteId}`, async (page) => {
        await openNoteChat(page);
        const state = () => page.evaluate(`(() => {
          const p = ${PANEL};
          const h = p.header.getBoundingClientRect();
          const m = p.panel.querySelector("textarea[aria-label=Message]").getBoundingClientRect();
          return { top: Math.round(h.top), bottom: Math.round(h.bottom), boxTop: Math.round(m.top), boxBottom: Math.round(m.bottom), innerHeight: window.innerHeight, scrollY: window.scrollY, mainScroll: document.querySelector("main").scrollTop };
        })()`) as Promise<{ top: number; bottom: number; boxTop: number; boxBottom: number; innerHeight: number; scrollY: number; mainScroll: number }>;
        const before = await state();
        await messageBox(page).click();
        await messageBox(page).pressSequentially("hello there");
        const typed = await state();
        expect(typed.top).toBeGreaterThanOrEqual(0);
        expect(typed.bottom).toBeLessThanOrEqual(typed.innerHeight);
        expect({ top: typed.top, scrollY: typed.scrollY, mainScroll: typed.mainScroll }).toEqual({ top: before.top, scrollY: before.scrollY, mainScroll: before.mainScroll });
        await page.setViewportSize({ width: viewport.width, height: viewport.height - 290 });
        await page.waitForTimeout(300);
        const keyboard = await state();
        expect(keyboard.top).toBeGreaterThanOrEqual(0);
        expect(keyboard.bottom).toBeLessThanOrEqual(keyboard.innerHeight);
        expect(keyboard.boxTop).toBeGreaterThanOrEqual(0);
        expect(keyboard.boxBottom).toBeLessThanOrEqual(keyboard.innerHeight);
      });
    }, 120_000);

    it(`header search results are as wide as the screen less its margins at ${viewport.width} px`, async () => {
      await inPage({ viewport }, "/dashboard", async (page) => {
        await page.locator("header input").first().fill("Reunion");
        await page.locator("header .absolute.top-full").getByText(LONG_TITLE).waitFor(WAIT);
        const m = await page.evaluate((title) => {
          const d = document.querySelector("header .absolute.top-full")!;
          const b = d.getBoundingClientRect();
          const el = [...d.querySelectorAll("*")].find((e) => e.children.length === 0 && e.textContent === title)!;
          const range = document.createRange();
          range.setStart(el.firstChild!, 0);
          range.setEnd(el.firstChild!, 30);
          return { width: b.width, innerWidth: window.innerWidth, wanted: range.getBoundingClientRect().width, room: el.clientWidth };
        }, LONG_TITLE);
        expect(m.width).toBeGreaterThanOrEqual(m.innerWidth - 24 - 1);
        expect(m.wanted).toBeLessThanOrEqual(m.room);
      });
    }, 120_000);
  }

  it("shows the whole word Godspeed in the chat page header and the pop-out at 375 px", async () => {
    const wholeWord = (page: Page) => page.evaluate(() => {
      const span = document.querySelector("[data-testid=\"chat-header-title\"] span.font-semibold")!;
      const range = document.createRange();
      range.setStart(span.firstChild!, 0);
      range.setEnd(span.firstChild!, 8);
      return { text: span.textContent, header: span.closest(".border-b")!.textContent, wordRight: range.getBoundingClientRect().right, spanRight: span.getBoundingClientRect().right, cut: span.scrollWidth > span.clientWidth };
    });
    await inPage({ viewport: PHONES[0] }, "/dashboard/chat", async (page) => {
      await send(page, "hi");
      const m = await wholeWord(page);
      expect(m.header).not.toContain("msgs");
      expect(m.wordRight).toBeLessThanOrEqual(m.spanRight + 0.5);
      expect(m.cut, `title "${m.text}" is cut`).toBe(false);
    });
    await inPage({ viewport: PHONES[0] }, `/dashboard/chat?note=${noteId}`, async (page) => {
      const m = await wholeWord(page);
      expect(m.wordRight).toBeLessThanOrEqual(m.spanRight + 0.5);
    });
  }, 120_000);

  it("keeps the desktop chat page header, with the count worded in full", async () => {
    await inPage({ viewport: DESKTOP }, "/dashboard/chat", async (page) => {
      const header = () => page.evaluate(() => document.querySelector("[data-testid=\"chat-header-title\"] span.font-semibold")!.closest(".border-b")!.textContent!.replace(/\s+/g, " "));
      await send(page, "hi");
      expect(await header()).toContain("/ 1 message");
      expect(await header()).not.toContain("1 messages");
      await send(page, "hi again");
      expect(await header()).toContain("/ 2 messages");
      expect(await page.getByText("Clear conversation", { exact: true }).isVisible()).toBe(true);
    });
  }, 120_000);

  it("keeps the desktop search results as wide as the search box", async () => {
    await inPage({ viewport: DESKTOP }, "/dashboard", async (page) => {
      await page.locator("header input").first().fill("Reunion");
      await page.locator("header .absolute.top-full").waitFor(WAIT);
      const m = await page.evaluate(() => {
        const d = document.querySelector("header .absolute.top-full")!.getBoundingClientRect();
        const c = document.querySelector("header .absolute.top-full")!.parentElement!.getBoundingClientRect();
        return { dl: d.left, dr: d.right, cl: c.left, cr: c.right };
      });
      expect(m.dl).toBeCloseTo(m.cl, 0);
      expect(m.dr).toBeCloseTo(m.cr, 0);
    });
  }, 120_000);

  describe("the note panel with the sidebar open at 768 px", () => {
    const sidebarWidth = (page: Page) => page.evaluate(() => document.querySelector("[data-sidebar=sidebar]")!.getBoundingClientRect().width);

    it("closes the sidebar for an open note so the panel and toolbar fit", async () => {
      await inPage({ viewport: { width: 768, height: 1024 } }, "/dashboard", async (page) => {
        expect(await sidebarWidth(page)).toBeGreaterThan(200);
        await page.goto(`${notebook.base}/dashboard/notes/${noteId}`);
        await settle(page);
        expect(await sidebarWidth(page)).toBeLessThanOrEqual(64);
        const m = await page.evaluate(() => {
          let panel: Element | null = document.querySelector(".ProseMirror");
          while (panel && !(panel as HTMLElement).className.includes("flex-1 min-h-0 min-w-0 flex-col")) panel = panel.parentElement;
          const toolbar = [...document.querySelectorAll(".overflow-x-auto")].find((e) => e.querySelector(".min-w-\\[18rem\\]")) as HTMLElement;
          return { panel: panel!.getBoundingClientRect().width, scrollWidth: toolbar.scrollWidth, clientWidth: toolbar.clientWidth };
        });
        expect(m.panel).toBeGreaterThanOrEqual(360);
        expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
        // Opened by hand, it stays open.
        await page.locator("[data-sidebar=trigger]").first().click();
        await page.waitForTimeout(500);
        expect(await sidebarWidth(page)).toBeGreaterThan(200);
        // With the sidebar reopened and the note still open, the toolbar is not cut off.
        const t = await page.evaluate(() => {
          const toolbar = [...document.querySelectorAll(".overflow-x-auto")].find((e) => e.querySelector(".min-w-\\[18rem\\]")) as HTMLElement;
          return { scrollWidth: toolbar.scrollWidth, clientWidth: toolbar.clientWidth, right: toolbar.getBoundingClientRect().right };
        });
        expect(t.scrollWidth).toBeLessThanOrEqual(t.clientWidth);
        expect(t.right).toBeLessThanOrEqual(768);
      });
    }, 120_000);

    it("leaves the sidebar open on a desktop", async () => {
      await inPage({ viewport: DESKTOP }, `/dashboard/notes/${noteId}`, async (page) => {
        expect(await sidebarWidth(page)).toBeGreaterThan(200);
      });
    }, 120_000);
  });
});
