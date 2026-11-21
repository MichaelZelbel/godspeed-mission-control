import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { BRAIN_PAGE } from "@/lib/brain-page";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";
// The seed's habit is a coach file, the one owner of its days (habit-trackers.mjs), so it is written
// with the coach's own writer, the way a chat's "track walk to work" makes one.
import { addArea } from "../../../third-party/addons/godspeed-coach/lib/areas.mjs";
import { addHabit } from "../../../third-party/addons/godspeed-coach/lib/habits.mjs";
// The id the product serves a habit under is the tracker's own (`habit-<area>-<slug>`), so the
// seed reads it from there instead of re-declaring the format.
import { habitId } from "../../core/habit-trackers.mjs";

// One check over every page the router serves, at 320, 375, 768 and 1280 px, on an empty workspace
// and on one with an item of every kind the router shows a page for (note, person, moment, media,
// group, collection with an item, world item, habit), each named in one long unbroken word and in
// one long name with spaces (#734, #887). It drives the built notebook in a real browser and fails
// on:
//   - text that is cut off, an input's placeholder included (an enabled input's value is not cut
//     off: the input scrolls it; a disabled input cannot scroll, so its value counts);
//   - text drawn under another element, a fixed or floating element included (what is painted at
//     the middle of the text is something else);
//   - a field with no name a screen reader can read, or a label that names no field;
// on each page, in the dialog its main add button opens, and in every role=tab view on it. Text cut
// off at one width was fixed one component at a time five times (#502, #553, #573, #728, #733), and
// unnamed fields twice (#697, #732). No page, rule or element is exempt: a false alarm is fixed in
// the rule, with a case below that shows it.

const UI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGE_AUDIT = readFileSync(fileURLToPath(new URL("./test/layout-audit-page.js", import.meta.url)), "utf8");

type Finding = { rule: string; element: string };
type Seeded = {
  note: string;
  person: string;
  group: string;
  groupSlug: string;
  world: string;
  collection: string;
  collectionSlug: string;
  collectionItem: string;
  habit: string;
  habitUnbroken: string;
};
type RouteCheck = {
  pattern: string;
  /** The addresses to open: on the empty workspace `seeded` is null. */
  urls: (seeded: Seeded | null) => string[];
  /** A redirect: where it must land. The page there is checked under its own pattern. */
  redirectsTo?: string;
  /** The accessible name of the page's main add button, when it opens a dialog. The first name that is on the page wins: an empty workspace shows a different one than a filled one. */
  addButton?: string | string[];
};

const MISSING = "missing";
const ROUTES: RouteCheck[] = [
  { pattern: "/setup", urls: () => ["/setup"] },
  { pattern: "/shared/:token", urls: () => [`/shared/${MISSING}`] },
  { pattern: "/", urls: () => ["/"], redirectsTo: "/dashboard" },
  { pattern: "/dashboard", urls: () => ["/dashboard"] },
  { pattern: "/dashboard/chat", urls: () => ["/dashboard/chat"] },
  { pattern: "/dashboard/control", urls: () => ["/dashboard/control"], redirectsTo: "/dashboard" },
  { pattern: "/dashboard/notes/*", urls: (s) => (s ? ["/dashboard/notes", `/dashboard/notes/${s.note}`] : ["/dashboard/notes"]) },
  { pattern: "/dashboard/goals", urls: () => ["/dashboard/goals"] },
  { pattern: "/dashboard/settings", urls: () => ["/dashboard/settings"] },
  { pattern: "/settings", urls: () => ["/settings"] },
  { pattern: "/dashboard/settings/import", urls: () => ["/dashboard/settings/import"] },
  { pattern: "/dashboard/telegram", urls: () => ["/dashboard/telegram"] },
  { pattern: "/dashboard/people", urls: () => ["/dashboard/people"], addButton: "Add person" },
  { pattern: "/dashboard/people/:id", urls: (s) => [`/dashboard/people/${s ? s.person : MISSING}`] },
  { pattern: "/dashboard/world", urls: () => ["/dashboard/world"] },
  { pattern: "/dashboard/world/:id", urls: (s) => [s ? `/dashboard/world/${s.world}` : `/dashboard/world/${MISSING}`] },
  { pattern: "/dashboard/profile", urls: () => ["/dashboard/profile"] },
  { pattern: BRAIN_PAGE.path, urls: () => [BRAIN_PAGE.path], addButton: "Add a rule" },
  { pattern: BRAIN_PAGE.oldPath, urls: () => [BRAIN_PAGE.oldPath], redirectsTo: BRAIN_PAGE.path },
  { pattern: "/dashboard/timeline", urls: () => ["/dashboard/timeline"], addButton: "Add Moment" },
  { pattern: "/dashboard/media", urls: () => ["/dashboard/media"] },
  { pattern: "/dashboard/review-queue", urls: () => ["/dashboard/review-queue"] },
  { pattern: "/dashboard/groups", urls: () => ["/dashboard/groups"], addButton: "New Group" },
  { pattern: "/dashboard/groups/:slug", urls: (s) => [s ? `/dashboard/groups/${s.groupSlug}` : `/dashboard/groups/${MISSING}`] },
  { pattern: "/dashboard/actions", urls: () => ["/dashboard/actions"], addButton: "Add Action" },
  { pattern: "/dashboard/activity", urls: () => ["/dashboard/activity"] },
  { pattern: "/dashboard/review", urls: () => ["/dashboard/review"] },
  { pattern: "/collections", urls: () => ["/collections"], addButton: ["or create a blank collection", "New blank collection"] },
  { pattern: "/collections/templates", urls: () => ["/collections/templates"] },
  { pattern: "/collections/:slug/schema", urls: (s) => [`/collections/${s ? s.collectionSlug : MISSING}/schema`] },
  { pattern: "/collections/:slug/:itemId", urls: (s) => [s ? `/collections/${s.collectionSlug}/${s.collectionItem}` : `/collections/${MISSING}/${MISSING}`] },
  { pattern: "/collections/:slug", urls: (s) => [`/collections/${s ? s.collectionSlug : MISSING}`] },
  { pattern: "/trackers/habits/:id", urls: (s) => (s ? [`/trackers/habits/${s.habit}`, `/trackers/habits/${s.habitUnbroken}`] : [`/trackers/habits/${MISSING}`]) },
  { pattern: "/dashboard/graph", urls: () => ["/dashboard/graph"] },
  { pattern: "/:name/*", urls: () => ["/timeline"], redirectsTo: "/dashboard/timeline" },
  { pattern: "*", urls: () => ["/no-such-page"] },
];

// Every route the router declares, read from App.tsx itself.
function routerPaths(): string[] {
  const app = readFileSync(join(UI_ROOT, "src/App.tsx"), "utf8");
  const brain: Record<string, string> = { "BRAIN_PAGE.path": BRAIN_PAGE.path, "BRAIN_PAGE.oldPath": BRAIN_PAGE.oldPath };
  return [...app.matchAll(/<Route\s+path=(?:"([^"]+)"|\{([\w.]+)\})/g)].map(([, literal, name]) => literal ?? brain[name] ?? `{${name}}`);
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

// A 1x1 PNG padded past the 50 MB carry limit (shared/media-limits.mjs), so its Media Library card
// shows "Kept on this computer only", the badge #728 was about.
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// The seed's names. Every kind of item gets one name that is a single long word, so only word
// breaking can keep it inside a card or row (#871), and one long name with spaces, so only
// wrapping between words can. The collection's name is the longest the product makes: the form
// refuses more than 60 characters.
const UNBROKEN = "Dampfschifffahrtsgesellschaftsvorstand";
const SPACED = "Quarterly review of the community orchard volunteers and the shared harvest ledger";
const COLLECTION_SPACED = "Long reading list of books about cities and their makers";

async function seed(notebook: RealNotebook): Promise<Seeded> {
  const insert = (table: string, values: Record<string, unknown>, selection = "id") => notebook.query({ table, operation: "insert", values, selection, single: true });
  if (UNBROKEN.length < 30 || SPACED.length < 70 || COLLECTION_SPACED.length > 60) throw new Error("the seed's names are not the long names the check must see");
  const note = await insert("notes", { title: "Trip to Lisbon", content: "Book the train." });
  await insert("notes", { title: UNBROKEN, content: "Break the word, not the page." });
  await insert("notes", { title: SPACED, content: "Wrap between the words." });
  const person = await insert("contacts", { name: "Ada Lovelace" });
  await insert("contacts", { name: UNBROKEN });
  await insert("contacts", { name: SPACED });
  // A group whose name does not fit one line on any width: a card that clips it (#867) is what the
  // audit's clipped-text rule must flag on the groups page.
  const group = await insert("contact_groups", { name: "Seed round investors for the 2027 expansion" }, "id,slug");
  // And one whose name holds a word no box fits, so word breaking, not wrapping between words, is
  // what keeps it inside the card and the people tree's row (#867).
  const unbroken = await insert("contact_groups", { name: "Donaudampfschifffahrtsgesellschaft Investoren" });
  if (!unbroken.id) throw new Error("the unbroken-name group did not insert");
  await insert("moments", { title: "Lunch with Ada", happened_at: "2026-11-10", status: "happened", impact_level: 2, person_id: person.id, source: "manual" });
  await insert("moments", { title: UNBROKEN, happened_at: "2026-11-11", status: "happened", impact_level: 2, person_id: person.id, source: "manual" });
  await insert("moments", { title: SPACED, happened_at: "2026-11-12", status: "happened", impact_level: 2, person_id: person.id, source: "manual" });
  const form = new FormData();
  form.append("file", new Blob([PIXEL, Buffer.alloc(51 * 1024 * 1024)], { type: "image/png" }), "photo.png");
  form.append("path", `owner/${note.id}/photo.png`);
  const response = await fetch(`${notebook.base}/api/media/upload?bucket=note-attachments`, { method: "POST", body: form });
  const upload = await response.json();
  if (!response.ok) throw new Error(`The media upload failed: ${JSON.stringify(upload)}`);
  await insert("media_analysis", { note_id: note.id, storage_path: upload.data.path, media_type: "image", original_filename: "photo.png", analysis_status: "complete", description: "A photo", topics: [] });
  // Media with no note keeps its file's own name as the card's title (MediaLibrary.tsx). Each file of
  // its own path: rows of one path are pages of one document, not cards of their own.
  for (const [file, name] of [[UNBROKEN, UNBROKEN], ["spaced", SPACED]] as const) {
    const own = new FormData();
    own.append("file", new Blob([PIXEL], { type: "image/png" }), "pixel.png");
    own.append("path", `owner/media/${file}.png`);
    const ownResponse = await fetch(`${notebook.base}/api/media/upload?bucket=note-attachments`, { method: "POST", body: own });
    const ownUpload = await ownResponse.json();
    if (!ownResponse.ok) throw new Error(`The media upload failed: ${JSON.stringify(ownUpload)}`);
    await insert("media_analysis", { storage_path: ownUpload.data.path, media_type: "image", original_filename: `${name}.png`, analysis_status: "complete", description: "A photo", topics: [] });
  }
  // A collection with an item, so /collections/:slug, its /schema page and an item's own page all
  // open on the seeded workspace: the empty collection's own empty state is what the empty
  // workspace run already checks.
  const collection = await insert("collections", { name: UNBROKEN, slug: UNBROKEN.toLowerCase(), visibility: "personal", field_schema: [] }, "id,slug");
  const collectionItem = await insert("collection_items", { collection_id: collection.id, title: UNBROKEN, data: {} });
  const spacedCollection = await insert("collections", { name: COLLECTION_SPACED, slug: COLLECTION_SPACED.toLowerCase().replace(/[^a-z0-9]+/g, "-"), visibility: "personal", field_schema: [] }, "id,slug");
  await insert("collection_items", { collection_id: spacedCollection.id, title: SPACED, data: {} });
  const world = await insert("entities", { name: UNBROKEN, entity_type: "place" });
  await insert("entities", { name: SPACED, entity_type: "place" });
  addArea(notebook.root, { slug: "health", title: "Health", rhythm: "weekly sunday", starts: "2026-11-01" });
  const habit = await addHabit(notebook.root, { area: "health", title: SPACED, doneMeans: "walked", days: "daily" }, "2026-11-01");
  if (!habit.file) throw new Error("the seeded habit did not get a coach file");
  const unbrokenHabit = await addHabit(notebook.root, { area: "health", title: UNBROKEN, doneMeans: "walked", days: "daily" }, "2026-11-01");
  if (!unbrokenHabit.file) throw new Error("the seeded unbroken habit did not get a coach file");
  return { note: note.id, person: person.id, group: group.id, groupSlug: group.slug, world: world.id, collection: collection.id, collectionSlug: collection.slug, collectionItem: collectionItem.id, habit: habitId(habit), habitUnbroken: habitId(unbrokenHabit) };
}

// Loaded: no request in flight, fonts in, no sign-in or loading spinner, and no animation still on
// its way (a spinner's endless turn is not on its way anywhere).
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.body.innerText.includes("Checking your sign-in…") && !document.body.innerText.includes("Opening...") && !document.querySelector(".animate-spin"));
  await settleAnimations(page);
}

async function settleAnimations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity));
}

const FIELDS = "input:not([type=hidden]), select, textarea, [role=slider], [role=combobox], [role=textbox], [role=searchbox], [role=spinbutton]";

// Runs on a field as `this`: its description when it is shown, otherwise null.
const SHOWN_FIELD = `function () {
  if (this.closest('[aria-hidden="true"],[inert]')) return null;
  if (!this.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return null;
  const box = this.getBoundingClientRect();
  if (!(box.width > 0 && box.height > 0)) return null;
  for (let e = this; e && e !== document.body; e = e.parentElement) {
    const style = getComputedStyle(e), r = e.getBoundingClientRect();
    if (style.position === "absolute" && r.width <= 1 && r.height <= 1 && (style.clip === "rect(0px, 0px, 0px, 0px)" || style.overflow === "hidden")) return null;
  }
  const text = this.getAttribute("aria-label") || this.getAttribute("placeholder") || this.textContent || "";
  return (this.getAttribute("role") || this.tagName.toLowerCase()) + ' "' + text.replace(/\\s+/g, " ").trim().slice(0, 60) + '"';
}`;

// Names as a screen reader gets them, from Chrome's accessibility tree.
async function unnamedFields(cdp: CDPSession): Promise<Finding[]> {
  const found: Finding[] = [];
  const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: FIELDS });
  for (const nodeId of nodeIds) {
    const { object } = await cdp.send("DOM.resolveNode", { nodeId });
    const shown = await cdp.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: SHOWN_FIELD, returnByValue: true });
    if (!shown.result.value) continue;
    const { nodes } = await cdp.send("Accessibility.getPartialAXTree", { nodeId, fetchRelatives: false });
    if (nodes[0]?.ignored) continue;
    if (!String(nodes[0]?.name?.value ?? "").trim()) found.push({ rule: "no name", element: shown.result.value });
  }
  return found;
}

function labelsNamingNothing(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const referenced = new Set([...document.querySelectorAll("[aria-labelledby]")].flatMap((el) => el.getAttribute("aria-labelledby")!.split(/\s+/)));
    return [...document.querySelectorAll("label")]
      .filter((label) => !label.closest('[aria-hidden="true"],[inert]') && label.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
      .filter((label) => { const box = label.getBoundingClientRect(); return box.width > 0 && box.height > 0; })
      .filter((label) => !label.control && !(label.id && referenced.has(label.id)))
      .map((label) => ({ rule: "label names no field", element: `label "${(label.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)}"` }));
  });
}

async function auditShown(page: Page, cdp: CDPSession): Promise<Finding[]> {
  const inPage: Finding[] = await page.evaluate(PAGE_AUDIT);
  return [...inPage, ...(await unnamedFields(cdp)), ...(await labelsNamingNothing(page))];
}

async function auditPage(page: Page, cdp: CDPSession, base: string, url: string, route: RouteCheck): Promise<Finding[]> {
  await page.goto(base + url);
  await settle(page);
  if (route.redirectsTo) {
    const landed = new URL(page.url()).pathname;
    return landed === route.redirectsTo ? [] : [{ rule: "redirect", element: `lands on ${landed}, not ${route.redirectsTo}` }];
  }
  const found = await auditShown(page, cdp);
  // Every view the page shows through its tabs (only the page's own: a hidden tab in a dialog is
  // not visible and is checked when that dialog opens).
  const tabs = page.locator('[role="tab"]');
  for (let i = 0; i < (await tabs.count()); i++) {
    const tab = tabs.nth(i);
    if (!(await tab.isVisible()) || (await tab.isDisabled())) continue;
    const name = ((await tab.textContent()) ?? "").trim();
    await tab.click();
    await settle(page);
    for (const f of await auditShown(page, cdp)) found.push({ ...f, element: `tab "${name}": ${f.element}` });
  }
  if (!route.addButton) return found;
  const names = Array.isArray(route.addButton) ? route.addButton : [route.addButton];
  let button = null as ReturnType<Page["getByRole"]> | null;
  let name = "";
  for (const candidate of names) {
    const foundButton = page.getByRole("button", { name: candidate, exact: true }).first();
    if (await foundButton.count()) { button = foundButton; name = candidate; break; }
  }
  if (!button) return [...found, { rule: "add button", element: `no button ${names.map((n) => `"${n}"`).join(" or ")}` }];
  await button.click();
  const opened = await page.getByRole("dialog").first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (!opened) return [...found, { rule: "add button", element: `"${name}" opened no dialog` }];
  await settleAnimations(page);
  const inDialog = (await auditShown(page, cdp)).map((f) => ({ ...f, rule: `in the "${name}" dialog: ${f.rule}` }));
  await page.keyboard.press("Escape");
  return [...found, ...inDialog];
}

const WIDTHS = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 900 },
];

async function auditEveryPage(browser: Browser, notebook: RealNotebook, seeded: Seeded | null, viewport: { width: number; height: number }) {
  const workspace = seeded ? "seeded" : "empty";
  const stable = (url: string) =>
    seeded
      ? url
          .replace(seeded.note, "<note>")
          .replace(seeded.person, "<person>")
          .replace(seeded.groupSlug, "<group>")
          .replace(seeded.world, "<world>")
          .replace(seeded.collectionItem, "<item>")
          .replace(seeded.collectionSlug, "<collection>")
          .replace(seeded.habit, "<habit>")
          .replace(seeded.habitUnbroken, "<habit>")
      : url;
  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const failures: string[] = [];
    for (const route of ROUTES) {
      for (const url of route.urls(seeded)) {
        const lines = (await auditPage(page, cdp, notebook.base, url, route))
          .map((f) => `${stable(url)} at ${viewport.width} px, ${workspace} workspace: ${f.rule}: ${f.element}`);
        failures.push(...new Set(lines));
      }
    }
    return failures;
  } finally {
    await context.close();
  }
}

describe("the routes the check visits", () => {
  it("lists every route the router serves, and no other", () => {
    expect(ROUTES.map((r) => r.pattern).sort()).toEqual(routerPaths().sort());
  });
});

describe("the audit's rules on pages built for them", { timeout: 20_000 }, () => {
  let browser: Browser;
  // Each case opens a page in a real browser: about 50 ms alone, but the first one, which also pays for
  // the browser's first page, timed out at vitest's 5 s default in a busy CI job (#775). So a first page
  // is opened and closed here, under this hook's own limit, and each case gets 20 s.
  beforeAll(async () => {
    browser = await launch();
    await (await browser.newPage()).close();
  }, 60_000);
  afterAll(async () => { await browser?.close(); });

  async function audit(body: string, width = 375): Promise<string[]> {
    const page = await browser.newPage({ viewport: { width, height: 600 } });
    try {
      await page.setContent(`<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}</style></head><body>${body}</body></html>`);
      const cdp = await page.context().newCDPSession(page);
      return (await auditShown(page, cdp)).map((f) => `${f.rule}: ${f.element}`);
    } finally {
      await page.close();
    }
  }

  it("reports a truncated label in a box too narrow for it", async () => {
    expect(await audit(`<span style="display:block;width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Normal text</span>`))
      .toEqual(['clipped: span "Normal text"']);
  });

  it("reports a word spilling out of a narrow pill", async () => {
    expect(await audit(`<div style="display:inline-block;width:40px;white-space:nowrap">Kept on this computer only</div>`))
      .toEqual(['clipped: div "Kept on this computer only"']);
  });

  it("reports a label cut off by a narrower box around it", async () => {
    expect(await audit(`<div style="width:80px;overflow:hidden"><span style="white-space:nowrap">Kept on this computer only</span></div>`))
      .toEqual(['clipped: span "Kept on this computer only"']);
  });

  it("reports a label running past the edge of the window", async () => {
    expect(await audit(`<span style="white-space:nowrap;font-size:40px">Kept on this computer only</span>`))
      .toEqual(['clipped: span "Kept on this computer only"']);
  });

  it("reports a label running past the side of the page's main area", async () => {
    expect(await audit(`<main style="width:200px"><span style="white-space:nowrap;font-size:24px">Kept on this computer only</span></main>`))
      .toEqual(['clipped: span "Kept on this computer only"']);
  });

  // A paragraph whose box is sized by a script from its own text, so the case holds on any font: the
  // first line is "Kept on this " and the box ends `past` px before the end of `upTo` characters.
  const sizedParagraph = (upTo: number, past: number) => `<p id="sized" style="margin:0;white-space:pre-wrap">Kept on this computer only</p><script>
    const p = document.getElementById("sized"), range = document.createRange();
    range.setStart(p.firstChild, 0);
    range.setEnd(p.firstChild, ${upTo});
    p.style.width = (range.getBoundingClientRect().width - ${past}) + "px";
  </script>`;

  it("passes a wrapped line whose trailing space ends 1/64 px past its box", async () => {
    // The premise, as the rule saw it before #746: the line's hanging space ends past the box.
    const page = await browser.newPage({ viewport: { width: 375, height: 600 } });
    try {
      await page.setContent(`<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}</style></head><body>${sizedParagraph(13, 1 / 64)}</body></html>`);
      const { box, lineEnds } = await page.evaluate(() => {
        const p = document.getElementById("sized")!;
        const range = document.createRange();
        range.selectNodeContents(p.firstChild!);
        return { box: p.getBoundingClientRect().right, lineEnds: [...range.getClientRects()].map((r) => r.right) };
      });
      expect(Math.max(...lineEnds) - box).toBeCloseTo(1 / 64, 6);
    } finally {
      await page.close();
    }
    expect(await audit(sizedParagraph(13, 1 / 64))).toEqual([]);
  });

  it("reports a wrapped line whose last glyph runs 1/64 px past its box", async () => {
    expect(await audit(sizedParagraph(4, 1 / 64))).toEqual(['clipped: p "Kept on this computer only"']);
  });

  it("reports an input whose placeholder does not fit", async () => {
    const [line] = await audit(`<input aria-label="Search" placeholder="Search every note you ever wrote" style="width:80px">`);
    expect(line).toMatch(/^clipped: input "Search": its text needs [\d.]+ px, the box has [\d.]+$/);
  });

  it("passes an input whose value is longer than its box, and still reports the placeholder", async () => {
    // An enabled input scrolls its own value (the group's name does this in its edit form, #887);
    // a placeholder has nothing typed into it and nothing to scroll it into view with.
    expect(await audit(`<input aria-label="Name" placeholder="Short" value="Supercalifragilisticexpialidociousgroupname" style="width:80px">`))
      .toEqual([]);
    expect(await audit(`<input aria-label="Search" placeholder="Search every note you ever wrote" value="Typed" style="width:80px">`))
      .toHaveLength(1);
  });

  it("reports a disabled input whose value is longer than its box", async () => {
    // A disabled input cannot take focus, so nothing scrolls its value into view: it is measured
    // like a placeholder (the settings page's disabled email field, #887).
    expect(await audit(`<input aria-label="Email" value="ada.lovelace@looming-largescaleanalyticalengine.works" disabled style="width:80px">`))
      .toHaveLength(1);
  });

  it("reports text with a badge drawn over it", async () => {
    expect(await audit(`<div style="position:relative"><p style="margin:0">A paragraph</p><span style="position:absolute;left:0;top:0;width:200px;height:20px;background:red"></span></div>`))
      .toEqual(['under another element: p "A paragraph" under span ""']);
  });

  it("reports text a fixed element draws over, the floating chat button included", async () => {
    // A fixed cover sits over the window at every scroll, so the sticky-header scroll cannot move
    // the text out from under it: the floating chat button over a card is what this reports (#887).
    expect(await audit(`<div style="height:550px"></div><p style="margin:0">A paragraph</p><button style="position:fixed;bottom:10px;left:0;width:200px;height:60px;background:red">Chat</button>`))
      .toEqual(['under another element: p "A paragraph" under button "Chat"']);
  });

  it("reports a field with no name and a label that names no field", async () => {
    expect(await audit(`<input><label>Lonely</label>`)).toEqual(['no name: input ""', 'label names no field: label "Lonely"']);
  });

  it("passes screen-reader-only text and a leading-none label", async () => {
    expect(await audit(`<button><span class="sr-only">Close the dialog now</span>x</button><label for="f" style="display:block;line-height:1;font-size:14px">Title</label><input id="f">`))
      .toEqual([]);
  });

  it("passes a tab in a sideways scroller that runs past the window", async () => {
    const tabs = Array.from({ length: 12 }, (_, i) => `<button style="flex:none;width:80px">Tab ${i}</button>`).join("");
    expect(await audit(`<div style="display:flex;overflow-x:auto">${tabs}</div>`)).toEqual([]);
  });

  it("passes text a scroll moved under a sticky header, with room to scroll it back", async () => {
    expect(await audit(`<div style="height:200px;overflow:auto"><h2 style="position:sticky;top:0;margin:0;background:white">Title</h2><div style="height:150px"></div><p>Under the title once scrolled</p><div style="height:400px"></div></div>`))
      .toEqual([]);
  });

  it("passes text a tall sticky header covers at the center, when a scroll can put it below it", async () => {
    // The person page's sticky header is nearly half a phone's height (#887): the rule centers the
    // text, which puts it under a header this tall, so the rule tries the scroll that puts the text
    // just below the header before it reports.
    expect(await audit(`<div style="height:200px;overflow:auto"><h2 style="position:sticky;top:0;margin:0;background:white;height:120px">Title</h2><p>Halfway down</p><div style="height:400px"></div></div>`))
      .toEqual([]);
  });

  it("passes a label tied with for, one referenced by aria-labelledby, and a field in a closed details", async () => {
    expect(await audit(`<label for="a">Name</label><input id="a"><label id="b">Strength</label><span role="slider" aria-labelledby="b" aria-valuenow="1" tabindex="0" style="display:inline-block;width:20px;height:20px;background:gray"></span><details><summary>More</summary><input></details>`))
      .toEqual([]);
  });
});

describe("every page at a phone's and a desktop's width", () => {
  let browser: Browser;
  let dist: string;
  let empty: RealNotebook;
  let seededNotebook: RealNotebook;
  let seeded: Seeded;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "layout-audit-"));
    await buildUi(join(dist, "dist"));
    browser = await launch();
    empty = await startNotebook({ uiRoot: join(dist, "dist") });
    seededNotebook = await startNotebook({ uiRoot: join(dist, "dist") });
    seeded = await seed(seededNotebook);
  }, 240_000);

  afterAll(async () => {
    await browser?.close();
    await empty?.stop();
    await seededNotebook?.stop();
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  for (const viewport of WIDTHS) {
    it(`finds nothing cut off, covered or unnamed on an empty workspace at ${viewport.width} px`, async () => {
      const failures = await auditEveryPage(browser, empty, null, viewport);
      expect(failures, failures.join("\n")).toEqual([]);
    }, 240_000);

    it(`finds nothing cut off, covered or unnamed on a seeded workspace at ${viewport.width} px`, async () => {
      // A seed that did not show would make this a second empty run. Every seeded detail route
      // shows the item it was seeded with, not its missing state: a stale id would make the audit
      // below audit a "not found" page, which none of its rules would report.
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        for (const [url, ...texts] of [
          ["/dashboard/timeline", "Lunch with Ada"],
          ["/dashboard/people", "Ada Lovelace"],
          ["/dashboard/media", "Kept on this computer only"],
          ["/dashboard/notes", "Trip to Lisbon"],
          [`/dashboard/notes/${seeded.note}`, "Book the train."],
          [`/dashboard/people/${seeded.person}`, "Ada Lovelace"],
          [`/dashboard/groups/${seeded.groupSlug}`, "Seed round investors for the 2027 expansion"],
          [`/dashboard/world/${seeded.world}`, UNBROKEN],
          ["/dashboard/world", UNBROKEN, SPACED],
          [`/collections/${seeded.collectionSlug}`, UNBROKEN],
          [`/collections/${seeded.collectionSlug}/schema`, UNBROKEN],
          [`/collections/${seeded.collectionSlug}/${seeded.collectionItem}`, UNBROKEN],
          [`/trackers/habits/${seeded.habit}`, SPACED],
          [`/trackers/habits/${seeded.habitUnbroken}`, UNBROKEN],
          ["/collections", COLLECTION_SPACED],
          ["/dashboard/media", `${UNBROKEN}.png`],
        ]) {
          await page.goto(seededNotebook.base + url);
          // The first match in the DOM may be a hidden pane (a tree beside the open detail), so a
          // visible one is what proves the page shows the item.
          for (const text of texts) await page.getByText(text).filter({ visible: true }).first().waitFor({ timeout: 15_000 });
        }
      } finally {
        await context.close();
      }
      const failures = await auditEveryPage(browser, seededNotebook, seeded, viewport);
      expect(failures, failures.join("\n")).toEqual([]);
    }, 240_000);
  }

  // The group page with a real, long name (#863): the audit above meets it only as "group not
  // found", because the seed has no group. The seed is not given one here either: the list page's
  // cards clip a long name at both widths, which is a fault of its own, apart from this fix, and
  // would turn the page-wide check red for something this change does not touch. So the header is
  // checked on its own: the audit's rules on the name and the two buttons, and the name's whole
  // box against each button's box, at a phone's width and at 320 px, the narrowest phone the
  // header must hold. On main this fails: the buttons squeezed the name to one letter.
  it("shows a group's whole name with its Add Member and Edit buttons at a phone's width", async () => {
    const name = "Seed round investors for the 2027 expansion";
    const group = await seededNotebook.query({ table: "contact_groups", operation: "insert", values: { name }, selection: "id,slug", single: true });
    expect(group?.slug ?? null).toBeTruthy();
    const failures: string[] = [];
    for (const viewport of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await page.goto(`${seededNotebook.base}/dashboard/groups/${group.slug}`);
        await settle(page);
        // The audit's rules, read only on the name and the two buttons.
        const headerNames = [`h1 "${name}"`, 'button "Add Member"', 'button "Edit"'];
        const found = (await auditShown(page, cdp)).filter((f) => headerNames.some((n) => f.element.startsWith(n)));
        failures.push(...found.map((f) => `${viewport.width} px, ${f.rule}: ${f.element}`));
        // And the boxes themselves: the name's whole box against each button's whole box.
        const overlap = await page.evaluate((nm) => {
          const h1 = [...document.querySelectorAll("h1")].find((e) => e.textContent === nm);
          const button = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
          if (!h1 || !button("Add Member") || !button("Edit")) return "the name or a button is missing";
          const intersect = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
          const box = (e) => e.getBoundingClientRect();
          for (const t of ["Add Member", "Edit"]) {
            if (intersect(box(h1), box(button(t)))) return `"${t}" overlaps the name`;
          }
          return box(h1).left >= 0 && box(h1).right <= innerWidth ? null : "the name runs past the screen";
        }, name);
        if (overlap) failures.push(`${viewport.width} px: ${overlap}`);
      } finally {
        await context.close();
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 60_000);

  // The dashboard's top bar at 320 px, the narrowest phone the header must hold (#868): on main the
  // bar's other controls squeezed the search box to 77 px wide, and the box's own paddings left
  // 5 px of that for text, so the placeholder "Search" clipped. The page-wide check above meets the bar only at 375 and
  // 1280 px, where the box still fits, so the box is checked on its own here, on a page every
  // dashboard page shares: the audit's rules on the search box, and the audit's own room measure
  // (the box less its borders and paddings) against the width its text needs.
  it("shows the top bar's search box with room for its text at 320 px", async () => {
    const failures: string[] = [];
    for (const viewport of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await page.goto(`${empty.base}/dashboard`);
        await settle(page);
        // Only the top bar's search box: a fault anywhere else on the page at 320 px is apart from
        // this fix, as a group card's clipped name was (#867).
        const found = (await auditShown(page, cdp)).filter((f) => f.element.startsWith('input "Search'));
        failures.push(...found.map((f) => `${viewport.width} px, ${f.rule}: ${f.element}`));
        const room = await page.evaluate(() => {
          const input = document.querySelector<HTMLInputElement>('input[aria-label="Search notes"]');
          if (!input) return null;
          const style = getComputedStyle(input);
          const ruler = document.createElement("span");
          for (const key of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "textTransform", "fontStretch", "wordSpacing"]) {
            (ruler.style as any)[key] = style[key];
          }
          Object.assign(ruler.style, { position: "absolute", whiteSpace: "pre", visibility: "hidden" });
          ruler.textContent = input.value || input.placeholder || "";
          document.body.appendChild(ruler);
          const need = ruler.getBoundingClientRect().width;
          ruler.remove();
          // Not input.clientWidth: on an input Chrome leaves the padding out of it.
          const spare = input.getBoundingClientRect().width
            - ["borderLeftWidth", "borderRightWidth", "paddingLeft", "paddingRight"].reduce((sum, key) => sum + parseFloat((style as any)[key]), 0);
          return { need, spare };
        });
        if (!room) failures.push(`${viewport.width} px: the search box is missing`);
        else if (room.need > room.spare) {
          failures.push(`${viewport.width} px: clipped: the search box's text needs ${room.need.toFixed(1)} px, the box has ${room.spare.toFixed(1)}`);
        }
      } finally {
        await context.close();
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 60_000);

  // A name that is one long word with no spaces (#871): break-words alone does not let a flex item
  // shrink below its longest word, so on main the name runs past the screen edge instead of
  // wrapping. Checked at 320 px, the narrowest phone the header must hold, and at 375 px, the width
  // the fault was seen at. On main this fails: the name runs past the screen edge.
  it("wraps a group name that is one long word at a phone's width", async () => {
    const name = "Supercalifragilisticexpialidociousgroups";
    expect(name.length).toBe(40);
    const group = await seededNotebook.query({ table: "contact_groups", operation: "insert", values: { name }, selection: "id,slug", single: true });
    expect(group?.slug ?? null).toBeTruthy();
    const failures: string[] = [];
    for (const viewport of [{ width: 375, height: 812 }, { width: 320, height: 568 }]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await page.goto(`${seededNotebook.base}/dashboard/groups/${group.slug}`);
        await settle(page);
        const found = (await auditShown(page, cdp)).filter((f) => f.element.startsWith(`h1 "${name}"`));
        failures.push(...found.map((f) => `${viewport.width} px, ${f.rule}: ${f.element}`));
        // The name's whole box inside the screen: the audit's rules read the shown text, this reads
        // the element's own box, which keeps its shrunken flex width even when the word overflows it.
        const off = await page.evaluate((nm) => {
          const h1 = [...document.querySelectorAll("h1")].find((e) => e.textContent === nm);
          if (!h1) return "the name is missing";
          const box = h1.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth && box.width > 0 ? null : `the name's box spans ${Math.round(box.left)} to ${Math.round(box.right)} on a ${innerWidth} px screen`;
        }, name);
        if (off) failures.push(`${viewport.width} px: ${off}`);
      } finally {
        await context.close();
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 60_000);
});
