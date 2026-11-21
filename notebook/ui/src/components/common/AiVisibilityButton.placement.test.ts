import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";

// The note toolbar's "Shown to AI / Hidden from AI" switch says what a click did. As a page toast
// that message covered part of the open note in one layout after another: the toolbar at the top
// right (#809), the save status at the bottom (#819), the Backlinks and Comments rows at the bottom
// left once the sidebar and the notes list were closed (#831). This test drives the built app in a
// real browser in every layout the note page has (the app sidebar open and closed, the notes list
// open and closed) at 1024 px and 1400 px, clicks the switch, and fails when its message lies over
// any part of the open note: its toolbar, its text or its footer down to the status bar.

const UI_ROOT = resolve(__dirname, "../../..");
const WIDTHS = [1024, 1400];
const LAYOUTS = [
  { sidebar: true, list: true },
  { sidebar: true, list: false },
  { sidebar: false, list: true },
  { sidebar: false, list: false },
];
const MESSAGE = /^(Hidden from AI - excluded from People, Graph, AI Chat & MCP|Visible to AI again)$/;
const SWITCH = /^(Shown to AI\. Hide from AI|Hidden from AI\. Show to AI again)$/;

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

// In a process of its own, so Vite's build stays out of this test's module graph.
function buildUi(outDir: string): Promise<void> {
  return new Promise((done, fail) => {
    const vite = join(UI_ROOT, "node_modules/vite/bin/vite.js");
    const child = spawn(process.execPath, [vite, "build", "--outDir", outDir, "--emptyOutDir"], { cwd: UI_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`vite build stopped (${code}): ${output.slice(-2000)}`))));
  });
}

async function settleAnimations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 10_000 });
}

type Box = { left: number; top: number; right: number; bottom: number };
type Measured = { message: Box; note: Box; sidebar: string | null; listOpen: boolean };

// The open note: the smallest box around the switch that also holds the note's footer (its
// Backlinks and Comments rows) and its status bar (the word count). The message's box is that of
// the element showing it, a toast or anything else.
async function measure(page: Page): Promise<Measured> {
  return page.evaluate(({ message, switchName }) => {
    const box = (el: Element) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const toggle = [...document.querySelectorAll("button")].find((b) => new RegExp(switchName).test(b.getAttribute("aria-label") ?? ""));
    if (!toggle) throw new Error("The AI switch is not on the page");
    let note: Element | null = toggle;
    while (note && !(/Backlinks/.test(note.textContent ?? "") && /Comments/.test(note.textContent ?? "") && /\bwords?\b/.test(note.textContent ?? ""))) note = note.parentElement;
    if (!note) throw new Error("No element holds the switch, the note's footer and its status bar");
    const shown = [...document.querySelectorAll("body *")].filter((el) => new RegExp(message).test(el.textContent?.trim() ?? "") && el.getBoundingClientRect().width > 0);
    // The outermost drawn element that shows only the message: the toast or bubble around its text
    // (a toast list around it may have no height of its own).
    const drawn = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const inner = shown.find((el) => !shown.some((other) => other !== el && el.contains(other)));
    if (!inner) throw new Error("The switch's message is not on the page");
    let frame: Element = inner;
    for (let up = inner.parentElement; up && up !== document.body && (up.textContent ?? "").trim() === (inner.textContent ?? "").trim(); up = up.parentElement) {
      if (drawn(up)) frame = up;
    }
    return {
      message: box(frame),
      note: box(note),
      sidebar: document.querySelector("[data-state][data-collapsible]")?.getAttribute("data-state") ?? null,
      listOpen: [...document.querySelectorAll('[aria-label="Collapse notes tree"]')].some(drawn),
    };
  }, { message: MESSAGE.source, switchName: SWITCH.source });
}

describe("the AI switch's message beside the open note", () => {
  let browser: Browser;
  let dist: string;
  let notebook: RealNotebook;
  let noteId: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "ai-switch-"));
    await buildUi(join(dist, "dist"));
    browser = await launch();
    notebook = await startNotebook({ uiRoot: join(dist, "dist") });
    const note = await notebook.query({ table: "notes", operation: "insert", values: { title: "Trip to Lisbon", content: "Book the train." }, selection: "id", single: true });
    noteId = note.id;
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await notebook?.stop();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  it("covers no part of the open note with the sidebar and the notes list open or closed, at 1024 px and 1400 px", async () => {
    const failures: string[] = [];
    for (const width of WIDTHS) {
      for (const layout of LAYOUTS) {
        const at = `at ${width} px, sidebar ${layout.sidebar ? "open" : "closed"}, notes list ${layout.list ? "open" : "closed"}`;
        const context = await browser.newContext({ viewport: { width, height: 800 } });
        try {
          const page = await context.newPage();
          await page.goto(`${notebook.base}/dashboard/notes/${noteId}`);
          const toggle = page.getByRole("button", { name: SWITCH });
          await toggle.waitFor({ timeout: 20_000 });
          // The app remembers both choices, so each is set from the state the page opened in.
          const sidebarOpen = (await page.locator("[data-state][data-collapsible]").first().getAttribute("data-state")) === "expanded";
          if (sidebarOpen !== layout.sidebar) await page.getByRole("button", { name: "Toggle Sidebar" }).first().click();
          const expand = page.getByRole("button", { name: "Expand notes tree" });
          const collapse = page.getByRole("button", { name: "Collapse notes tree" });
          await expand.or(collapse).first().waitFor({ timeout: 10_000 });
          const listOpen = await collapse.isVisible();
          if (listOpen !== layout.list) await (layout.list ? expand : collapse).click();
          await settleAnimations(page);
          await toggle.click();
          await page.getByText(MESSAGE).first().waitFor({ timeout: 10_000 });
          await settleAnimations(page);
          const m = await measure(page);
          const of = `${at}: ${JSON.stringify(m)}`;
          expect(m.sidebar, `the sidebar is in the wrong state ${of}`).toBe(layout.sidebar ? "expanded" : "collapsed");
          expect(m.listOpen, `the notes list is in the wrong state ${of}`).toBe(layout.list);
          const overlaps = m.message.left < m.note.right && m.note.left < m.message.right && m.message.top < m.note.bottom && m.note.top < m.message.bottom;
          if (overlaps) failures.push(`the message lies over the open note ${of}`);
          if (m.message.left < 0 || m.message.top < 0 || m.message.right > width || m.message.bottom > 800) failures.push(`the message runs off the window ${of}`);
        } finally {
          await context.close();
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 240_000);
});
