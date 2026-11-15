#!/usr/bin/env node
// tools/check-built-on.js  (installed as mc-check-built-on)
//
// When a fact stops being true, what did you write while it still held?
//
//   mc-check-built-on                          every fact that changed, in the mission control you run it from
//   mc-check-built-on --claim <subject/attribute>
//   mc-check-built-on --json
//   mc-check-built-on --godspeed <path>             a mission control somewhere else
//
// Exit 1 when something live is still built on a closed fact, 0 when clean.
//
// WHY. world/claims/ closes a fact that stopped being true with a valid_to
// date and keeps the file, which is right. Nothing then looks at what was
// written while the fact was true: the author's book changed its title and
// his profile still carried the old one forty days later. The idea is Rich
// Schefren's open-source Atlas (github.com/RichSchefren/atlas): when a fact
// changes, walk to everything that depended on it, at the moment it changes,
// not when someone next asks. His version is a graph database. This one is a
// string search plus a declared line, because a mission control is text files.
//
// TWO WAYS A RECORD CAN BE BUILT ON A FACT:
//   value     the closed value appears, whole-word and case-insensitive, in a
//             file the mission control treats as current. Cheap, needs nothing declared,
//             cannot see a paraphrase.
//   rests_on  the record says so: `rests_on: [subject/attribute]` in a file's
//             front matter, or `**Rests on:** subject/attribute` in a decision
//             block. A record may also rest on another record (a path, or
//             decisions.md#D-050), and the walk follows that. Atlas draws the
//             same line: "Atlas does not infer dependency edges from prose;
//             callers declare them."
//
// HISTORY IS ALLOWED. A line that carries the date the fact stopped being
// true ("called An AI of Your Own until 2026-07-27") is a record of the
// change, not a stale copy, and is never reported. That is the one way to
// keep an old value on purpose.
//
// No model runs in here, on purpose, and a finding is REPORTED, never fixed:
// the line may be history written without its date, or a real stale copy,
// and only a reader can tell which.
'use strict';
const fs = require('fs');
const path = require('path');

// Where the mission control keeps what it treats as CURRENT. History lives elsewhere and
// is deliberately absent: observations/ and decisions.md are records of what
// was thought at the time, prompts/ and archives/ are verbatim, world/ is the
// claims themselves. decisions.md is read for rests_on lines only, never for
// values, because an old value inside an old decision is exactly right.
const VALUE_SURFACES = ['profile', 'rules', 'lead', 'procedures.md', 'AGENTS.md', 'connections.md', 'where-things-live.md'];
const RESTS_ON_SURFACES = VALUE_SURFACES.concat(['decisions.md']);
const SKIP_DIRS = new Set(['drafts', 'archive', 'archives', 'node_modules', '.git']);
const MIN_VALUE_LENGTH = 4; // "UK" matches too much; such a value is reached only through rests_on

function normalizeAttribute(a) {
  return String(a || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}
function claimKey(subject, attribute) {
  return String(subject || '').trim().toLowerCase() + '/' + normalizeAttribute(attribute);
}
function toPosix(p) { return p.split(path.sep).join('/'); }

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { meta: null, bodyStart: 0 };
  const meta = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (val === '' && lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) {
      const list = [];
      while (lines[i + 1] && /^\s*-\s+/.test(lines[i + 1])) list.push(lines[++i].replace(/^\s*-\s+/, '').trim());
      meta[kv[1]] = list;
    } else if (val.startsWith('[') && val.endsWith(']')) {
      meta[kv[1]] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      meta[kv[1]] = val.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, bodyStart: m[0].split(/\r?\n/).length };
}

function listMarkdown(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return rel.endsWith('.md') ? [rel] : [];
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...listMarkdown(root, path.join(rel, entry.name)));
    } else if (entry.name.endsWith('.md')) {
      out.push(path.join(rel, entry.name));
    }
  }
  return out;
}

function readClaims(root) {
  const dir = path.join(root, 'world', 'claims');
  if (!fs.existsSync(dir)) return { claims: [], folder: false };
  const claims = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const { meta } = frontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    if (!meta || !meta.subject || !meta.attribute) continue;
    claims.push({
      file: 'world/claims/' + f,
      subject: String(meta.subject).trim().toLowerCase(),
      attribute: normalizeAttribute(meta.attribute),
      key: claimKey(meta.subject, meta.attribute),
      value: String(meta.value || ''),
      valid_to: meta.valid_to || '',
    });
  }
  return { claims, folder: true };
}

// A dependency names either a claim (subject/attribute) or a record (a path,
// or decisions.md#D-050). Both are normalised to the shape this file reports.
function normalizeDep(dep) {
  const d = String(dep || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!d) return null;
  if (d.includes('.md')) return { record: d };
  const parts = d.split('/');
  if (parts.length !== 2) return null;
  return { claim: claimKey(parts[0], parts[1]) };
}

function restsOnLines(text) {
  const out = [];
  for (const m of text.matchAll(/\*\*Rests on:\*\*\s*(.+)/g)) {
    out.push(...m[1].split(',').map((s) => s.trim()).filter(Boolean));
  }
  return out;
}

// Every record that can rest on something: one per file, and one per D-block
// inside decisions.md. Returns { id -> [dep, ...] }.
function readRecords(root) {
  const records = new Map();
  for (const surface of RESTS_ON_SURFACES) {
    for (const rel of listMarkdown(root, surface)) {
      const id = toPosix(rel);
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      if (id === 'decisions.md') {
        const blocks = text.split(/^(?=## D-\d+)/m);
        for (const block of blocks) {
          const head = block.match(/^## (D-\d+)/);
          if (!head) continue;
          const deps = restsOnLines(block).map(normalizeDep).filter(Boolean);
          if (deps.length) records.set('decisions.md#' + head[1], deps);
        }
        continue;
      }
      const { meta } = frontmatter(text);
      const deps = [];
      if (meta && meta.rests_on) deps.push(...[].concat(meta.rests_on));
      deps.push(...restsOnLines(text));
      const clean = deps.map(normalizeDep).filter(Boolean);
      if (clean.length) records.set(id, clean);
    }
  }
  return records;
}

function valueFindings(root, claim) {
  const findings = [];
  if (claim.value.trim().length < MIN_VALUE_LENGTH) return { findings, short: true };
  const escaped = claim.value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp('(^|[^\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'iu');
  for (const surface of VALUE_SURFACES) {
    for (const rel of listMarkdown(root, surface)) {
      const lines = fs.readFileSync(path.join(root, rel), 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        if (claim.valid_to && lines[i].includes(claim.valid_to)) continue; // history, dated
        findings.push({ file: toPosix(rel), line: i + 1, text: lines[i].trim(), via: 'value', through: null });
      }
    }
  }
  return { findings, short: false };
}

function restsOnFindings(records, claim) {
  const findings = [];
  const seen = new Set();
  const queue = [];
  for (const [id, deps] of records) {
    if (deps.some((d) => d.claim === claim.key)) queue.push({ id, through: null });
  }
  while (queue.length) {
    const { id, through } = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    findings.push({ file: id, line: null, text: null, via: 'rests_on', through });
    for (const [other, deps] of records) {
      if (!seen.has(other) && deps.some((d) => d.record === id)) queue.push({ id: other, through: id });
    }
  }
  return findings;
}

function scan(root, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const { claims, folder } = readClaims(root);
  const closed = claims.filter((c) => c.valid_to && c.valid_to <= today)
    .filter((c) => !opts.claim || c.key === opts.claim)
    .filter((c) => !opts.files || opts.files.includes(c.file)); // the doorbell: only what just closed
  const records = readRecords(root);
  const findings = [];
  let short = 0;
  for (const claim of closed) {
    const v = valueFindings(root, claim);
    if (v.short) short++;
    for (const f of v.findings.concat(restsOnFindings(records, claim))) {
      findings.push({ subject: claim.subject, attribute: claim.attribute, value: claim.value, valid_to: claim.valid_to, claim_file: claim.file, ...f });
    }
  }
  return {
    findings,
    closed_checked: closed.length,
    total_claims: claims.length,
    claims_folder: folder,
    short_values_skipped: short,
    records_with_rests_on: records.size,
  };
}

function report(result, asJson) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const r = result;
  const tail = `(${r.closed_checked} closed fact(s) checked of ${r.total_claims} claims; ${r.records_with_rests_on} record(s) declare rests_on` +
    (r.short_values_skipped ? `; ${r.short_values_skipped} value(s) under ${MIN_VALUE_LENGTH} characters reached only through rests_on)` : ')');
  if (!r.claims_folder) {
    console.log('no closed claims: there is no world/claims folder here.');
    return;
  }
  if (r.closed_checked === 0) {
    console.log(`no closed claims yet (${r.total_claims} claims). Nothing can be built on a fact that has not changed.`);
    return;
  }
  if (r.findings.length === 0) {
    console.log('nothing live is built on a closed fact. ' + tail);
    return;
  }
  const byClaim = new Map();
  for (const f of r.findings) {
    const k = f.claim_file;
    if (!byClaim.has(k)) byClaim.set(k, { head: f, rows: [] });
    byClaim.get(k).rows.push(f);
  }
  console.log(`${r.findings.length} thing(s) are still built on ${byClaim.size} closed fact(s).\n`);
  for (const { head, rows } of byClaim.values()) {
    const v = head.value.length > 80 ? head.value.slice(0, 77) + '...' : head.value;
    console.log(`  ${head.subject} / ${head.attribute}: ${v}   (closed ${head.valid_to})`);
    for (const f of rows) {
      if (f.via === 'value') {
        const t = f.text.length > 100 ? f.text.slice(0, 97) + '...' : f.text;
        console.log(`      ${f.file}:${f.line}   ${t}`);
      } else {
        console.log(`      ${f.file}   rests_on${f.through ? ', through ' + f.through : ''}`);
      }
    }
    console.log('');
  }
  console.log(tail);
  console.log('None of these is known to be wrong. Each is text written while the fact held,');
  console.log('and nobody has looked at it since the fact changed. To keep an old value on');
  console.log('purpose, put the date it stopped being true on the same line.');
}

function cli() {
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const root = flag('--godspeed') || flag('--dir') || process.cwd();
  const claimFlag = flag('--claim');
  const opts = {};
  if (claimFlag) {
    const parts = claimFlag.split('/');
    if (parts.length !== 2) { console.error('--claim wants subject/attribute'); process.exit(2); }
    opts.claim = claimKey(parts[0], parts[1]);
  }
  const result = scan(root, opts);
  report(result, argv.includes('--json'));
  process.exit(result.findings.length ? 1 : 0);
}

module.exports = { scan, report, claimKey, normalizeAttribute };
if (require.main === module) cli();
