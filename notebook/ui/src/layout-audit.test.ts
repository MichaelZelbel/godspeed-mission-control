import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { BRAIN_PAGE } from "@/lib/brain-page";
import { startNotebook, type RealNotebook } from "@/test/real-notebook";

// One check over every page the router serves, at a phone's width and a desktop's width, on an empty
// workspace and on one with a note, a person, a moment and a media item (#734). It drives the built
// notebook in a real browser and fails on:
//   - text that is cut off, an input's placeholder or value included;
//   - text drawn under another element (what is painted at the middle of the text is something else);
//   - a field with no name a screen reader can read, or a label that names no field;
// on each page and in the dialog its main add button opens. Text cut off at one width was fixed one
// component at a time five times (#502, #553, #573, #728, #733), and unnamed fields twice (#697, #732).
// No page, rule or element is exempt: a false alarm is fixed in the rule, with a case below that
// shows it.

const UI_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGE_AUDIT = readFileSync(fileURLToPath(new URL("./test/layout-audit-page.js", import.meta.url)), "utf8");

type Finding = { rule: string; element: string };
type Seeded = { note: string; person: string; group: string };
type RouteCheck = {
  pattern: string;
  /** The addresses to open: on the empty workspace `seeded` is null. */
  urls: (seeded: Seeded | null) => string[];
  /** A redirect: where it must land. The page there is checked under its own pattern. */
  redirectsTo?: string;
  /** The accessible name of the page's main add button, when it opens a dialog. */
  addButton?: string;
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
  { pattern: "/dashboard/world/:id", urls: () => [`/dashboard/world/${MISSING}`] },
  { pattern: "/dashboard/profile", urls: () => ["/dashboard/profile"] },
  { pattern: BRAIN_PAGE.path, urls: () => [BRAIN_PAGE.path], addButton: "Add a rule" },
  { pattern: BRAIN_PAGE.oldPath, urls: () => [BRAIN_PAGE.oldPath], redirectsTo: BRAIN_PAGE.path },
  { pattern: "/dashboard/timeline", urls: () => ["/dashboard/timeline"], addButton: "Add Moment" },
  { pattern: "/dashboard/media", urls: () => ["/dashboard/media"] },
  { pattern: "/dashboard/review-queue", urls: () => ["/dashboard/review-queue"] },
  { pattern: "/dashboard/groups", urls: () => ["/dashboard/groups"], addButton: "New Group" },
  { pattern: "/dashboard/groups/:slug", urls: () => [`/dashboard/groups/${MISSING}`] },
  { pattern: "/dashboard/actions", urls: () => ["/dashboard/actions"], addButton: "Add Action" },
  { pattern: "/dashboard/activity", urls: () => ["/dashboard/activity"] },
  { pattern: "/dashboard/review", urls: () => ["/dashboard/review"] },
  { pattern: "/collections", urls: () => ["/collections"], addButton: "or create a blank collection" },
  { pattern: "/collections/templates", urls: () => ["/collections/templates"] },
  { pattern: "/collections/:slug/schema", urls: () => [`/collections/${MISSING}/schema`] },
  { pattern: "/collections/:slug/:itemId", urls: () => [`/collections/${MISSING}/${MISSING}`] },
  { pattern: "/collections/:slug", urls: () => [`/collections/${MISSING}`] },
  { pattern: "/trackers/habits/:id", urls: () => [`/trackers/habits/${MISSING}`] },
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

async function seed(notebook: RealNotebook): Promise<Seeded> {
  const insert = (table: string, values: Record<string, unknown>) => notebook.query({ table, operation: "insert", values, selection: "id", single: true });
  const note = await insert("notes", { title: "Trip to Lisbon", content: "Book the train." });
  const person = await insert("contacts", { name: "Ada Lovelace" });
  // A group whose name does not fit one line on any width: a card that clips it (#867) is what the
  // audit's clipped-text rule must flag on the groups page.
  const group = await insert("contact_groups", { name: "Seed round investors for the 2027 expansion" });
  // And one whose name holds a word no box fits, so word breaking, not wrapping between words, is
  // what keeps it inside the card and the people tree's row (#867).
  const unbroken = await insert("contact_groups", { name: "Donaudampfschifffahrtsgesellschaft Investoren" });
  if (!unbroken.id) throw new Error("the unbroken-name group did not insert");
  await insert("moments", { title: "Lunch with Ada", happened_at: "2026-11-10", status: "happened", impact_level: 2, person_id: person.id, source: "manual" });
  const form = new FormData();
  form.append("file", new Blob([PIXEL, Buffer.alloc(51 * 1024 * 1024)], { type: "image/png" }), "photo.png");
  form.append("path", `owner/${note.id}/photo.png`);
  const response = await fetch(`${notebook.base}/api/media/upload?bucket=note-attachments`, { method: "POST", body: form });
  const upload = await response.json();
  if (!response.ok) throw new Error(`The media upload failed: ${JSON.stringify(upload)}`);
  await insert("media_analysis", { note_id: note.id, storage_path: upload.data.path, media_type: "image", original_filename: "photo.png", analysis_status: "complete", description: "A photo", topics: [] });
  return { note: note.id, person: person.id, group: group.id };
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
  if (!route.addButton) return found;
  const button = page.getByRole("button", { name: route.addButton, exact: true }).first();
  if (!(await button.count())) return [...found, { rule: "add button", element: `no button "${route.addButton}"` }];
  await button.click();
  const opened = await page.getByRole("dialog").first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (!opened) return [...found, { rule: "add button", element: `"${route.addButton}" opened no dialog` }];
  await settleAnimations(page);
  const inDialog = (await auditShown(page, cdp)).map((f) => ({ ...f, rule: `in the "${route.addButton}" dialog: ${f.rule}` }));
  await page.keyboard.press("Escape");
  return [...found, ...inDialog];
}

const WIDTHS = [{ width: 375, height: 812 }, { width: 1280, height: 900 }];

async function auditEveryPage(browser: Browser, notebook: RealNotebook, seeded: Seeded | null, viewport: { width: number; height: number }) {
  const workspace = seeded ? "seeded" : "empty";
  const stable = (url: string) => (seeded ? url.replace(seeded.note, "<note>").replace(seeded.person, "<person>") : url);
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

  it("reports text with a badge drawn over it", async () => {
    expect(await audit(`<div style="position:relative"><p style="margin:0">A paragraph</p><span style="position:absolute;left:0;top:0;width:200px;height:20px;background:red"></span></div>`))
      .toEqual(['under another element: p "A paragraph" under span ""']);
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

  // Centering a line lands it under a tall sticky header (the person page's header card is taller
  // than half its pane), but a smaller scroll shows the whole line clear. The rule must try that
  // scroll before it reports: on the centered position alone it flagged reachable text.
  it("passes text centered under a tall sticky header that a smaller scroll brings out", async () => {
    expect(await audit(`<div style="height:400px;overflow:auto"><div style="position:sticky;top:0;height:278px;background:white">Name, alias badges and buttons</div><div style="height:520px"></div><p style="margin:0">No relationships yet. Add one.</p><div style="height:400px"></div></div>`))
      .toEqual([]);
  });

  // The Manager decision on the scroll escape (#878) narrowed it to sticky covers: text under a
  // fixed, absolute or floating element is always reported, whatever any scroll shows. A scroll
  // moves a line past a fixed header and would show it clear, so under the old any-cover rule this
  // page passed while the line stays under the header at the position a person reads it.
  it("reports text under a fixed header no matter what a scroll would show", async () => {
    expect(await audit(`<div style="height:200px;overflow:auto"><h2 style="position:fixed;top:0;left:0;width:100%;height:120px;background:white">Title</h2><div style="height:150px"></div><p style="margin:0">Under the title once scrolled</p><div style="height:400px"></div></div>`))
      .toEqual(['under another element: p "Under the title once scrolled" under h2 "Title"']);
  });

  it("reports text under a sticky header no scroll can bring it out from", async () => {
    expect(await audit(`<div style="height:400px;overflow:auto"><h2 style="position:sticky;top:0;margin:0;height:100px;background:white">Title</h2><p style="margin:0;margin-top:-90px">Hidden behind the title</p></div>`))
      .toEqual(['under another element: p "Hidden behind the title" under h2 "Title"']);
  });

  // Room to scroll above the scroller lets its walk carry the line past its own top edge, where the
  // scroller clips it and hit-testing reaches only the ancestors above the scroller: the line paints
  // nowhere at any scroll, under the header when scrolled less, clipped entirely when scrolled more.
  // The escape must require the line itself to be hit where it stands, not a layout rect that sits
  // inside the viewport while nothing draws it.
  it("reports text a scroll clips out of its own scroller while it stays under a sticky header", async () => {
    expect(await audit(`<div style="height:200px"></div><div style="height:300px;overflow:auto"><h2 style="position:sticky;top:0;margin:0;height:100px;background:white">Title</h2><p style="margin:0;margin-top:-90px">Hidden behind the title</p><div style="height:600px"></div></div>`))
      .toEqual(['under another element: p "Hidden behind the title" under h2 "Title"']);
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
      // A seed that did not show would make this a second empty run.
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        for (const [url, ...texts] of [["/dashboard/timeline", "Lunch with Ada"], ["/dashboard/people", "Ada Lovelace"], ["/dashboard/media", "Kept on this computer only"], ["/dashboard/notes", "Trip to Lisbon"], ["/dashboard/groups", "Seed round investors for the 2027 expansion", "Donaudampfschifffahrtsgesellschaft Investoren"]]) {
          await page.goto(seededNotebook.base + url);
          for (const text of texts) await page.getByText(text).first().waitFor({ timeout: 15_000 });
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

  // A name too long for one line at desktop widths (#878): sm:truncate on the h1 kept it to one
  // line from 640 px up and ended it in "…", and nothing else on the page showed the whole name.
  // The audit's own rules flag a truncated h1, but the page-wide check visits this route only as
  // "group not found", so the real page is checked here at 375, 768 and 1280 px: the rules on the
  // name, and its box against its own scroll width, which a nowrap clip keeps wider than the box.
  // On main this fails at 768 and 1280 px.
  it("shows a group name longer than one line in full at a phone's, a tablet's and a desktop's width", async () => {
    const name = "Seed round investors for the 2027 expansion and everyone who joined at the demo day last spring";
    const group = await seededNotebook.query({ table: "contact_groups", operation: "insert", values: { name }, selection: "id,slug", single: true });
    expect(group?.slug ?? null).toBeTruthy();
    const failures: string[] = [];
    for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        const cdp = await context.newCDPSession(page);
        await page.goto(`${seededNotebook.base}/dashboard/groups/${group.slug}`);
        await settle(page);
        // The page's only h1 is the group's name, so any h1 finding is about it. Copying the
        // audit's own element-string format here would let its drift void this half of the case.
        const found = (await auditShown(page, cdp)).filter((f) => f.element.startsWith('h1 "'));
        failures.push(...found.map((f) => `${viewport.width} px, ${f.rule}: ${f.element}`));
        const cut = await page.evaluate((nm) => {
          const h1 = [...document.querySelectorAll("h1")].find((e) => e.textContent === nm);
          if (!h1) return "the name is missing";
          const box = h1.getBoundingClientRect();
          if (box.left < 0 || box.right > innerWidth) return `the name's box spans ${Math.round(box.left)} to ${Math.round(box.right)} on a ${innerWidth} px screen`;
          return h1.scrollWidth > h1.clientWidth ? `the name is cut: its box holds ${h1.clientWidth} px, its text needs ${h1.scrollWidth}` : null;
        }, name);
        if (cut) failures.push(`${viewport.width} px: ${cut}`);
      } finally {
        await context.close();
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 120_000);

  // The name beside the buttons at a tablet's width with the sidebar open (#878): the review of
  // 19:16 UTC saw the wrapped h1 squeezed into a 128 px column beside the Add Member, Edit and
  // archive buttons, where ordinary words like "Partnerships" split with no hyphen and the name
  // ran 8 to 13 lines tall. The button row must drop under the name when the whole name would not
  // sit beside it, so the name wraps at whole words in the row's full width: its box must hold its
  // longest word, and a line may only start inside a word the box could not hold anyway.
  it("wraps a group name at whole words beside its buttons at a tablet's width", async () => {
    const name = "International Relationships Partnerships for the 2027 expansion round";
    const group = await seededNotebook.query({ table: "contact_groups", operation: "insert", values: { name }, selection: "id,slug", single: true });
    expect(group?.slug ?? null).toBeTruthy();
    const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await page.goto(`${seededNotebook.base}/dashboard/groups/${group.slug}`);
      await settle(page);
      const failures = (await auditShown(page, cdp)).filter((f) => f.element.startsWith('h1 "')).map((f) => `768 px, ${f.rule}: ${f.element}`);
      const wrap = await page.evaluate((nm) => {
        const h1 = [...document.querySelectorAll("h1")].find((e) => e.textContent === nm);
        if (!h1) return "the name is missing";
        const box = h1.getBoundingClientRect();
        if (box.left < 0 || box.right > innerWidth) return `the name's box spans ${Math.round(box.left)} to ${Math.round(box.right)} on a ${innerWidth} px screen`;
        if (h1.scrollWidth > h1.clientWidth) return `the name is cut: its box holds ${h1.clientWidth} px, its text needs ${h1.scrollWidth}`;
        const node = h1.firstChild;
        if (!node || node.nodeType !== Node.TEXT_NODE) return null;
        const text = node.textContent;
        const range = document.createRange();
        const word = (at) => {
          let start = at;
          while (start > 0 && !/\s/.test(text[start - 1])) start--;
          let end = at;
          while (end < text.length && !/\s/.test(text[end])) end++;
          range.setStart(node, start);
          range.setEnd(node, end);
          return range.getBoundingClientRect().width;
        };
        let widest = 0;
        let prev = null;
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (!(r.width > 0)) continue;
          widest = Math.max(widest, word(i));
          // A new line may only start after whitespace (an ordinary wrap at a space) or inside a
          // word too wide for the box; a split inside a word the box could hold is the fault.
          if (prev && Math.abs(r.top - prev.top) > 1 && /\S/.test(text[i - 1] ?? "") && word(i) <= box.width + 0.5) {
            return `a line starts at "${text.slice(i, i + 12)}", inside a word the ${Math.round(box.width)} px box could hold`;
          }
          prev = r;
        }
        if (box.width + 0.5 < widest) return `the name's box holds ${Math.round(box.width)} px, its longest word needs ${Math.round(widest)}`;
        return null;
      }, name);
      if (wrap) failures.push(`768 px: ${wrap}`);
      // And the buttons: dropped under the name, they cover none of it.
      const overlap = await page.evaluate((nm) => {
        const h1 = [...document.querySelectorAll("h1")].find((e) => e.textContent === nm);
        const button = (t) => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
        if (!h1 || !button("Add Member") || !button("Edit")) return "the name or a button is missing";
        const intersect = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const box = (e) => e.getBoundingClientRect();
        for (const t of ["Add Member", "Edit"]) {
          if (intersect(box(h1), box(button(t)))) return `"${t}" overlaps the name`;
        }
        return null;
      }, name);
      if (overlap) failures.push(`768 px: ${overlap}`);
      expect(failures, failures.join("\n")).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);

  // The List tab's table at a phone's width (#878): six columns cannot fit a card 272 px wide, and
  // the table's sideways scroller (the shared Table's own wrapper) draws no scrollbar in this
  // browser, so the last headers read as cut off rather than scrolled to. Every header the tab
  // shows must lie inside its card, and the tab's text must wrap at whole words: the round-4 fix
  // let the table squeeze the Name column below a member's longest word, and real names then
  // rendered a letter a line while the headers sat inside the card. So each shown header and name
  // cell must hold its own longest word, and a line may only start inside a word the cell could
  // not hold (the rules the 768 px h1 case uses, with a word's true width measured in a hidden
  // span, since a word already broken across lines cannot say its own width). The members' names
  // are the ones the review of 19:16 UTC saw
  // push the headers out even after the first fix: at 320 px with only "Ada Lovelace" the
  // "Joined" header was cut, and "Bartholomew Featherstonehaugh" pushed "Joined" out at 375 px and
  // "Priority" out at 320 px. On main this fails at both widths: six columns sit outside the
  // card. On the round-4 head it fails too: the Name cell holds 50 px while "Lovelace" needs 52
  // at 320 px, and 105 px while "Featherstonehaugh" needs 131 at 375 px.
  it("fits the List tab's headers inside their card at a phone's width", async () => {
    const name = "Members on the List tab";
    const group = await seededNotebook.query({ table: "contact_groups", operation: "insert", values: { name }, selection: "id,slug", single: true });
    expect(group?.slug ?? null).toBeTruthy();
    const ada = await seededNotebook.query({ table: "contacts", operation: "insert", values: { name: "Ada Lovelace" }, selection: "id", single: true });
    const bartholomew = await seededNotebook.query({ table: "contacts", operation: "insert", values: { name: "Bartholomew Featherstonehaugh" }, selection: "id", single: true });
    await seededNotebook.query({ table: "contact_group_memberships", operation: "insert", values: { group_id: group.id, contact_id: ada.id, priority: "high", status: "new", reason: "Met at the conference" }, selection: "id", single: true });
    await seededNotebook.query({ table: "contact_group_memberships", operation: "insert", values: { group_id: group.id, contact_id: bartholomew.id, priority: "urgent", status: "new", reason: "Met at the conference" }, selection: "id", single: true });
    const failures: string[] = [];
    for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 812 }]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        await page.goto(`${seededNotebook.base}/dashboard/groups/${group.slug}`);
        await settle(page);
        await page.getByRole("tab", { name: "List" }).click();
        await page.getByText("Bartholomew Featherstonehaugh").first().waitFor({ timeout: 15_000 });
        await settle(page);
        const outside = await page.evaluate(() => {
          const table = [...document.querySelectorAll("table")].find((t) => [...t.querySelectorAll("th")].some((th) => th.textContent === "Name"));
          const card = table?.closest(".rounded-xl");
          if (!table || !card) return "the List tab's table or card is missing";
          const cardBox = card.getBoundingClientRect();
          return [...table.querySelectorAll("th")].flatMap((th) => {
            const box = th.getBoundingClientRect();
            // A header hidden at this width has a zero box and is not shown at all.
            if (box.width <= 0 || box.height <= 0) return [];
            return box.right > cardBox.right + 0.5 || box.left < cardBox.left - 0.5 ? [`"${th.textContent}" lies outside its card`] : [];
          });
        });
        failures.push(...(outside as string[]).map((line) => `${viewport.width} px: ${line}`));
        const wrap = (await page.evaluate(() => {
          const table = [...document.querySelectorAll("table")].find((t) => [...t.querySelectorAll("th")].some((th) => th.textContent === "Name"));
          if (!table) return ["the List tab's table is missing"];
          // A word's true width, measured in a hidden span in the cell's own font: the width a
          // word has when no line break splits it, which a word already broken across lines
          // cannot say for itself.
          const span = document.createElement("span");
          span.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;top:-1000px";
          document.body.appendChild(span);
          const wordWidth = (el: Element, word: string) => {
            const cs = getComputedStyle(el);
            span.style.font = cs.font;
            span.style.letterSpacing = cs.letterSpacing;
            span.textContent = word;
            return span.getBoundingClientRect().width;
          };
          const faults: string[] = [];
          // A header, or the button that holds a member's name in its cell.
          const cells: Element[] = [...table.querySelectorAll("th")];
          for (const td of table.querySelectorAll("tbody td")) cells.push(td.querySelector("button") ?? td);
          for (const cell of cells) {
            const node = [...cell.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim());
            if (!node) continue;
            const text = node.textContent ?? "";
            const box = cell.getBoundingClientRect();
            // A header hidden at this width has a zero box and is not shown at all.
            if (box.width <= 0 || box.height <= 0) continue;
            const cs = getComputedStyle(cell);
            const holds = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const word = (at: number) => {
              let start = at;
              while (start > 0 && !/\s/.test(text[start - 1])) start--;
              let end = at;
              while (end < text.length && !/\s/.test(text[end])) end++;
              return text.slice(start, end);
            };
            let widest = 0;
            const range = document.createRange();
            let prev: DOMRect | null = null;
            for (let i = 0; i < text.length; i++) {
              range.setStart(node, i);
              range.setEnd(node, i + 1);
              const r = range.getBoundingClientRect();
              if (!(r.width > 0)) continue;
              widest = Math.max(widest, wordWidth(cell, word(i)));
              // A new line may only start at whitespace or after a hyphen, or inside a word the
              // cell could not hold; a split inside a word the cell has room for is the fault.
              if (prev && Math.abs(r.top - prev.top) > 1 && /\S/.test(text[i - 1] ?? "") && text[i - 1] !== "-") {
                const w = wordWidth(cell, word(i));
                if (w <= holds + 0.5) faults.push(`"${text.trim()}" breaks inside "${word(i)}", a word its ${Math.round(holds)} px box could hold`);
              }
              prev = r;
            }
            if (holds + 0.5 < widest) faults.push(`"${text.trim()}" sits in a ${Math.round(holds)} px box, its longest word needs ${Math.round(widest)}`);
          }
          span.remove();
          return faults;
        })) as string[];
        failures.push(...wrap.map((line) => `${viewport.width} px: ${line}`));
      } finally {
        await context.close();
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 60_000);

  // The floating chat button against the groups page at its load state (#878): the button is pinned
  // to the viewport's corner while the page scrolled the window, so a card in the bottom band of
  // the screen lay under it however much room the end of the content reserved (#530). On main this
  // fails at 375 px: a card's progress bar lies under the button before any scroll.
  it("keeps the floating chat button off every group card at a phone's width", async () => {
    // Enough ordinary groups that a card sits in the bottom band of the viewport at the load state,
    // and one with a success criterion, whose progress bar the review saw under the button.
    const named = await seededNotebook.query({ table: "contact_groups", operation: "insert", values: { name: "Group with a progress bar", type: "other", success_criteria: [{ label: "Intro meetings held", target: 10, current: 4 }] }, selection: "id,slug", single: true });
    expect(named?.slug ?? null).toBeTruthy();
    for (let i = 0; i < 8; i++) {
      await seededNotebook.query({ table: "contact_groups", operation: "insert", values: { name: `Filler group ${i + 1}` }, selection: "id", single: true });
    }
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const page = await context.newPage();
      await page.goto(`${seededNotebook.base}/dashboard/groups`);
      await page.getByText("Group with a progress bar").first().waitFor({ timeout: 15_000 });
      await settle(page);
      const under = await page.evaluate(() => {
        const fab = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Chat with Godspeed");
        const main = document.querySelector("main");
        if (!fab || !main) return "the floating chat button or main is missing";
        const box = (e) => e.getBoundingClientRect();
        const mainBox = box(main);
        const fabBox = box(fab);
        if (fabBox.top < mainBox.bottom) return `the button starts ${Math.round(mainBox.bottom - fabBox.top)} px above main's bottom edge`;
        const intersect = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const cards = [...document.querySelectorAll("a[href^='/dashboard/groups/'] div.rounded-xl")];
        // A selector that matched nothing would check no card at all; its sibling case guards the
        // same way.
        if (!cards.length) return "no group card matched the audit's selector";
        for (const card of cards) {
          const b = box(card);
          // The card's visible part: main's own box clips it, because main is the page's scroll area.
          const visible = { top: Math.max(b.top, mainBox.top), bottom: Math.min(b.bottom, mainBox.bottom), left: Math.max(b.left, mainBox.left), right: Math.min(b.right, mainBox.right) };
          if (visible.bottom <= visible.top) continue;
          if (intersect(fabBox, visible)) return "the button covers a group card";
        }
        return null;
      });
      expect(under, String(under)).toEqual(null);
    } finally {
      await context.close();
    }
  }, 60_000);

  // The List tab's table at a tablet's width with the sidebar open (#937): the sidebar eats a
  // fixed 256 px, so the card is 464 px wide at 768 px, phone-narrow, and the six columns pushed
  // "Last Movement" and "Reason" past the card's edge while the table's sideways scroller drew
  // no scrollbar, and the "Joined" header was cut with it. Below lg the same four columns drop
  // out as they do below sm, so only "Name" and "Joined" show: every header shown must lie
  // inside its card, and the table must fit the card with no sideways scroll at all. With an
  // 80-character member name. On main this fails at 768 px: the two last headers lie outside.
  it("fits the List tab's shown headers inside their card at a tablet's width with the sidebar open", async () => {
    const name = "Members on the List tab at a tablet's width";
    const member = "Bartholomew Wilhelmina Featherstonehaugh Fitzwilliam Darcy Wellington Pershing X";
    expect(member.length).toBe(80);
    const group = await seededNotebook.query({ table: "contact_groups", operation: "insert", values: { name }, selection: "id,slug", single: true });
    expect(group?.slug ?? null).toBeTruthy();
    const person = await seededNotebook.query({ table: "contacts", operation: "insert", values: { name: member }, selection: "id", single: true });
    await seededNotebook.query({ table: "contact_group_memberships", operation: "insert", values: { group_id: group.id, contact_id: person.id, priority: "high", status: "new", reason: "Met at the conference" }, selection: "id", single: true });
    const context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    try {
      const page = await context.newPage();
      await page.goto(`${seededNotebook.base}/dashboard/groups/${group.slug}`);
      await settle(page);
      await page.getByRole("tab", { name: "List" }).click();
      await page.getByText(member).first().waitFor({ timeout: 15_000 });
      await settle(page);
      const faults = await page.evaluate(() => {
        const table = [...document.querySelectorAll("table")].find((t) => [...t.querySelectorAll("th")].some((th) => th.textContent === "Name"));
        const card = table?.closest(".rounded-xl");
        if (!table || !card) return ["the List tab's table or card is missing"];
        const cardBox = card.getBoundingClientRect();
        const faults: string[] = [];
        for (const th of table.querySelectorAll("th")) {
          const box = th.getBoundingClientRect();
          // A header hidden at this width has a zero box and is not shown at all.
          if (box.width <= 0 || box.height <= 0) continue;
          if (box.right > cardBox.right + 0.5 || box.left < cardBox.left - 0.5) faults.push(`"${th.textContent}" lies outside its card`);
        }
        if (table.scrollWidth > table.clientWidth + 0.5) faults.push(`the table needs ${table.scrollWidth} px, its card scrolls ${table.clientWidth}`);
        for (const td of table.querySelectorAll("tbody td")) {
          const box = td.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) continue;
          if (box.right > cardBox.right + 0.5 || box.left < cardBox.left - 0.5) faults.push(`a member's cell lies outside its card`);
        }
        return faults;
      });
      expect(faults, faults.join("\n")).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);

  // The floating chat button at a phone's width against the last Timeline and World card (#937):
  // the button is pinned to the viewport's corner, and before the button-zone cap (#910) the page
  // scrolled the window, so the bottom card's badge sat under the button at every scroll before
  // the end. Where the button shows, main now holds the space above the button's zone and scrolls
  // within it, so no scroll position can put a card under the button: the check asserts the room
  // itself, and the last card's badge and the last World entity row's badge, scrolled to the end
  // of main, clear of the button.
  it("keeps the floating chat button off the last Timeline and World card at a phone's width", async () => {
    // Enough rows on both pages that the last one sits below the fold at the load state.
    for (let i = 0; i < 12; i++) {
      await seededNotebook.query({ table: "contacts", operation: "insert", values: { name: `World entity contact ${i + 1}` }, selection: "id", single: true });
      await seededNotebook.query({ table: "moments", operation: "insert", values: { title: `Chat button moment ${i + 1}`, happened_at: `2026-0${(i % 9) + 1}-15`, status: "past_fact", impact_level: 2, source: "manual" }, selection: "id", single: true });
    }
    const failures: string[] = [];
    for (const url of ["/dashboard/timeline", "/dashboard/world"]) {
      const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
      try {
        const page = await context.newPage();
        await page.goto(`${seededNotebook.base}${url}`);
        await settle(page);
        const under = await page.evaluate(() => {
          const fab = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Chat with Godspeed");
          const main = document.querySelector("main");
          if (!fab || !main) return ["the floating chat button or main is missing"];
          const box = (e: Element) => e.getBoundingClientRect();
          const fabBox = box(fab);
          const mainBox = box(main);
          const faults: string[] = [];
          if (fabBox.top < mainBox.bottom - 0.5) faults.push(`the button starts ${Math.round(mainBox.bottom - fabBox.top)} px above main's bottom edge`);
          // The end of the list: the last scroll position there is.
          main.scrollTop = main.scrollHeight;
          const cards = [...main.querySelectorAll(".rounded-xl, ul > li")];
          if (!cards.length) return ["no card matched the audit's selector"];
          const last = cards[cards.length - 1];
          const lastBox = box(last);
          // The card's visible part: main's own box clips it, because main is the page's scroll area.
          const visible = { top: Math.max(lastBox.top, mainBox.top), bottom: Math.min(lastBox.bottom, mainBox.bottom), left: Math.max(lastBox.left, mainBox.left), right: Math.min(lastBox.right, mainBox.right) };
          if (visible.bottom <= visible.top) return faults;
          const intersect = (a: typeof visible, b: DOMRect) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
          if (intersect(visible, fabBox)) faults.push("the button covers the last card");
          const badge = last.querySelector(".rounded-full, [class*='badge']") ?? last;
          const badgeBox = box(badge);
          const badgeVisible = { top: Math.max(badgeBox.top, mainBox.top), bottom: Math.min(badgeBox.bottom, mainBox.bottom), left: Math.max(badgeBox.left, mainBox.left), right: Math.min(badgeBox.right, mainBox.right) };
          if (badgeVisible.bottom > badgeVisible.top && intersect(badgeVisible, fabBox)) faults.push("the button covers the last card's badge");
          return faults;
        });
        failures.push(...(under as string[]).map((line) => `${url} at 320 px: ${line}`));
      } finally {
        await context.close();
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 60_000);

  // A Timeline title that is one 40-character word on a phone's card (#937): the card leaves the
  // title about 200 px and the badge about 65 px beside it, where truncate kept the word clipped
  // to a single short line. The title now wraps wherever it must, with the badge dropping under
  // it on a line too narrow for both, so the whole word shows on at most two lines. On main this
  // fails: the title is cut.
  it("wraps a Timeline title that is one 40-character word onto at most two lines at a phone's width", async () => {
    const title = "Supercalifragilisticexpialidocioustitles";
    expect(title.length).toBe(40);
    await seededNotebook.query({ table: "moments", operation: "insert", values: { title, happened_at: "2026-06-15", status: "past_fact", impact_level: 2, source: "manual" }, selection: "id", single: true });
    const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
    try {
      const page = await context.newPage();
      await page.goto(`${seededNotebook.base}/dashboard/timeline`);
      await page.getByText(title).first().waitFor({ timeout: 15_000 });
      await settle(page);
      const wrapped = await page.evaluate((t) => {
        const p = [...document.querySelectorAll("p")].find((e) => e.textContent?.includes(t) && e.textContent!.trim() === t);
        if (!p) return ["the moment's title is missing"];
        const faults: string[] = [];
        if (p.scrollWidth > p.clientWidth + 0.5) faults.push(`the title is cut: its box holds ${p.clientWidth} px, its text needs ${p.scrollWidth}`);
        const range = document.createRange();
        range.selectNodeContents(p);
        const tops = [...new Set([...range.getClientRects()].filter((r) => r.height > 0).map((r) => Math.round(r.top)))];
        if (tops.length > 2) faults.push(`the title wraps onto ${tops.length} lines`);
        return faults;
      }, title);
      expect(wrapped, (wrapped as string[]).join("\n")).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);

  // The pages that fill main's height where the floating chat button shows (#878): People, the
  // Media Library and a collection page size their pane for main's content box, so a pane built
  // for an older budget leaves its bottom band below main's scrollport at load, reachable only by
  // a second scroll inside main the pages were not designed for. At the load state main must not
  // scroll inside itself on these pages. On main this fails on all three routes: the pane sits
  // 96 px below main's bottom edge.
  it("keeps every full-height page inside main at a desktop's width", async () => {
    const collection = await seededNotebook.query({ table: "collections", operation: "insert", values: { name: "Full-height collection", slug: "full-height-collection" }, selection: "id,slug", single: true });
    expect(collection?.slug ?? null).toBeTruthy();
    const failures: string[] = [];
    for (const url of ["/dashboard/people", "/dashboard/media", `/collections/${collection.slug}`]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      try {
        const page = await context.newPage();
        await page.goto(`${seededNotebook.base}${url}`);
        await settle(page);
        const over = await page.evaluate(() => {
          const main = document.querySelector("main");
          if (!main) return "main is missing";
          return main.scrollHeight > main.clientHeight + 1 ? `main holds ${main.scrollHeight} px of page in a ${main.clientHeight} px scrollport at load` : null;
        });
        if (over) failures.push(`${url}: ${over}`);
      } finally {
        await context.close();
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 60_000);
});
