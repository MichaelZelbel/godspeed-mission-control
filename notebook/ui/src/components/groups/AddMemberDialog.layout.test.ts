import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";

// The Add Members dialog on a group page, at a phone's width, with a person whose name is one
// unbroken word about 50 characters long (#926). The page-wide layout check opens only each page's
// main add dialog, and the group page's is New Group, so this dialog needs its own check. It fails
// on main: at 320 px the dialog runs past the window, its title is cut, and the long name is cut
// off. Everything here reads the built app the way a person sees it, in a real browser.

const UI_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const LONG_NAME = "Supercalifragilisticexpialidociousdonaudampfschiff";
const ORDINARY_NAME = "Ada Lovelace";
const PHONE_WIDTHS = [{ width: 320, height: 568 }, { width: 375, height: 812 }];
const DESKTOP = { width: 1280, height: 900 };

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

async function openDialog(page: Page) {
  await page.getByRole("button", { name: "Add Member", exact: true }).click();
  await page.getByRole("dialog").waitFor({ timeout: 5000 });
  await settle(page);
}

// The contract's measures, read on the open dialog. Each returns a string when it is wrong, so a
// failure says which measure failed at which width. It is one expression the test runs with
// page.evaluate (the page-wide check's own pattern), with the rows that must be listed read in as
// source, so nothing in it may refer to anything outside the page.
function problemsOn(expected: string[]) {
  return `(() => {
  const expected = ${JSON.stringify(expected)};
  const wrong = [];
  const push = (s) => { if (s) wrong.push(s); };
  const dialog = document.querySelector("[role=dialog]");
  if (!dialog) return ["no dialog is open"];

  // 1. No wider than the window: the page does not scroll sideways, and the dialog's own box
  // lies within it.
  if (document.documentElement.scrollWidth > window.innerWidth) {
    push(\`the page scrolls sideways: scrollWidth \${document.documentElement.scrollWidth} on a \${window.innerWidth} px window\`);
  }
  const box = dialog.getBoundingClientRect();
  if (box.left < 0 || box.right > window.innerWidth) {
    push(\`the dialog's box spans \${Math.round(box.left)} to \${Math.round(box.right)} on a \${window.innerWidth} px window\`);
  }

  // 2. The title is shown whole, not cut at the right edge.
  const title = dialog.querySelector("h2");
  if (!title) push("the title is missing");
  else if (title.scrollWidth > title.clientWidth) {
    push(\`the title is cut: it needs \${title.scrollWidth} px, its box has \${title.clientWidth}\`);
  }

  // 3. Each name either wraps (breaks inside the word) or is truncated with its full text kept
  // (a title attribute), and never pushes its row, its checkbox or the dialog past the window.
  for (const name of expected) {
    const label = [...dialog.querySelectorAll("label")].find((l) => l.textContent?.includes(name));
    if (!label) { push(\`the row for "\${name}" is missing\`); continue; }
    const shown = label.querySelector("span.block");
    if (!shown) { push(\`the name "\${name}" has no shown text\`); continue; }
    if (shown.scrollWidth > shown.clientWidth) {
      const kept = shown.getAttribute("title") === name;
      // Wrapped: the name's characters stand on more than one line, which only a break inside
      // the word can do for a name with no spaces.
      const range = document.createRange();
      range.selectNodeContents(shown);
      const lines = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      if (!kept && lines.size < 2) push(\`the name "\${name}" is cut off, with its full text kept nowhere\`);
    }
    const rowBox = label.getBoundingClientRect();
    if (rowBox.left < 0 || rowBox.right > window.innerWidth) {
      push(\`the row "\${name}" spans \${Math.round(rowBox.left)} to \${Math.round(rowBox.right)} on a \${window.innerWidth} px window\`);
    }
    const checkbox = label.querySelector("button[role=checkbox]")?.getBoundingClientRect();
    if (checkbox && (checkbox.left < 0 || checkbox.right > window.innerWidth)) {
      push(\`the checkbox in "\${name}"'s row spans \${Math.round(checkbox.left)} to \${Math.round(checkbox.right)} on a \${window.innerWidth} px window\`);
    }
  }

  // 4. The dialog's own buttons (add, close) lie fully inside the window.
  for (const button of [...dialog.querySelectorAll("button")]) {
    const text = (button.getAttribute("aria-label") || button.textContent || "").replace(/\\s+/g, " ").trim();
    const b = button.getBoundingClientRect();
    if (b.left < 0 || b.right > window.innerWidth) push(\`the button "\${text}" spans \${Math.round(b.left)} to \${Math.round(b.right)} on a \${window.innerWidth} px window\`);
  }
  return wrong;
})()`;
}

describe("the Add Members dialog at a phone's width", () => {
  let browser: Browser;
  let dist: string;
  let notebook: RealNotebook;
  let longId: string;
  let adaId: string;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "add-member-dialog-"));
    await buildUi(join(dist, "dist"));
    browser = await launch();
    notebook = await startNotebook({ uiRoot: join(dist, "dist") });
    const insert = (table: string, values: Record<string, unknown>) => notebook.query({ table, operation: "insert", values, selection: "id,slug", single: true });
    const long = await insert("contacts", { name: LONG_NAME });
    const ada = await insert("contacts", { name: ORDINARY_NAME });
    longId = long.id;
    adaId = ada.id;
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await notebook?.stop();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  const row = (page: Page, name: string) => page.getByRole("dialog").locator("label").filter({ hasText: name });
  const longRow = (page: Page) => row(page, LONG_NAME.slice(0, 20));
  // A group of its own per test, so no test meets a membership another one added.
  const newGroup = async () => {
    const group = await notebook.query({ table: "contact_groups", operation: "insert", values: { name: "Seed round investors" }, selection: "id,slug", single: true });
    expect(group.slug).toBeTruthy();
    return group as { id: string; slug: string };
  };

  for (const viewport of PHONE_WIDTHS) {
    it(`holds the dialog, its title and both names inside the window at ${viewport.width} px`, async () => {
      const group = await newGroup();
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        await page.goto(`${notebook.base}/dashboard/groups/${group.slug}`);
        await settle(page);
        await openDialog(page);

        const problems: string[] = [];
        // Unfiltered: both people listed.
        problems.push(...(await page.evaluate<string[]>(problemsOn([LONG_NAME, ORDINARY_NAME]))));
        // Filtered: the search narrows the list to the long name alone.
        await page.getByLabel("Search people").fill(LONG_NAME.slice(0, 10));
        await settle(page);
        problems.push(...(await page.evaluate<string[]>(problemsOn([LONG_NAME]))));
        // Selected: the long name's checkbox ticked, the way the state this change creates holds.
        await longRow(page).locator('button[role=checkbox]').click();
        await settle(page);
        problems.push(...(await page.evaluate<string[]>(problemsOn([LONG_NAME]))));
        expect(problems, problems.join("\n")).toEqual([]);
      } finally {
        await context.close();
      }
    }, 120_000);

    it(`selects and adds the person with the long name at ${viewport.width} px`, async () => {
      const group = await newGroup();
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        await page.goto(`${notebook.base}/dashboard/groups/${group.slug}`);
        await settle(page);
        await openDialog(page);
        // Clicking the row's text must reach the checkbox: the row is one label.
        await longRow(page).click();
        await row(page, ORDINARY_NAME).click();
        expect(await longRow(page).locator('button[role=checkbox]').getAttribute("data-state")).toBe("checked");
        expect(await row(page, ORDINARY_NAME).locator('button[role=checkbox]').getAttribute("data-state")).toBe("checked");
        await page.getByRole("button", { name: /Add Selected/ }).click();
        await page.getByText("Members added").waitFor({ timeout: 5000 });
        await page.getByRole("dialog").waitFor({ state: "detached", timeout: 5000 });
        const memberships = await notebook.query({
          table: "contact_group_memberships",
          operation: "select",
          selection: "contact_id",
          filters: [["eq", "group_id", group.id]],
        });
        expect(memberships.map((m: { contact_id: string }) => m.contact_id)).toEqual(expect.arrayContaining([longId, adaId]));
      } finally {
        await context.close();
      }
    }, 120_000);
  }

  // At a desktop's width the dialog is the one main has always shown: at most its max-w-lg width,
  // centred inside the window, and the add flow works there as it did.
  it(`is unchanged at ${DESKTOP.width} px`, async () => {
    const group = await newGroup();
    const context = await browser.newContext({ viewport: DESKTOP });
    try {
      const page = await context.newPage();
      await page.goto(`${notebook.base}/dashboard/groups/${group.slug}`);
      await settle(page);
      await openDialog(page);
      const box = await page.evaluate(() => {
        const dialog = document.querySelector("[role=dialog]");
        if (!dialog) return null;
        const b = dialog.getBoundingClientRect();
        return { width: b.width, left: b.left, right: b.right, innerWidth: window.innerWidth };
      });
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(512);
      expect(box!.left).toBeGreaterThanOrEqual(0);
      expect(box!.right).toBeLessThanOrEqual(box!.innerWidth);
      await longRow(page).click();
      await page.getByRole("button", { name: /Add Selected/ }).click();
      await page.getByText("Members added").waitFor({ timeout: 5000 });
      const memberships = await notebook.query({
        table: "contact_group_memberships",
        operation: "select",
        selection: "contact_id",
        filters: [["eq", "group_id", group.id]],
      });
      expect(memberships.map((m: { contact_id: string }) => m.contact_id)).toContain(longId);
    } finally {
      await context.close();
    }
  }, 120_000);
});
