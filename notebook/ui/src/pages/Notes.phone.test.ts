import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";
import { WAIT } from "@/test/wait-limits";

// New Note, New Folder and the forms that gained a visible label (#1051), in the built app at a
// phone's width. A person at 390 px opens New Note again and again, and every field of the forms
// named here has a visible label that is its name and lies whole inside a 320 px window.

const UI_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PHONE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 568 };

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

// Loaded: no request in flight, fonts in, and no animation still on its way.
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.body.innerText.includes("Checking your sign-in…") && !document.body.innerText.includes("Opening...") && !document.querySelector(".animate-spin"));
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
}


// What the page shows for a label: the visible label element with exactly this text, the one
// field the name finds, and that the label is that field's (for/id, or aria-labelledby).
function labelProblems(page: Page, names: string[]) {
  return page.evaluate((wanted) => {
    const wrong: string[] = [];
    for (const name of wanted) {
      const labels = [...document.querySelectorAll("label")].filter((l) => l.textContent?.trim() === name && l.offsetParent !== null);
      if (labels.length !== 1) { wrong.push(`"${name}": ${labels.length} visible labels`); continue; }
      const label = labels[0];
      const control = label.control ?? (label.id ? document.querySelector(`[aria-labelledby~="${label.id}"]`) : null);
      if (!control) { wrong.push(`"${name}": the label names no field`); continue; }
      const box = label.getBoundingClientRect();
      if (label.scrollWidth > label.clientWidth || box.left < 0 || box.right > window.innerWidth) wrong.push(`"${name}": the label is cut off (${Math.round(box.left)} to ${Math.round(box.right)} on ${window.innerWidth} px)`);
      const field = control.getBoundingClientRect();
      if (field.left < 0 || field.right > window.innerWidth) wrong.push(`"${name}": the field spans ${Math.round(field.left)} to ${Math.round(field.right)} on ${window.innerWidth} px`);
    }
    return wrong;
  }, names);
}

describe("forms with visible labels at a phone's width", () => {
  let browser: Browser;
  let dist: string;
  let notebook: RealNotebook;
  let adaId: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "notes-phone-"));
    await buildUi(join(dist, "dist"));
    browser = await launch();
    notebook = await startNotebook({ uiRoot: join(dist, "dist") });
    const insert = (name: string) => notebook.query({ table: "contacts", operation: "insert", values: { name }, selection: "id", single: true });
    adaId = (await insert("Ada Lovelace")).id;
    await insert("Bo Peep");
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await notebook?.stop();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  async function inPage<T>(viewport: { width: number; height: number }, path: string, run: (page: Page) => Promise<T>): Promise<T> {
    const context = await browser.newContext({ viewport });
    try {
      const page = await context.newPage();
      await page.goto(`${notebook.base}${path}`);
      await settle(page);
      return await run(page);
    } finally {
      await context.close();
    }
  }

  const newNoteFromPlus = async (page: Page) => {
    await page.getByRole("button", { name: "New note or folder" }).click();
    await page.getByRole("menuitem", { name: "New Note" }).click();
  };
  const noteId = (page: Page) => page.url().replace(/.*\/dashboard\/notes\//, "");

  it("opens New Note every time at 390 px, with title and text named by visible labels", async () => {
    await inPage(PHONE, "/dashboard/notes", async (page) => {
      await newNoteFromPlus(page);
      await page.getByLabel("Note title", { exact: true }).waitFor(WAIT);
      await page.getByLabel("Note title", { exact: true }).fill("First");
      await page.keyboard.press("Enter");
      await page.keyboard.type("A line");
      const seen = new Set([noteId(page)]);
      const reopen = async (open: () => Promise<void>) => {
        const before = page.url();
        await open();
        await page.waitForURL((url) => url.toString() !== before);
        await page.getByLabel("Note title", { exact: true }).waitFor(WAIT);
        await page.getByLabel("Note text", { exact: true }).waitFor(WAIT);
        expect(await page.getByLabel("Note title", { exact: true }).count()).toBe(1);
        expect(await page.getByLabel("Note text", { exact: true }).count()).toBe(1);
        expect(seen.has(noteId(page))).toBe(false);
        seen.add(noteId(page));
        expect(await labelProblems(page, ["Note title", "Note text"])).toEqual([]);
      };
      for (let i = 0; i < 3; i++) await reopen(() => page.getByRole("button", { name: "New note", exact: true }).click());
      await page.getByRole("button", { name: "Notes", exact: true }).click();
      await reopen(() => newNoteFromPlus(page));
    });
  }, 120_000);

  it("opens New Folder at 390 px with a visible label, and creates the folder", async () => {
    await inPage(PHONE, "/dashboard/notes", async (page) => {
      await page.getByRole("button", { name: "New note or folder" }).click();
      await page.getByRole("menuitem", { name: "New Folder" }).click();
      const dialog = page.getByRole("alertdialog");
      await dialog.waitFor(WAIT);
      const box = dialog.getByLabel("Folder name", { exact: true });
      expect(await box.count()).toBe(1);
      const where = await box.boundingBox();
      expect(where!.x).toBeGreaterThanOrEqual(0);
      expect(where!.x + where!.width).toBeLessThanOrEqual(PHONE.width);
      expect(await box.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent)).toBe("Folder name");
      await box.fill("Garden");
      await dialog.getByRole("button", { name: "Create folder" }).click();
      await page.getByText("Garden", { exact: true }).waitFor(WAIT);
    });
  }, 120_000);

  describe("at 320 px no new label is cut off", () => {
    it("on a new note", async () => {
      await inPage(NARROW, "/dashboard/notes", async (page) => {
        await newNoteFromPlus(page);
        await page.getByLabel("Note title", { exact: true }).waitFor(WAIT);
        expect(await labelProblems(page, ["Note title", "Note text"]), "new note").toEqual([]);
      });
    }, 120_000);

    it("in the New Folder dialog", async () => {
      await inPage(NARROW, "/dashboard/notes", async (page) => {
        await page.getByRole("button", { name: "New note or folder" }).click();
        await page.getByRole("menuitem", { name: "New Folder" }).click();
        await page.getByRole("alertdialog").waitFor(WAIT);
        expect(await labelProblems(page, ["Folder name"]), "New Folder dialog").toEqual([]);
      });
    }, 120_000);

    it("in World's Add a thing", async () => {
      await inPage(NARROW, "/dashboard/world", async (page) => {
        await page.getByRole("button", { name: "Add a thing" }).click();
        expect(await labelProblems(page, ["Name", "Type"]), "Add a thing").toEqual([]);
      });
    }, 120_000);

    it("in a person's Add relationship", async () => {
      await inPage(NARROW, `/dashboard/people/${adaId}`, async (page) => {
        await page.getByRole("button", { name: "Add relationship" }).first().click();
        expect(await labelProblems(page, ["Relationship", "Custom label (optional)", "Related to", "Person"]), "Add relationship").toEqual([]);
      });
    }, 120_000);

    it("in Create with AI", async () => {
      await inPage(NARROW, "/collections", async (page) => {
        await page.getByRole("button", { name: /Create with AI/ }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor(WAIT);
        const prompt = await dialog.locator("label").first().textContent();
        expect(await labelProblems(page, [prompt!.trim()]), "Create with AI").toEqual([]);
      });
    }, 120_000);
  });
});
