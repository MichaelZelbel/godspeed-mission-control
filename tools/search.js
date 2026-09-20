#!/usr/bin/env node
/*
 * search.js - find something in your hub, by meaning when your notebook can be reached and
 * by plain words when it cannot.
 *
 * WHY THIS EXISTS. A hub is a folder of text files, and the way an assistant looks for
 * something in a folder is by exact word. Ask for "the dentist" and a note that says "Dr. Aydin,
 * teeth" is not found, and the assistant then tells you, with confidence, that you never wrote
 * it down. A connected notebook holds a copy of the whole hub (tools/notebook-sync.py) and
 * searches it by meaning and by words together. So this asks the notebook first.
 *
 * IT NEVER NEEDS THE NOTEBOOK. Most readers never connect one, a train has no network, a key
 * runs out. In every one of those cases this searches the same files on disk instead and says,
 * on the last line, which of the two it did and why. It is never an error to have no notebook.
 *
 * WHAT COMES BACK IS ALWAYS A FILE IN YOUR HUB. A hit from the notebook is matched to the
 * file it is a copy of, and dropped when that file is gone: the file is the truth, the note is
 * a copy, and a copy of something you deleted is not an answer.
 *
 * AGENTS.md IS NEVER A HIT. Your assistant reads it at the start of every session, so finding
 * it again tells it nothing, and it matches nearly every question because it talks about
 * everything.
 *
 *   hub-search <words...>        search
 *   hub-search --limit N ...     at most N hits (8 when you do not say)
 *   hub-search --local ...       do not ask the notebook, search the files
 *   hub-search --json ...        the same answer, for a program to read
 *   hub-search --hub PATH ...    search a hub somewhere else
 *
 * Exit code 0 whenever the search ran, also when it found nothing.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const nb = require("./hub-notebook.js");

const DEFAULT_BASE_URL = "https://tjeapelvjlmbxafsmjef.supabase.co/functions/v1";
// Eight seconds. An assistant is waiting on this in the middle of a sentence, and the files
// on disk answer in well under one. HUB_SEARCH_TIMEOUT_MS exists for the test suite only.
const TIMEOUT_MS = parseInt(process.env.HUB_SEARCH_TIMEOUT_MS || "", 10) || 8000;
const NEVER_A_HIT = "agents.md";

function help() {
  console.log("hub-search - find something in your hub");
  console.log("  hub-search <words...> [--limit N] [--local] [--json] [--hub PATH]");
  console.log("");
  console.log("  It asks your notebook first, when one is connected, and searches the files in");
  console.log("  your hub folder when it cannot. The last line says which of the two it did.");
}

// ---------------------------------------------------------------- arguments
const raw = process.argv.slice(2);
const words = [];
let hubArg = "", limit = 8, localOnly = false, asJson = false, listFiles = false;
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === "--hub") { hubArg = raw[i + 1] || ""; i += 1; continue; }
  if (a === "--limit") { limit = parseInt(raw[i + 1], 10) || 8; i += 1; continue; }
  if (a === "--local") { localOnly = true; continue; }
  if (a === "--json") { asJson = true; continue; }
  // Not for readers: prints the list of files the local search covers, one per line, so the
  // test suite can hold it against the list notebook-sync.py mirrors.
  if (a === "--list-files") { listFiles = true; continue; }
  if (a === "-h" || a === "--help") { help(); process.exit(0); }
  words.push(a);
}
limit = Math.max(1, Math.min(50, limit));

const hub = nb.findHub(hubArg);
if (!hub) {
  console.log("I could not find your hub folder. Run this inside it, or say where it is:");
  console.log("  hub-search --hub /path/to/your/hub <words>");
  process.exit(1);
}
if (listFiles) {
  for (const f of nb.mirroredMarkdown(hub)) console.log(f);
  process.exit(0);
}
const query = words.join(" ").trim();
if (!query) { help(); process.exit(1); }

// ---------------------------------------------------------------- reading a file for display
function readText(rel) {
  try { return fs.readFileSync(path.join(hub, rel), "utf8"); } catch (e) { return ""; }
}

// The text under the small header block, when a file has one.
function splitHeader(text) {
  if (!text.startsWith("---")) return { header: "", body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { header: "", body: text };
  const after = text.indexOf("\n", end + 1);
  return { header: text.slice(3, end), body: after < 0 ? "" : text.slice(after + 1) };
}

// What to call a file: the name: or title: line in its header when it has one (a skill and a
// person in world/ both do, and their first heading is often just "What this is"), else its
// first heading, else the file name. A path is where a thing is; this is what it is.
function titleOf(rel, text) {
  const parts = splitHeader(text);
  const n = parts.header.match(/^(?:name|title)[ \t]*:[ \t]*(.+)$/m);
  if (n) return n[1].trim().replace(/^["']|["']$/g, "");
  const h = parts.body.match(/^#{1,3}[ \t]+(.+?)[ \t]*#*[ \t]*$/m);
  if (h) return h[1].trim();
  return path.basename(rel).replace(/\.md$/i, "");
}

const STOPWORDS = new Set(("a an and are as at be but by do for from has have how i in is it me my " +
  "of on or so that the this to was we what when where which who why with you your " +
  "der die das ein eine und ist im in zu mit von den dem des auf was wie wo ich").split(" "));

function termsOf(q) {
  const all = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept = all.filter((t) => t.length > 1 && !STOPWORDS.has(t));
  // A question made only of small words ("who am I") still deserves an attempt.
  return Array.from(new Set(kept.length ? kept : all));
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A term matches at the START of a word, so "invoice" finds "invoices" and "ai" does not
// find "said".
const termRe = (t) => new RegExp("(?<![\\p{L}\\p{N}])" + escapeRe(t), "giu");
const countOf = (re, text) => { re.lastIndex = 0; const m = text.match(re); return m ? m.length : 0; };

// One or two lines from the file that show why it was found.
function snippetFrom(text, terms) {
  const lines = splitHeader(text).body.split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !/^(---|```)/.test(l));
  let best = "", bestScore = 0;
  for (const l of lines) {
    let s = 0;
    for (const t of terms) if (countOf(termRe(t), l)) s += 1;
    if (s > bestScore && !/^#/.test(l)) { best = l; bestScore = s; }
  }
  if (!best) best = lines.find((l) => !/^#/.test(l)) || lines[0] || "";
  best = best.replace(/^[-*>] +/, "").replace(/\s+/g, " ");
  return best.length > 220 ? best.slice(0, 217).trimEnd() + "..." : best;
}

// ---------------------------------------------------------------- the local search
// No index, no database: read the files and count. A hub is a few hundred small files and
// this takes less time than the network call it stands in for.
//
// WHAT IS SEARCHED: the files the mirror covers, plus two the mirror handles differently.
// decisions.md is sent as one note per decision and is searched here as the one file it is.
// world/ files marked `origin: menerio` are not sent up, because they came down, but they are
// on this disk precisely so that your facts survive without the notebook, and this is the
// moment that is for.
//
// HOW A FILE IS SCORED, per word you asked for. The file name and the first heading count
// most, because a file ABOUT the dentist beats a file that mentions one. Then the other
// headings. Then how often the word turns up in the text, which flattens out fast so that a
// long file cannot win by length. A file holding every word you asked for gets a bonus.
function localSearch(terms, max) {
  const files = nb.mirroredMarkdown(hub);
  if (fs.existsSync(path.join(hub, nb.DECISION_LOG))) files.push(nb.DECISION_LOG);
  const hits = [];
  for (const rel of files) {
    if (rel.toLowerCase() === NEVER_A_HIT) continue;
    const text = readText(rel);
    if (!text) continue;
    const lower = text.toLowerCase();
    const parts = splitHeader(lower);
    const name = rel.toLowerCase().replace(/\.md$/, "");
    const headings = parts.body.split(/\r?\n/).filter((l) => /^#{1,6}[ \t]/.test(l));
    const first = (headings[0] || "") + " " + ((parts.header.match(/^(?:name|title|description)[ \t]*:.*$/gm) || []).join(" "));
    const rest = headings.slice(1).join("\n");
    let score = 0, found = 0;
    for (const t of terms) {
      const re = termRe(t);
      let s = 0;
      if (countOf(re, name)) s += 12;
      if (countOf(re, first)) s += 12;
      s += Math.min(3, countOf(re, rest)) * 4;
      const n = countOf(re, lower);
      if (n) s += Math.min(6, 1 + Math.log2(n));
      if (s) found += 1;
      score += s;
    }
    if (!score) continue;
    if (terms.length > 1 && found === terms.length) score += 8;
    hits.push({ path: rel, title: titleOf(rel, text), snippet: snippetFrom(text, terms),
      score: Math.round(score * 10) / 10 });
  }
  hits.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
  return hits.slice(0, max);
}

// ---------------------------------------------------------------- asking the notebook
function askMenerio(key, q, max) {
  return new Promise((resolve) => {
    const base = (process.env.MENERIO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
    let url;
    try {
      url = new URL(base + "/hub-api-notes/search?q=" + encodeURIComponent(q) +
        "&source_app=hub&limit=" + max);
    } catch (e) { return resolve({ error: "the notebook address is not a web address" }); }
    const lib = url.protocol === "http:" ? http : https;
    let done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(clock); resolve(v); } };
    const req = lib.request(url, { method: "GET",
      headers: { Authorization: "Bearer " + key, Accept: "application/json" } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          return finish({ error: "it refused the key (" + res.statusCode + ")" });
        }
        if (res.statusCode !== 200) return finish({ error: "it answered " + res.statusCode });
        try { finish({ body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }); }
        catch (e) { finish({ error: "its answer could not be read" }); }
      });
      res.on("error", () => finish({ error: "the answer broke off" }));
    });
    // One clock for the whole exchange. A socket timeout alone only measures silence, and a
    // server that sends one byte every seven seconds would keep an assistant waiting forever.
    const clock = setTimeout(() => {
      finish({ error: "no answer in " + Math.round(TIMEOUT_MS / 1000) + " seconds" });
      req.destroy();
    }, TIMEOUT_MS);
    req.on("error", (e) => {
      const offline = ["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET"];
      finish({ error: offline.includes(e.code) ? "no connection to it from here" : "the call failed (" + (e.code || e.message) + ")" });
    });
    req.end();
  });
}

// Which hub file a note is the copy of. The notebook says so in source_id, which is the hub
// path, and for a decision `decisions.md#<key>`. An older Menerio does not send source_id;
// then the title is the path, because that is what the mirror names every note, and a
// decision is known by sitting at the top of the hub folder with a date for a name.
function hubPathOf(note) {
  let p = "";
  if (typeof note.source_id === "string" && note.source_id) {
    p = note.source_id.split("#")[0];
  } else {
    const title = String(note.title || "");
    const folder = String(note.folder_path || "").replace(/^\/+|\/+$/g, "");
    if (/\.md$/i.test(title) && title.includes("/")) p = title;
    else if (/\.md$/i.test(title)) p = (folder.startsWith("hub/") ? folder.slice(4) + "/" : "") + title;
    else if ((folder === "hub" || !folder) && /^\d{4}-\d{2}-\d{2}\b/.test(title)) p = nb.DECISION_LOG;
  }
  p = p.replace(/\\/g, "/").replace(/^\.\//, "");
  // A path is only ever believed INSIDE the hub.
  if (!p || p.startsWith("/") || /^[A-Za-z]:/.test(p) || p.split("/").includes("..")) return "";
  return p;
}

function usableHits(body, terms) {
  const list = Array.isArray(body) ? body
    : Array.isArray(body.results) ? body.results
    : Array.isArray(body.notes) ? body.notes
    : Array.isArray(body.data) ? body.data : null;
  if (!list) return null;
  const hits = [];
  for (const note of list) {
    if (!note || typeof note !== "object") continue;
    // An older Menerio ignores source_app=hub and also returns notes you wrote yourself.
    // Those are not copies of a hub file, and the notebook's own tools are the way to them.
    if (note.source_app && note.source_app !== "hub") continue;
    const rel = hubPathOf(note);
    if (!rel || rel.toLowerCase() === NEVER_A_HIT) continue;
    const text = readText(rel);
    if (!text) continue;                       // the file is gone, so the copy is no answer
    const isDecision = rel === nb.DECISION_LOG;
    let title = String(note.title || "");
    if (!title || title === rel) title = titleOf(rel, text);
    // The preview comes from the file on this disk whenever it has a line to show.
    // Menerio found the file; the file is the real thing, and the copy opens with a line
    // saying where it came from and then the file's header. That is what Menerio's own
    // snippet showed on the first live run: three hits, three times "This is a file from
    // your hub at". A decision is one section of a long file, so there the notebook's
    // snippet is the better one, with that opening taken off.
    let snippet = isDecision ? "" : snippetFrom(text, terms);
    if (!snippet) {
      snippet = String(note.snippet || "").replace(/\s+/g, " ").trim()
        .replace(/^.*?This is (a file from your hub|a copy of the hub file)[^.]*\.( (You|It)[^.]*\.)?\s*/i, "");
    }
    if (!snippet && typeof note.content === "string") {
      // The first lines of a mirrored note say where it came from. That is not the find.
      snippet = snippetFrom(note.content.replace(/^[^\n]*\n\n---\n\n/, ""), terms);
    }
    if (!snippet) snippet = isDecision ? title : snippetFrom(text, terms);
    if (snippet.length > 220) snippet = snippet.slice(0, 217).trimEnd() + "...";
    const hit = { path: rel, title: title, snippet: snippet };
    if (typeof note.similarity === "number") hit.similarity = note.similarity;
    hits.push(hit);
  }
  return hits;
}

// "meaning and words" only when Menerio says it searched by meaning. An answer that does
// not say is the older, words-only search, and claiming more would be a guess.
function modeWords(body) {
  const m = String((body && body.mode) || "").toLowerCase();
  return /hybrid|semantic|vector|meaning|embedding/.test(m) ? "meaning and words" : "words only";
}

// ---------------------------------------------------------------- saying it
function show(result) {
  if (asJson) { console.log(JSON.stringify(result, null, 1)); return; }
  if (!result.hits.length) console.log("Nothing found for \"" + query + "\".");
  for (const h of result.hits) {
    console.log(h.path);
    console.log("  " + h.title);
    if (h.snippet && h.snippet !== h.title) console.log("  " + h.snippet);
    console.log("");
  }
  if (!result.hits.length) console.log("");
  console.log("source: " + result.source_line);
}

async function main() {
  const terms = termsOf(query);
  let reason = "";
  let answeredEmpty = false;
  if (!localOnly) {
    const k = nb.menerioKey(hub);
    if (!k.key) {
      reason = "none";
    } else {
      const r = await askMenerio(k.key, query, limit);
      const hits = r.body ? usableHits(r.body, terms) : null;
      if (r.error) reason = r.error;
      else if (hits === null) reason = "its answer could not be read";
      else if (hits.length) {
        const mode = modeWords(r.body);
        return show({ query: query, source: "menerio", mode: mode,
          source_line: "Menerio (" + mode + ")", hits: hits.slice(0, limit) });
      } else answeredEmpty = true;
    }
  }
  const hits = localSearch(terms, limit);
  let line;
  if (localOnly) line = "local files";
  else if (answeredEmpty) line = "local files (Menerio answered and had nothing for this, so I looked here too)";
  else if (reason === "none") line = "local files (no Menerio connected)";
  else line = "local files (Menerio not reached: " + reason + ")";
  show({ query: query, source: "local", mode: "words only", source_line: line,
    reason: answeredEmpty ? "menerio had nothing" : reason === "none" ? "" : reason, hits: hits });
}

main().then(() => process.exit(0), (e) => {
  console.log("hub-search stopped: " + (e && e.message ? e.message : e));
  process.exit(1);
});
