#!/usr/bin/env node
/*
 * contracts.js - which of your running contracts are costing you more than they need to, and the
 * one moment worth saying so. Deterministic: no AI, no network, no provider. The assistant writes
 * the words and asks the yes (skills/contracts); this decides WHEN, and prepares the pages.
 *
 * THE PERSON SIGNS. Nothing here submits, cancels or signs anything. `prepare` writes one page
 * into the folder with the person's own facts filled in, and what only they can do.
 *
 * PLAYBOOKS ARE DATA (tools/playbooks/<country>/<kind>.json), dated and replaced with the tools on
 * an update. One older than checked + recheck_days counts as none, and a contract with no valid
 * playbook gets no trigger: the assistant says it does not know a good route yet.
 *
 *   mc-contracts add <slug> --kind K --country DE --source S [--provider P] [--price-per-year N]
 *                   [--min-term-end D] [--notice-period-days N] [--looked-after nobody|switching-service|broker]
 *                   [--service-since D] [--seen D]      every fact needs a source: chat, letter, pay-slip, mail, notebook
 *   mc-contracts event <slug> --type price-rise|contribution-rise|switch-confirmed --date D --source S
 *                   [--old N --new N] [--effective D]   price-rise: yearly prices; contribution-rise: monthly extra
 *                                                       contribution in EUR, --effective the first day it applies
 *   mc-contracts list | playbooks | watch [--json]      watch: what is due and not yet said, never marks anything
 *   mc-contracts settings --min-saving N                the yearly saving in EUR under which nothing is said (default 50)
 *   mc-contracts mark-notified <slug> <trigger>         the message went out: never again
 *   mc-contracts prepare <slug> <trigger>               only after the yes
 *   mc-contracts --godspeed PATH --date YYYY-MM-DD      (GODSPEED_ROOT, GODSPEED_TODAY)
 */
"use strict";
const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes("--" + n);
const ROOT = path.resolve(opt("godspeed", process.env.GODSPEED_ROOT || process.cwd()));
const TODAY = opt("date", process.env.GODSPEED_TODAY || new Date().toISOString().slice(0, 10));
const DIR = path.join(ROOT, "contracts");
const PLAYBOOKS = path.join(__dirname, "playbooks");

const SOURCES = ["chat", "letter", "pay-slip", "mail", "notebook"];
const EVENT_TYPES = ["price-rise", "contribution-rise", "switch-confirmed"];
const LOOKED_AFTER = ["nobody", "switching-service", "broker"];
const REQUIRED_PLAYBOOK = ["id", "version", "pattern", "checked", "recheck_days", "sources", "route", "person_does"];
const DEFAULT_MIN_SAVING = 50;

class Refusal extends Error {}
const refuse = (m) => { throw new Refusal(m); };

// ---- dates (UTC days) -------------------------------------------------------------------------
const DAY = 86400000;
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  const t = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== s) refuse(`"${s}" is not a date (YYYY-MM-DD)`);
  return t;
}
const fmt = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => fmt(parseDay(s) + n * DAY);
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / DAY);
const endOfMonth = (s) => { const t = new Date(parseDay(s)); return fmt(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)); };

// ---- playbooks --------------------------------------------------------------------------------
function validatePlaybook(p) {
  for (const k of REQUIRED_PLAYBOOK) if (p[k] === undefined || p[k] === null || p[k] === "") refuse(`playbook is missing ${k}`);
  if (!Array.isArray(p.sources) || !p.sources.length) refuse("playbook has no sources");
  if (!Array.isArray(p.person_does) || !p.person_does.length) refuse("playbook has no person_does");
  if (typeof p.route !== "string") refuse("playbook route is not text");
  if (!Number.isFinite(p.recheck_days)) refuse("playbook recheck_days is not a number");
  const sr = p.dates && p.dates.special_right;
  if (sr && !EVENT_TYPES.includes(sr.event)) refuse(`playbook special_right.event "${sr.event}" is not one of ${EVENT_TYPES.join(", ")}`);
  parseDay(p.checked);
  return p;
}
function loadPlaybook(country, kind) {
  const file = path.join(PLAYBOOKS, String(country).toLowerCase(), kind + ".json");
  if (!/^[a-z-]+$/.test(kind) || !/^[a-zA-Z]+$/.test(country) || !fs.existsSync(file)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { refuse(`playbook ${country}/${kind} is not readable JSON`); }
  return validatePlaybook(raw);
}
const expiresOn = (p) => addDays(p.checked, p.recheck_days);
// An expired, missing or broken playbook is none: the reason is returned for the notes.
function playbookCheck(c) {
  let p;
  try { p = loadPlaybook(c.country, c.kind); } catch (e) { if (!(e instanceof Refusal)) throw e; return { p: null, why: e.message }; }
  if (!p) return { p: null, why: "none exists" };
  if (TODAY > expiresOn(p)) return { p: null, why: `expired ${expiresOn(p)}` };
  return { p, why: null };
}
const playbookFor = (c) => playbookCheck(c).p;
const ref = (p) => `${p.id}@${p.version}`;

// ---- contract files: JSON frontmatter, then free text -----------------------------------------
const fileOf = (slug) => { if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || "")) refuse("a contract name is lowercase letters, digits and dashes"); return path.join(DIR, slug + ".md"); };
function readContract(slug) {
  const file = fileOf(slug);
  if (!fs.existsSync(file)) refuse(`no contract "${slug}"`);
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(fs.readFileSync(file, "utf8"));
  if (!m) refuse(`${file} has no frontmatter`);
  let data;
  try { data = JSON.parse(m[1]); } catch (e) { refuse(`${file} has frontmatter that is not JSON`); }
  return { events: [], notified: {}, prepared: {}, ...data, slug, body: m[2] };
}
function writeContract(c) {
  const { body, slug, ...data } = c;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(fileOf(slug), `---\n${JSON.stringify(data, null, 2)}\n---\n${body || ""}`);
}
// One unreadable contract file never hides the others: it comes back in `bad`.
function allContracts(bad) {
  if (!fs.existsSync(DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(DIR).filter((f) => /^[a-z0-9][a-z0-9-]*\.md$/.test(f)).sort()) {
    try { out.push(readContract(f.slice(0, -3))); } catch (e) { if (!(e instanceof Refusal) || !bad) throw e; bad.push({ slug: f.slice(0, -3), note: e.message }); }
  }
  return out;
}
function settingsFile() { return path.join(DIR, "settings.json"); }
function minSaving() {
  const f = settingsFile();
  if (!fs.existsSync(f)) return DEFAULT_MIN_SAVING;
  let v;
  try { v = JSON.parse(fs.readFileSync(f, "utf8")).min_yearly_saving_eur; } catch (e) { refuse(`${f} is not JSON: fix or delete it`); }
  return typeof v === "number" && v >= 0 ? v : DEFAULT_MIN_SAVING;
}

// ---- triggers (pure) --------------------------------------------------------------------------
const lastConfirmed = (c) => (c.events || []).filter((e) => e.type === "switch-confirmed").map((e) => e.date).sort().pop();
const eventId = (e) => `${e.type}:${e.date}`;

function specialRightDeadline(p, e) {
  const rule = p.dates && p.dates.special_right;
  if (!rule || rule.event !== e.type) return null;
  if (rule.until === "end-of-month-of-effect") return e.effective ? endOfMonth(e.effective) : null;
  return rule.days_after_event ? addDays(e.date, rule.days_after_event) : null;
}
function yearlyCost(e) {
  if (e.old === undefined || e.new === undefined) return null;
  return Math.round((e.new - e.old) * (e.type === "contribution-rise" ? 12 : 1) * 100) / 100;
}
// The deadline and cost the person is told for a trigger, from the current playbook.
function describe(c, p, id) {
  const [type, key] = id.split(/:(.*)/s);
  if (type === "window-open") {
    const y = key, d = p.dates || {};
    if (!d.window_opens || !d.window_deadline) return null;
    return { open: `${y}-${d.window_opens}`, deadline: `${y}-${d.window_deadline}`, yearly_cost: null };
  }
  if (type === "special-right") {
    const e = (c.events || []).find((x) => eventId(x) === key);
    const deadline = e && specialRightDeadline(p, e);
    return deadline ? { open: e.date, deadline, yearly_cost: yearlyCost(e) } : null;
  }
  return { open: null, deadline: null, yearly_cost: null };
}

function triggersFor(c, p, today, min) {
  const out = [];
  const add = (id) => out.push({ id, ...describe(c, p, id) });
  if (p.pattern === 1) {
    if ((c.looked_after && c.looked_after.value) === "nobody") add("offer-service");
    const since = c.service_since && c.service_since.value;
    const base = [lastConfirmed(c), since].filter(Boolean).sort().pop();
    if (base && c.looked_after && c.looked_after.value === "switching-service" && daysBetween(base, today) > 365 + (p.grace_days || 0)) add(`yearly-check:${base}`);
  }
  const d = p.dates || {};
  if (d.window_opens && d.window_deadline) {
    const y = today.slice(0, 4);
    if (today >= `${y}-${d.window_opens}` && today <= `${y}-${d.window_deadline}`) add(`window-open:${y}`);
  }
  for (const e of c.events || []) {
    const deadline = specialRightDeadline(p, e);
    if (!deadline || deadline < today) continue;
    const cost = yearlyCost(e);
    if (cost !== null && cost < min) continue;
    add(`special-right:${eventId(e)}`);
  }
  return out;
}

function watch(today) {
  const triggers = [], notes = [], min = minSaving();
  for (const c of allContracts(notes)) {
    const { p, why } = playbookCheck(c);
    if (!p) { notes.push({ slug: c.slug, note: `no valid playbook for ${c.country}/${c.kind} (${why}): say no good route is known yet` }); continue; }
    const notified = c.notified || {};
    for (const t of triggersFor(c, p, today, min)) if (!notified[t.id]) triggers.push({ slug: c.slug, provider: c.provider, playbook: ref(p), route: p.route, ...t });
    for (const [id, n] of Object.entries(notified)) {
      if (/^(correction|follow-up):/.test(id)) continue;
      if (n.playbook !== ref(p) && n.deadline && n.deadline >= today) {
        const now = describe(c, p, id), key = `correction:${id}@${p.version}`;
        if (now && now.deadline && now.deadline !== n.deadline && !notified[key]) triggers.push({ slug: c.slug, provider: c.provider, id: key, playbook: ref(p), route: p.route, ...now, was_deadline: n.deadline });
      }
      const prep = (c.prepared || {})[id];
      const fkey = `follow-up:${id}`;
      if (prep && today > prep.expect_confirmation_by && !notified[fkey] && !(lastConfirmed(c) >= prep.date))
        triggers.push({ slug: c.slug, provider: c.provider, id: fkey, playbook: ref(p), deadline: null, yearly_cost: null, expected_by: prep.expect_confirmation_by });
    }
  }
  return { date: today, triggers, notes };
}

// ---- commands ---------------------------------------------------------------------------------
function source() {
  const s = opt("source");
  if (!SOURCES.includes(s)) refuse(`every fact needs a source: --source ${SOURCES.join("|")}`);
  return s;
}
function cmdAdd(slug) {
  const file = fileOf(slug), s = source(), seen = opt("seen", TODAY); parseDay(seen);
  const c = fs.existsSync(file) ? readContract(slug) : { slug, events: [], notified: {}, prepared: {}, body: "" };
  const fact = (k, v) => { c[k] = { value: v, source: s, seen }; };
  for (const k of ["kind", "country"]) if (opt(k)) c[k] = opt(k);
  if (!c.kind || !c.country) refuse("a contract needs --kind and --country");
  if (opt("provider")) fact("provider", opt("provider"));
  for (const [flag, key, number] of [["price-per-year", "price_per_year", true], ["notice-period-days", "notice_period_days", true], ["min-term-end", "min_term_end"], ["next-window", "next_window"], ["service-since", "service_since"]]) {
    const v = opt(flag); if (v === undefined) continue;
    if (key.endsWith("end") || key.endsWith("window") || key.endsWith("since")) parseDay(v);
    if (number && !(Number(v) >= 0)) refuse(`--${flag} is a number`);
    fact(key, number ? Number(v) : v);
  }
  const la = opt("looked-after");
  if (la !== undefined) { if (!LOOKED_AFTER.includes(la)) refuse(`--looked-after is one of ${LOOKED_AFTER.join(", ")}`); fact("looked_after", la); }
  writeContract(c);
  console.log(`${slug}: saved (${c.kind}, ${c.country})`);
}
function cmdEvent(slug) {
  const c = readContract(slug), type = opt("type"), date = opt("date");
  if (!EVENT_TYPES.includes(type)) refuse(`--type is one of ${EVENT_TYPES.join(", ")}`);
  if (!date) refuse("--date is required"); parseDay(date);
  const e = { type, date, source: source() };
  for (const k of ["old", "new"]) if (opt(k) !== undefined) { if (Number.isNaN(Number(opt(k)))) refuse(`--${k} is a number`); e[k] = Number(opt(k)); }
  if ((e.old === undefined) !== (e.new === undefined)) refuse("--old and --new go together");
  if (opt("effective")) { parseDay(opt("effective")); e.effective = opt("effective"); }
  if (type === "contribution-rise" && !e.effective) refuse("a contribution-rise needs --effective, the first day it applies");
  const { p: pb } = playbookCheck(c);
  const want = pb && pb.dates && pb.dates.special_right && pb.dates.special_right.event;
  if (pb && type !== "switch-confirmed" && want !== type) refuse(`for ${c.kind} (${c.country}) a ${type} opens nothing: ${want ? `the event that counts is ${want}` : "no event opens a right, only switch-confirmed is recorded"}`);
  if (c.events.some((x) => eventId(x) === eventId(e))) refuse(`${eventId(e)} is already recorded`);
  c.events.push(e);
  writeContract(c);
  console.log(`${slug}: ${eventId(e)} recorded`);
}
function cmdMark(slug, id) {
  const c = readContract(slug), p = playbookFor(c);
  if (!p) refuse(`no valid playbook for ${c.country}/${c.kind}`);
  const t = watch(TODAY).triggers.find((x) => x.slug === slug && x.id === id);
  if (!t) refuse(`${id} is not due for ${slug}`);
  c.notified = c.notified || {};
  c.notified[id] = { date: TODAY, playbook: ref(p), deadline: t.deadline || null };
  writeContract(c);
  console.log(`${slug}: ${id} marked as said`);
}
function cmdPrepare(slug, id) {
  const c = readContract(slug), n = (c.notified || {})[id];
  if (!n) refuse(`${id} has not been put to the person yet: ask first, prepare after the yes`);
  const p = playbookFor(c);
  if (!p) refuse(`no valid playbook for ${c.country}/${c.kind}: no advice and no page`);
  const d = describe(c, p, id) || {};
  const facts = ["provider", "price_per_year", "min_term_end", "notice_period_days", "next_window", "looked_after", "service_since"]
    .filter((k) => c[k]).map((k) => `- ${k.replace(/_/g, " ")}: ${c[k].value} (${c[k].source}, ${c[k].seen})`);
  const page = [
    `# ${c.kind} (${c.country}): ${slug}, ${id}`, "",
    `Prepared ${TODAY} from playbook ${ref(p)}, checked ${p.checked}. Nothing has been sent, cancelled or signed.`, "",
    d.deadline ? `**Deadline: ${d.deadline}.**` : "", "", "## Your facts, as your file holds them", ...(facts.length ? facts : ["- none recorded"]), "",
    "## The route", p.route, "", "## What only you can do", ...p.person_does.map((x, i) => `${i + 1}. ${x}`), "",
  ].join("\n");
  const dir = path.join(DIR, slug, "prepared");
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, id.replace(/[^a-z0-9.-]+/gi, "_") + ".md");
  fs.writeFileSync(out, page);
  c.prepared = c.prepared || {};
  c.prepared[id] = { date: TODAY, expect_confirmation_by: addDays(TODAY, p.grace_days || 30) };
  writeContract(c);
  console.log(path.relative(ROOT, out));
}
function cmdList() {
  const bad = [];
  for (const c of allContracts(bad)) console.log(`${c.slug}: ${c.kind} ${c.country} ${(c.provider || {}).value || "-"}, ${playbookFor(c) ? "playbook ok" : "no valid playbook"}`);
  for (const b of bad) console.log(`${b.slug}: unreadable (${b.note})`);
}
function cmdPlaybooks() {
  for (const cc of fs.readdirSync(PLAYBOOKS)) for (const f of fs.readdirSync(path.join(PLAYBOOKS, cc)).filter((f) => f.endsWith(".json")).sort()) {
    const kind = f.replace(/\.json$/, "");
    try {
      const p = loadPlaybook(cc, kind);
      console.log(`${cc}/${kind}: ${ref(p)} ${TODAY <= expiresOn(p) ? "valid" : "expired"} (checked ${p.checked}, until ${expiresOn(p)})`);
    } catch (e) { if (!(e instanceof Refusal)) throw e; console.log(`${cc}/${kind}: invalid (${e.message})`); }
  }
}
function cmdSettings() {
  const v = opt("min-saving");
  if (v === undefined || !(Number(v) >= 0)) refuse("settings --min-saving N: the yearly saving in EUR below which nothing is said (0 or more)");
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify({ min_yearly_saving_eur: Number(v) }, null, 2) + "\n");
  console.log(`silent below ${Number(v)} EUR a year`);
}

function main() {
  const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["json"].includes(argv[i - 1].slice(2))));
  const [cmd, a, b] = pos;
  parseDay(TODAY);
  switch (cmd) {
    case "add": return cmdAdd(a);
    case "event": return cmdEvent(a);
    case "list": return cmdList();
    case "playbooks": return cmdPlaybooks();
    case "settings": return cmdSettings();
    case "mark-notified": return cmdMark(a, b);
    case "prepare": return cmdPrepare(a, b);
    case "watch": {
      const r = watch(TODAY);
      if (has("json")) return console.log(JSON.stringify(r, null, 2));
      for (const t of r.triggers) console.log(`${t.slug} ${t.id}${t.deadline ? " by " + t.deadline : ""}`);
      for (const n of r.notes) console.log(`note: ${n.slug}: ${n.note}`);
      if (!r.triggers.length) console.log("Nothing due.");
      return;
    }
    default: refuse("usage: mc-contracts add|event|list|playbooks|watch|mark-notified|prepare (see the top of contracts.js)");
  }
}
try { main(); } catch (e) { if (!(e instanceof Refusal)) throw e; console.error(e.message); process.exit(1); }
