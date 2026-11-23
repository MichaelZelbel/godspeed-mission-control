import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright-core";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";

// With the browser refusing site data, reading localStorage and sessionStorage throws a
// SecurityError. The notebook must still open and work, and say what it cannot keep (#989).

const UI_ROOT = fileURLToPath(new URL("..", import.meta.url));

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

const BLOCK_STORAGE = () => {
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(window, name, { configurable: true, get() { throw new DOMException("denied", "SecurityError"); } });
  }
};

describe("the notebook with the browser's site data blocked", () => {
  let dist: string;
  let browser: Browser;
  let notebook: RealNotebook;
  let note: string;
  let person: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "blocked-storage-"));
    await buildUi(join(dist, "dist"));
    browser = await launch();
    notebook = await startNotebook({ uiRoot: join(dist, "dist") });
    const insert = (table: string, values: Record<string, unknown>) => notebook.query({ table, operation: "insert", values, selection: "id", single: true });
    note = (await insert("notes", { title: "Trip to Lisbon", content: "Book the train." })).id;
    person = (await insert("contacts", { name: "Ada Lovelace" })).id;
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await notebook?.stop();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  it("opens, reads and writes notes and people, opens the chat, and says what it cannot keep", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      await context.addInitScript(BLOCK_STORAGE);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e.message)));
      const body = () => page.locator("body").innerText();

      await page.goto(notebook.base + "/dashboard");
      await page.getByRole("heading", { name: "Your notebook" }).waitFor({ timeout: 15_000 });
      await page.getByText(/allow site data \(cookies and site data\) for this address/).waitFor({ timeout: 5000 });
      expect(await body()).toContain("kept only until you close or reload this tab");
      expect(await body()).not.toContain("so text not saved yet");
      await page.getByRole("button", { name: /close toast/i }).click();
      await page.getByText(/allow site data/).waitFor({ state: "detached", timeout: 3000 });
      const text = await body();
      expect(text).not.toContain("Let’s reconnect");
      expect(text).not.toContain("denied");

      await page.goto(notebook.base + `/dashboard/notes/${note}`);
      const title = page.getByRole("textbox", { name: "Note title" });
      await title.waitFor({ timeout: 15_000 });
      expect(await title.inputValue()).toBe("Trip to Lisbon");
      await title.fill("Trip to Porto");
      await expect.poll(async () => (await notebook.query({ table: "notes", operation: "select", selection: "title", filters: [["eq", "id", note]], single: true })).title, { timeout: 15_000 }).toBe("Trip to Porto");

      await page.goto(notebook.base + `/dashboard/people/${person}`);
      await page.getByText("Ada Lovelace").first().waitFor({ timeout: 15_000 });
      await page.goto(notebook.base + "/dashboard/people");
      await page.getByRole("button", { name: "Add person", exact: true }).first().click();
      await page.getByLabel("Name").fill("Grace Hopper");
      await page.getByRole("button", { name: "Create" }).click();
      await expect.poll(async () => (await notebook.query({ table: "contacts", operation: "select", selection: "name", filters: [["eq", "name", "Grace Hopper"]] })).length, { timeout: 15_000 }).toBe(1);

      await page.goto(notebook.base + "/dashboard/chat");
      await page.waitForLoadState("networkidle");
      expect(await body()).not.toContain("Something went wrong");
      expect(await page.locator("textarea, [contenteditable=true], a[href*=settings], button").count()).toBeGreaterThan(0);

      expect(errors.filter((e) => /SecurityError|denied/.test(e))).toEqual([]);
    } finally {
      await context.close();
    }
  }, 120_000);
});
