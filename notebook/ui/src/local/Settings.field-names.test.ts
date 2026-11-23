import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";

// Every field on the Settings page is named by exactly its visible label text, and by no other
// label (#753). Settings > Your AI wrapped its fields in their labels, so a screen reader read the
// field's current value as part of its name: the Backup AI's service field was announced, and found,
// as the main "Your AI service" field. This drives the built notebook in a real browser at a phone's
// and a desktop's width, in the states #753 names: as it opens, after choosing "Another service",
// and with a saved connection and a saved backup. Each shown field must have a name, that name must
// be the text of its own label (or its aria-label when it has no visible label), no two fields may
// share a name, and Playwright's getByLabel(name, { exact: true }) must find that one field.

const UI_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WIDTHS = [{ width: 375, height: 812 }, { width: 1280, height: 900 }];
const FIELDS = "input:not([type=hidden]), select, textarea, [role=slider], [role=combobox], [role=textbox], [role=searchbox], [role=spinbutton], [role=switch], [role=checkbox], [role=radio]";
const PROBE = "data-field-name-probe";

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

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const NOW = new Date().toISOString();

// What the notebook answers, changed so that every optional form of the page shows: an AI the
// routines reached (so "Use it for the daily routines and the chat too" shows), Telegram, Hevy, the
// routine form, assistant updates, the first goal, Telegram and voice replies.
async function showEverything(page: Page, saved: boolean) {
  await page.route("**/api/routine-ai", (route) => route.fulfill(json({ available: true, provider: "openrouter", model: "vendor/model-name", source: "settings", key: true, check: { at: NOW, ok: true } })));
  await page.route("**/api/provider", (route) => route.request().method() === "GET"
    ? route.fulfill(json(saved ? { configured: true, url: "https://ai.example.test/v1/chat/completions", model: "vendor/model-name", key: true } : { configured: false, key: false }))
    : route.fallback());
  await page.route("**/api/backup-ai", (route) => route.request().method() === "GET"
    ? route.fulfill(json(saved
      ? { hermes: true, configured: true, backup: { provider: "openrouter", model: "vendor/backup-model", via: "settings", at: NOW }, usage: { answers: 0, last_answer_at: null, main_failing_since: null, last_main_error: null } }
      : { hermes: true, configured: false, backup: null }))
    : route.fallback());
  await page.route("**/api/telegram", (route) => route.fulfill(json({ available: true, managed: "web", connected: false, phase: "none" })));
  await page.route("**/api/voice", (route) => route.request().method() === "GET"
    ? route.fulfill(json(saved
      ? { available: true, voice: { service: "elevenlabs", voice_id: "fictional-voice", model: "eleven_multilingual_v2" }, elevenlabs: { voice_id: "fictional-voice", model: "eleven_multilingual_v2", stability: 0.5, similarity_boost: 0.75, style: 0 }, key: true }
      : { available: true, voice: { service: "edge" }, key: false }))
    : route.fallback());
  await page.route("**/api/workouts", (route) => route.request().method() === "GET" ? route.fulfill(json({ available: true, connected: false })) : route.fallback());
  await page.route("**/api/status", async (route) => {
    const response = await route.fetch();
    const status = await response.json();
    await route.fulfill({ response, json: { ...status, configured: true, goalSetupComplete: false, assistantUpdate: { enabled: true }, kinds: status.kinds?.length ? status.kinds : ["radar"] } });
  });
}

type Field = { probe: string; name: string; label: string | null; how: string };

// Each shown field: its accessible name from Chrome's accessibility tree, and the visible text that
// should name it: its labels' text without the fields inside them, the text its aria-labelledby
// points at, or its aria-label when it has no visible label.
async function shownFields(page: Page): Promise<Field[]> {
  const found: { probe: string; label: string | null; how: string }[] = await page.evaluate(([selector, probe]) => {
    const text = (el: Element) => {
      const copy = el.cloneNode(true) as Element;
      copy.querySelectorAll(selector).forEach((inner) => inner.remove());
      return (copy.textContent || "").replace(/\s+/g, " ").trim();
    };
    const shown = (el: HTMLElement) => {
      if (el.closest('[aria-hidden="true"],[inert]')) return false;
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const fields = [...document.querySelectorAll<HTMLElement>(selector)].filter(shown);
    return fields.map((el, i) => {
      el.setAttribute(probe, String(i));
      const describe = `${el.getAttribute("role") || el.tagName.toLowerCase()}${(el as HTMLInputElement).type ? "[" + (el as HTMLInputElement).type + "]" : ""}`;
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) return { probe: String(i), how: describe, label: labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((l) => text(l!)).join(" ") };
      const labels = (el as HTMLInputElement).labels;
      if (labels?.length) return { probe: String(i), how: describe, label: [...labels].map(text).join(" ") };
      const own = el.getAttribute("aria-label");
      return { probe: String(i), how: describe, label: own ? own.replace(/\s+/g, " ").trim() : null };
    });
  }, [FIELDS, PROBE] as const);
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const fields: Field[] = [];
    for (const f of found) {
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: `[${PROBE}="${f.probe}"]` });
      const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
      const name = String(nodes[0]?.name?.value ?? "").replace(/\s+/g, " ").trim();
      fields.push({ ...f, name });
    }
    return fields;
  } finally {
    await cdp.detach();
  }
}

async function problems(page: Page): Promise<string[]> {
  const fields = await shownFields(page);
  const found: string[] = [];
  const names = new Map<string, number>();
  for (const f of fields) names.set(f.name, (names.get(f.name) || 0) + 1);
  for (const f of fields) {
    const which = `${f.how} "${f.name || f.label || ""}"`;
    if (!f.name) { found.push(`${which}: no name`); continue; }
    if (f.label === null) found.push(`${which}: named by no label, only "${f.name}"`);
    else if (f.name.replace(/\s/g, "") !== f.label.replace(/\s/g, "")) found.push(`${which}: named "${f.name}", but its label reads "${f.label}"`);
    if (names.get(f.name)! > 1) { found.push(`${which}: ${names.get(f.name)} fields share this name`); continue; }
    const byLabel = page.getByLabel(f.name, { exact: true });
    const count = await byLabel.count();
    if (count !== 1) found.push(`${which}: getByLabel finds ${count} fields`);
    else if ((await byLabel.getAttribute(PROBE)) !== f.probe) found.push(`${which}: getByLabel finds another field`);
  }
  return found;
}

async function openSettings(page: Page, base: string) {
  await page.goto(base + "/dashboard/settings");
  await page.getByRole("heading", { name: "Backup AI", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Test and connect as backup", exact: true }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Test and connect", exact: true }).waitFor({ timeout: 30_000 });
  await page.waitForLoadState("networkidle");
  // Fields in a closed section are on the page too.
  await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
}

describe("the Settings page names every field by its label", () => {
  let dist: string;
  let browser: Browser;
  let notebook: RealNotebook;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "settings-field-names-"));
    await buildUi(join(dist, "dist"));
    browser = await launch();
    notebook = await startNotebook({ uiRoot: join(dist, "dist") });
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await notebook?.stop();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  for (const viewport of WIDTHS) {
    async function onPage(saved: boolean, check: (page: Page) => Promise<void>) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        await showEverything(page, saved);
        await openSettings(page, notebook.base);
        await check(page);
      } finally {
        // Let a request a route handler still has running (the /api/status fetch) finish before the
        // context goes, so it cannot reject as "Request context disposed" after the test ends.
        await Promise.all(context.pages().map((p) => p.unrouteAll({ behavior: "wait" }))).catch(() => {});
        await context.close();
      }
    }

    it(`as it opens, at ${viewport.width} px`, async () => {
      await onPage(false, async (page) => {
        expect(await problems(page)).toEqual([]);
        // The fields #753 names, found by their label text alone.
        for (const label of ["Your AI service", "Model, written the way your service writes it", "Key", "Use it for the daily routines and the chat too.",
          "Backup AI service", "Backup model, written the way your service writes it", "Backup key"]) {
          expect(await page.getByLabel(label, { exact: true }).count(), label).toBe(1);
        }
        await expect(page.getByLabel("Your AI service", { exact: true }).evaluate((el) => el.closest("form")?.getAttribute("aria-label"))).resolves.not.toBe("Connect a backup AI");
      });
    }, 120_000);

    it(`after choosing Another service in both forms, at ${viewport.width} px`, async () => {
      await onPage(false, async (page) => {
        await page.getByLabel("Your AI service", { exact: true }).selectOption("other");
        await page.getByLabel("Backup AI service", { exact: true }).selectOption("other");
        expect(await problems(page)).toEqual([]);
        expect(await page.getByLabel("Its address, as the service gives it (OpenAI-compatible)", { exact: true }).count()).toBe(1);
        expect(await page.getByLabel("Backup AI address, as the service gives it (OpenAI-compatible)", { exact: true }).count()).toBe(1);
      });
    }, 120_000);

    it(`with a saved connection and a saved backup, at ${viewport.width} px`, async () => {
      await onPage(true, async (page) => {
        await page.getByLabel("Key (leave it empty to keep the saved one)", { exact: true }).waitFor({ timeout: 10_000 });
        expect(await problems(page)).toEqual([]);
        await expect(page.getByLabel("Its address, as the service gives it (OpenAI-compatible)", { exact: true }).inputValue()).resolves.toBe("https://ai.example.test/v1/chat/completions");
      });
    }, 120_000);
  }
});
