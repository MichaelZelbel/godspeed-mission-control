#!/usr/bin/env node
/**
 * web-design check: screenshots plus mechanical checks for one page.
 *
 *   node check.mjs --url http://localhost:5173 [--out lab/check]
 *   node check.mjs --serve ./dist [--port 4610] [--path /] [--out lab/check]
 *
 * Needs playwright-core (or playwright) in the current folder, the served folder, this
 * script's folder or the global npm root, and an installed Chrome (or WEBDESIGN_CHROME=<path>).
 * Writes full-page shots, first-viewport shots, and 1:1 slices (judge type size on those). Uses the installed Chrome,
 * not bundled Chromium, so fonts and codecs match a real visitor's browser.
 *
 * Exit code 1 when any FAIL is reported. Proves mechanics only; look at the shots.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { servePath } from './serve-path.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : dflt;
};
const flag = (name) => args.includes(`--${name}`);

if (flag("help") || (!opt("url") && !opt("serve"))) {
  console.log("usage: node check.mjs --url <url> | --serve <dir> [--port 4610] [--path /] [--out lab/check] [--only desktop,phone390]");
  process.exit(flag("help") || opt("url") || opt("serve") ? 0 : 2);
}

// Resolve playwright-core from the current folder, the served folder, or this script's folder.
let chromium;
const here = path.dirname(fileURLToPath(import.meta.url));
let globalRoot = null;
try { globalRoot = (await import("node:child_process")).execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch {}
for (const base of [process.cwd(), opt("serve") && path.resolve(opt("serve")), here, globalRoot].filter(Boolean)) {
  const req = createRequire(path.join(base, "package.json"));
  for (const pkg of ["playwright-core", "playwright"]) {
    try { ({ chromium } = req(pkg)); break; } catch {}
  }
  if (chromium) break;
}
if (!chromium) {
  console.error(`playwright-core not found. Run once: npm i -D playwright-core  (here, or in ${here})`);
  process.exit(2);
}

const CHROME = [
  process.env.WEBDESIGN_CHROME,
  process.env.SCROLLCRAFT_CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
].find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error("No installed Chrome found. Set WEBDESIGN_CHROME to its path.");
  process.exit(2);
}

// ---------- optional static server ----------
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm",
  ".txt": "text/plain", ".xml": "application/xml",
};
let server;
let target = opt("url");
if (opt("serve")) {
  const root = path.resolve(opt("serve"));
  const port = Number(opt("port", 4610));
  server = http.createServer((req, res) => {
    const resolved = servePath(root, req.url);
    if (resolved.status !== 200) { res.writeHead(resolved.status); return res.end(); }
    const file = resolved.file;
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  target = `http://localhost:${port}${opt("path", "/")}`;
}

// Default output sits next to the page when serving a folder, so it never lands in a random cwd.
// Named after the served folder, so two sibling pages never overwrite each other's shots.
const out = path.resolve(opt("out", opt("serve") ? path.join(opt("serve"), "..", "lab", `check-${path.basename(path.resolve(opt("serve")))}`) : "lab/check"));
fs.mkdirSync(out, { recursive: true });

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone390", width: 390, height: 844, mobile: true },
  { name: "phone360", width: 360, height: 640, mobile: true },
  { name: "desktop-reduced", width: 1440, height: 900, reduced: true },
];
const only = opt("only");
const viewports = only ? VIEWPORTS.filter((v) => only.split(",").includes(v.name)) : VIEWPORTS;

const FONT_CDN = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|fast\.fonts\.net/i;
const FILLER = [
  "elevate", "seamless", "seamlessly", "unleash", "unlock", "next-gen", "revolutionize", "revolutionise",
  "supercharge", "robust", "cutting-edge", "transformative", "empower", "effortless", "effortlessly",
  "game-changer", "game-changing", "leverage", "leveraging", "delve", "synergy", "world-class", "best-in-class",
];

const findings = [];
const add = (level, vp, msg) => findings.push({ level, viewport: vp, msg });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: !!vp.mobile,
      hasTouch: !!vp.mobile,
      reducedMotion: vp.reduced ? "reduce" : "no-preference",
    });
    // Behave like a real visitor: analytics and some libraries skip navigator.webdriver browsers.
    // Never grab the real pointer (headless Chrome on Windows can still reach it).
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
      Element.prototype.requestPointerLock = function () {};
      Element.prototype.setPointerCapture = function () {};
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const failed = [];
    const fontCdn = new Set();
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 200)}`));
    page.on("request", (r) => { if (FONT_CDN.test(r.url())) fontCdn.add(new URL(r.url()).host); });
    page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText || "failed"} ${r.url()}`));
    page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

    await page.goto(target, { waitUntil: "networkidle", timeout: 60000 }).catch(async (e) => {
      add("WARN", vp.name, `networkidle not reached (${e.message.split("\n")[0]}); continuing after load`);
      await page.waitForLoadState("load").catch(() => {});
    });
    await page.evaluate(() => document.fonts && document.fonts.ready);

    // Walk the page so scroll-triggered content appears, then return to the top.
    await page.evaluate(async () => {
      const step = Math.max(200, Math.floor(innerHeight * 0.7));
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        window.scrollTo({ top: y, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    // Let finite animations settle (infinite ones are ignored).
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter((a) => {
        const t = a.effect && a.effect.getComputedTiming && a.effect.getComputedTiming();
        return t && Number.isFinite(t.endTime);
      });
      await Promise.race([Promise.allSettled(finite.map((a) => a.finished)), new Promise((r) => setTimeout(r, 2500))]);
    });
    await page.waitForTimeout(400);

    await page.screenshot({ path: path.join(out, `${vp.name}-first.png`) });
    await page.screenshot({ path: path.join(out, `${vp.name}-full.png`), fullPage: true });
    // 1:1 slices, one per screen height: a tall full-page PNG gets shrunk by any viewer, and a
    // shrunken image misleads about type size. Judge sizes on these.
    {
      const total = await page.evaluate(() => document.documentElement.scrollHeight);
      const maxSlices = 12;
      for (let i = 0, y = 0; y < total && i < maxSlices; i++, y += vp.height) {
        const h = Math.min(vp.height, total - y);
        await page.screenshot({ path: path.join(out, `${vp.name}-slice${String(i + 1).padStart(2, "0")}.png`), fullPage: true, clip: { x: 0, y, width: vp.width, height: h } });
      }
    }

    const r = await page.evaluate((FILLER) => {
      const res = { overflow: null, culprits: [], dashes: [], filler: [], imgs: [], unnamed: [], unlabeled: [],
        lowContrast: [], unchecked: 0, transitionAll: [], zoomDisabled: false, title: document.title, h1: [] };
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth > vw + 1) {
        res.overflow = document.documentElement.scrollWidth - vw;
        const els = [...document.body.querySelectorAll("*")]
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.right > vw + 1 && r.width > 0)
          .sort((a, b) => b.r.right - a.r.right)
          .slice(0, 3);
        res.culprits = els.map(({ el, r }) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} right=${Math.round(r.right)}`);
      }
      const visible = (el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05 && r.width > 0 && r.height > 0;
      };
      const text = document.body.innerText || "";
      for (const m of text.matchAll(/.{0,30}[\u2014\u2013\u2015].{0,30}/g)) res.dashes.push(m[0].replace(/\s+/g, " "));
      const lower = text.toLowerCase();
      for (const w of FILLER) {
        const re = new RegExp(`(^|[^a-z])${w.replace(/[-]/g, "\\-")}([^a-z]|$)`, "i");
        if (re.test(lower)) res.filler.push(w);
      }
      for (const img of document.images) {
        const missing = [];
        if (!img.hasAttribute("alt")) missing.push("alt");
        if (!img.getAttribute("width") || !img.getAttribute("height")) {
          const s = getComputedStyle(img);
          if (!(s.aspectRatio && s.aspectRatio !== "auto")) missing.push("width/height");
        }
        if (missing.length) res.imgs.push(`${(img.currentSrc || img.src).split("/").pop().slice(0, 60)} (${missing.join(", ")})`);
      }
      const name = (el) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.title || el.innerText || el.querySelector("img[alt]:not([alt=''])")?.alt || el.querySelector("svg title")?.textContent || "").trim();
      for (const el of document.querySelectorAll("a[href], button, [role=button]")) {
        if (visible(el) && !name(el)) res.unnamed.push(el.outerHTML.slice(0, 90));
      }
      for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")) {
        if (!visible(el)) continue;
        const labelled = el.labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.title;
        if (!labelled) res.unlabeled.push(el.outerHTML.slice(0, 90));
      }
      const vm = document.querySelector("meta[name=viewport]")?.content || "";
      res.zoomDisabled = /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0*)?(\D|$)/i.test(vm);
      res.h1 = [...document.querySelectorAll("h1")].map((h) => h.innerText.trim().slice(0, 80));

      // Contrast: composite background layers up the tree; images and gradients make it UNCHECKED.
      const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }; return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const bgOf = (el) => {
        const layers = [];
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.backgroundImage && s.backgroundImage !== "none") return null;
          const c = parse(s.backgroundColor);
          if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
        }
        let acc = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
        return acc;
      };
      const seen = new Set();
      for (const el of document.body.querySelectorAll("*")) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (!own || !visible(el)) continue;
        const tag = el.tagName;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(tag)) continue;
        const s = getComputedStyle(el);
        const bg = bgOf(el);
        if (!bg) { res.unchecked++; continue; }
        let fg = parse(s.color); if (!fg) continue;
        // Element and ancestor opacity fade the text toward its background.
        let op = 1;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
        fg = over({ ...fg, a: fg.a * op }, bg);
        const size = parseFloat(s.fontSize), weight = Number(s.fontWeight) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;
        const cr = ratio(fg, bg);
        if (cr < need) {
          const snippet = el.innerText.trim().replace(/\s+/g, " ").slice(0, 40);
          const key = `${snippet}|${cr.toFixed(2)}`;
          if (!seen.has(key)) { seen.add(key); res.lowContrast.push(`${cr.toFixed(2)}:1 (need ${need}) "${snippet}"`); }
        }
        const tp = s.transitionProperty, td = s.transitionDuration;
        if (tp.split(",").some((p) => p.trim() === "all") && td.split(",").some((d) => parseFloat(d) > 0)) {
          const k = el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : "");
          if (!res.transitionAll.includes(k)) res.transitionAll.push(k);
        }
      }
      for (const el of document.querySelectorAll("a, button")) {
        const s = getComputedStyle(el);
        if (s.transitionProperty.split(",").some((p) => p.trim() === "all") && s.transitionDuration.split(",").some((d) => parseFloat(d) > 0)) {
          const k = el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/)[0] : "");
          if (!res.transitionAll.includes(k)) res.transitionAll.push(k);
        }
      }

      // Text running into other text: the boxes of text lines from different elements overlap,
      // or sit closer than 2px on the same line ("SeptemberBurundi").
      const lines = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        if (!t.textContent.trim() || !t.parentElement || !visible(t.parentElement)) continue;
        const range = document.createRange(); range.selectNodeContents(t);
        for (const rc of range.getClientRects()) if (rc.width > 2 && rc.height > 2) lines.push({ el: t.parentElement, r: rc, txt: t.textContent.trim().slice(0, 24) });
        if (lines.length > 4000) break;
      }
      res.collisions = [];
      for (let i = 0; i < lines.length && res.collisions.length < 8; i++) {
        for (let j = i + 1; j < lines.length; j++) {
          const a = lines[i], b = lines[j];
          if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const vOverlap = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (vOverlap < Math.min(a.r.height, b.r.height) * 0.5) continue;
          const gap = Math.max(a.r.left, b.r.left) - Math.min(a.r.right, b.r.right);
          // Inline runs sit flush by design (<strong>, a price and its unit); only separate
          // blocks, grid cells or flex items may not touch. Any real overlap counts.
          const inl = (e) => getComputedStyle(e).display.startsWith("inline");
          if (gap >= -1 && (inl(a.el) || inl(b.el))) continue;
          if (gap < 2) { res.collisions.push(`"${a.txt}" and "${b.txt}" ${gap < 0 ? "overlap" : "touch"}`); break; }
        }
      }

      // Tap targets under 44x44 (phones only use this), ignoring links inside running text.
      res.smallTargets = [];
      for (const el of document.querySelectorAll("a[href], button, [role=button], input, select, summary")) {
        if (!visible(el)) continue;
        const rc = el.getBoundingClientRect();
        const inline = el.tagName === "A" && getComputedStyle(el).display === "inline" && el.parentElement && /^(P|LI|SPAN|SMALL|TD)$/.test(el.parentElement.tagName);
        if (!inline && (rc.width < 44 || rc.height < 44) && res.smallTargets.length < 8) res.smallTargets.push(`${Math.round(rc.width)}x${Math.round(rc.height)} "${(el.innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)}"`);
      }

      // A call to action in the first viewport: any button or button-like link fully above the fold.
      res.ctaAboveFold = [...document.querySelectorAll("a[href], button")].some((el) => {
        if (!visible(el)) return false;
        const rc = el.getBoundingClientRect(), s = getComputedStyle(el);
        const buttonish = el.tagName === "BUTTON" || (s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.display !== "inline") || parseFloat(s.borderWidth) > 0;
        return buttonish && rc.top >= 0 && rc.bottom <= innerHeight;
      });

      // Typical paragraph size (median), not the hero lede that happens to come first.
      const sizes = [...document.querySelectorAll("p, li")].filter(visible).map((p) => parseFloat(getComputedStyle(p).fontSize)).sort((a, b) => a - b);
      res.bodySize = sizes.length ? `${sizes[Math.floor(sizes.length / 2)]}px (median of ${sizes.length} paragraphs)` : null;
      if (sizes.length && sizes[Math.floor(sizes.length / 2)] < 16) res.smallBody = true;
      // Visual material: images, video, canvas, and inline SVG drawings of real size (not icons).
      const bigSvg = [...document.querySelectorAll("svg")].filter((s) => { const rc = s.getBoundingClientRect(); return rc.width >= 120 && rc.height >= 120; }).length;
      res.images = document.images.length + document.querySelectorAll("video, canvas").length + bigSvg;
      const og = document.querySelector("meta[property='og:image']")?.content || "";
      res.ogRelative = og && !/^https?:\/\//.test(og);
      return res;
    }, FILLER);

    const v = vp.name;
    if (r.overflow) add("FAIL", v, `horizontal overflow ${r.overflow}px; widest: ${r.culprits.join("; ")}`);
    for (const e of consoleErrors.slice(0, 8)) add("FAIL", v, `console: ${e}`);
    for (const f of [...new Set(failed)].slice(0, 8)) add("FAIL", v, `request: ${f}`);
    for (const h of fontCdn) add("FAIL", v, `font loaded from a third party: ${h} (self-host it)`);
    for (const d of r.dashes.slice(0, 6)) add("FAIL", v, `dash in visible text: "${d}"`);
    if (r.filler.length) add("WARN", v, `filler words: ${r.filler.join(", ")}`);
    for (const i of r.imgs.slice(0, 6)) add("WARN", v, `image missing ${i}`);
    for (const u of r.unnamed.slice(0, 6)) add("FAIL", v, `control with no accessible name: ${u}`);
    for (const u of r.unlabeled.slice(0, 6)) add("FAIL", v, `input with no label: ${u}`);
    for (const c of r.lowContrast.slice(0, 10)) add("FAIL", v, `low contrast ${c}`);
    if (r.lowContrast.length > 10) add("FAIL", v, `... and ${r.lowContrast.length - 10} more low-contrast texts`);
    if (r.unchecked) add("INFO", v, `${r.unchecked} text elements over images or gradients: contrast UNCHECKED, judge on the screenshot`);
    if (r.transitionAll.length) add("WARN", v, `transition: all on ${r.transitionAll.slice(0, 6).join(", ")}`);
    if (r.zoomDisabled) add("FAIL", v, "viewport meta disables zoom");
    for (const c of r.collisions) add("FAIL", v, `text collision: ${c}`);
    if (vp.mobile) for (const t of r.smallTargets) add("WARN", v, `tap target under 44x44: ${t}`);
    if (!r.ctaAboveFold && !vp.reduced) add("WARN", v, "no button visible in the first viewport");
    if (r.ogRelative) add("FAIL", v, "og:image is a relative path; crawlers need an absolute https URL (use the production domain even before deploying)");
    if (v === "desktop") {
      add("INFO", v, `body text ${r.bodySize || "unknown"}; ${r.images} images/media on the page`);
      if (r.smallBody) add("WARN", v, "typical body text is under 16px");
      if (r.images === 0) add("WARN", v, "no images or media at all: is the page carried by something visual, or is it empty? (calibration.md, the anti-default look)");
    }
    if (v === "desktop") {
      if (r.h1.length !== 1) add("WARN", v, `${r.h1.length} <h1> elements (expected 1): ${r.h1.join(" | ")}`);
      add("INFO", v, `title: "${r.title}"`);
      const meta = await page.evaluate(() => [document.title, document.querySelector("meta[name=description]")?.content || "", document.querySelector("meta[property='og:title']")?.content || "", document.querySelector("meta[property='og:description']")?.content || ""]);
      if (meta.some((m) => /[—–―]/.test(m))) add("FAIL", v, "dash in the title or meta description (shows in search results and link previews)");
      if (!meta[1]) add("WARN", v, "no meta description");
      if (!(await page.evaluate(() => !!document.querySelector("meta[property='og:image']")))) add("WARN", v, "no og:image (link previews will be blank or a screenshot)");
    }
    await context.close();
  }
} finally {
  await browser.close();
  if (server) server.close();
}

// The same finding at several sizes is one finding: group it, list the sizes.
const grouped = new Map();
for (const f of findings) {
  const k = `${f.level}|${f.msg}`;
  if (!grouped.has(k)) grouped.set(k, { level: f.level, msg: f.msg, viewports: [] });
  grouped.get(k).viewports.push(f.viewport);
}
const list = [...grouped.values()].sort((a, b) => ["FAIL", "WARN", "INFO"].indexOf(a.level) - ["FAIL", "WARN", "INFO"].indexOf(b.level));
const fails = list.filter((f) => f.level === "FAIL").length;
const warns = list.filter((f) => f.level === "WARN").length;
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify({ target, checkedAt: new Date().toISOString(), fails, warns, findings: list }, null, 2));
for (const f of list) {
  const where = f.viewports.length === viewports.length ? "all" : f.viewports.join(",");
  console.log(`${f.level.padEnd(4)} [${where}] ${f.msg}`);
}
console.log(`\n${target}: ${fails} FAIL, ${warns} WARN. Shots and report.json in ${out}`);
console.log("A green run proves mechanics only. Look at every screenshot.");
process.exit(fails ? 1 : 0);
