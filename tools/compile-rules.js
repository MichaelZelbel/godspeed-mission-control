#!/usr/bin/env node
// compile-rules.js - write the short list of your rules into AGENTS.md.
//
// WHAT THIS IS
// ------------
// Your rules live in `rules/`, one file per rule, and each file holds the whole story: what the
// rule is, why you gave it, and what its exceptions are. That is the version you edit.
//
// Your assistant cannot read all of that every session. So this program takes the one-line version
// of each rule (the `line:` in the file's header) and writes them all into `AGENTS.md`, between two
// markers. That block is what your assistant actually reads, every time, before anything else.
//
// You edit the files in `rules/`. You never edit the block. Run this and the block catches up.
//
// WHY IT WORKS THIS WAY
// ---------------------
// You cannot search for a rule you do not know exists. If a rule sits in a folder waiting to be
// looked up, your assistant will break it without ever knowing it was there. So rules have to
// arrive uninvited, which means they have to be in the file your assistant reads first.
//
// But a rule with its whole story is a page long, and twenty of those would crowd out everything
// else. Hence the split: the story stays in the file, one sentence goes in the block, and the block
// names the file so your assistant can open it when it matters.
//
// THE CEILING
// -----------
// The block has a size limit, and this program refuses to write past it. That refusal is the point.
// Rules accumulate: every time something goes wrong you want to add one, and nothing ever removes
// one. Past a certain size they start contradicting each other at the edges, and an assistant with
// twenty overlapping rules obeys them worse than one with eight clear ones.
//
// So when a new rule will not fit, this tells you which lines are longest and asks you to merge,
// shorten, or drop one. Raising the number is the thing it exists to stop you doing.
//
// WHY NODE AND NOT PYTHON
// -----------------------
// This was a Python program until 2026-08-21. The setup in Chapter 2 installs Git, Node.js and
// Claude Code, and it has never installed Python, so the one command the safety chapter asks a
// reader to type worked only for the readers who happened to have Python already. It was also
// printed as `python3 tools/compile-rules.py`, a path no reader has, because the installer puts
// these programs on the machine rather than in the folder. Node is on every machine this kit
// touches, and the installer already knows how to make a Windows launcher for a Node program.
//
// USAGE
//     mc-compile-rules             rewrite the block in AGENTS.md
//     mc-compile-rules --check     say whether it is out of date, change nothing
//
// Run it from your mission control folder, or give it the folder:
//     mc-compile-rules --godspeed /path/to/godspeed

'use strict'

const fs = require('fs')
const path = require('path')

const BEGIN = '<!-- rules:begin'
const END = '<!-- rules:end -->'

// How big the block may get, in characters. About 4,000 is fifteen to twenty rules, which is
// more than most people ever need and about as many as an assistant can hold at once.
const MAX_CHARS = 4000

const GROUPS = [
  ['must', '**I must:**'],
  ['never', '**I must never:**'],
  ['how', '**How things work here:**']
]

const FOOTER = 'Each name in brackets is a file in `rules/` with the whole story behind that rule. ' +
               'Open it before deciding a rule does not apply.'

function read (p) {
  return fs.readFileSync(p, 'utf8')
}

// Read the `key: value` lines at the top of a rule file, between the two --- lines.
function header (text) {
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end === -1) return {}
  const out = {}
  for (const raw of text.slice(3, end).split('\n')) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/.exec(raw)
    if (!m) continue
    let val = m[2].trim()
    if (val.slice(0, 1) === '"' && val.slice(-1) === '"') {
      val = val.slice(1, -1).replace(/\\"/g, '"')
    }
    out[m[1]] = val
  }
  return out
}

function allDigits (s) {
  return /^[0-9]+$/.test(s)
}

// The rules a set of rule files holds, as [group, order, slug, line], and the files that cannot
// be compiled. `files` is [{name, text}], one per file in rules/.
function collect (files, { defaultOrder = 99 } = {}) {
  const rules = []
  const problems = []
  for (const { name, text } of files.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (!name.endsWith('.md') || name === 'README.md' || name === 'MEMORY.md') continue
    const h = header(text)
    const slug = name.slice(0, -3)
    if ((h.where === undefined ? 'always' : h.where) !== 'always') {
      continue // a rule kept for reference, or one that belongs to a single job
    }
    if (!h.line) {
      problems.push(slug + ' has no `line:` in its header, so there is nothing to put in the ' +
                    'block. Add one: a single sentence saying what the rule is.')
      continue
    }
    rules.push([
      h.group === undefined ? 'how' : h.group,
      allDigits(h.order === undefined ? '' : h.order) ? parseInt(h.order, 10) : defaultOrder,
      slug,
      h.line
    ])
  }
  return { rules, problems }
}

// The opening line and the closing paragraph the block in `agentsText` already has. A mission
// control that keeps its rules with a program of its own (an owner's, which names itself in that
// line) keeps both when the notebook's Identity page brings the list up to date.
function existingFrame (agentsText) {
  const i = agentsText.indexOf(BEGIN)
  const j = agentsText.indexOf(END, i)
  if (i === -1 || j === -1) return null
  const block = agentsText.slice(i, j)
  const close = block.indexOf('-->')
  if (close === -1) return null
  const begin = block.slice(0, close + 3)
  const paragraphs = block.slice(close + 3).replace(/\r\n/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const last = paragraphs[paragraphs.length - 1]
  const footer = last && !/^(\d+\.|\*\*)/.test(last) ? last : null
  return { begin, footer }
}

function buildBlock (rules, frame) {
  const parts = [
    (frame && frame.begin) || (BEGIN + ' - written by mc-compile-rules from the files in rules/. Edit those, not this. -->'),
    ''
  ]
  let n = 0
  for (const group of GROUPS) {
    const rows = rules
      .filter(r => r[0] === group[0])
      .sort((a, b) => (a[1] - b[1]) || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0))
    if (rows.length === 0) continue
    parts.push(group[1], '')
    for (const row of rows) {
      n += 1
      parts.push(n + '. ' + row[3] + ' `[' + row[2] + ']`')
    }
    parts.push('')
  }
  parts.push((frame && frame.footer) || FOOTER, '', END)
  return { block: parts.join('\n') + '\n', count: n }
}

// Keep one blank line after the closing marker, or the paragraph below it collides with the
// block and reads as part of it. Null when AGENTS.md has no place for the block.
function splice (agentsText, block) {
  const i = agentsText.indexOf(BEGIN)
  const j = agentsText.indexOf(END)
  if (i === -1 || j === -1) return null
  const rest = agentsText.slice(j + END.length).replace(/^\n+/, '')
  return agentsText.slice(0, i) + block + (rest ? '\n' + rest : '')
}

// The whole compilation without touching a file: what AGENTS.md becomes with the rule files in
// `files`. The notebook's Identity page (notebook/core/identity-shelf.mjs) calls this with a rule
// it is about to save, so the file and the list change in one step. keepFrame keeps the opening
// line and closing paragraph the block already has; ceiling lets a block that is already longer
// than the limit (an owner's own, kept by their own program) stay as long as it is, never longer.
function compileText ({ files, agentsText, keepFrame = false, ceiling = 0 }) {
  // A rule with no order of its own goes after every numbered one when the list is kept for an
  // owner's program (theirs counts it as last); this program's own list puts it at 99.
  const { rules, problems } = collect(files, { defaultOrder: keepFrame ? Infinity : 99 })
  if (problems.length) return { problems }
  if (rules.length === 0) return { empty: true, problems: [] }
  const { block, count } = buildBlock(rules, keepFrame ? existingFrame(agentsText) : null)
  if (block.length > Math.max(MAX_CHARS, ceiling)) {
    const longest = rules.slice().sort((a, b) => b[3].length - a[3].length).slice(0, 3)
    return { problems: [], tooLong: { size: block.length, limit: MAX_CHARS, longest: longest.map(r => ({ slug: r[2], chars: r[3].length })) } }
  }
  const next = splice(agentsText, block)
  if (next === null) return { problems: [], noMarkers: true, block, count }
  return { problems: [], next, block, count }
}

function main (argv) {
  let godspeed = process.cwd()
  const at = argv.indexOf('--godspeed')
  if (at !== -1) godspeed = path.resolve(argv[at + 1] || '')
  const check = argv.indexOf('--check') !== -1

  const rulesDir = path.join(godspeed, 'rules')
  const agents = path.join(godspeed, 'AGENTS.md')
  if (!fs.existsSync(rulesDir) || !fs.statSync(rulesDir).isDirectory()) {
    process.stderr.write('There is no rules/ folder in ' + godspeed + ', so there is nothing to compile.\n')
    return 2
  }
  if (!fs.existsSync(agents) || !fs.statSync(agents).isFile()) {
    process.stderr.write('There is no AGENTS.md in ' + godspeed + '. That is the file your rules go into.\n')
    return 2
  }

  const files = fs.readdirSync(rulesDir).filter(name => name.endsWith('.md')).map(name => ({ name, text: read(path.join(rulesDir, name)) }))
  const cur = read(agents)
  const result = compileText({ files, agentsText: cur })
  if (result.problems.length) {
    for (const p of result.problems) process.stderr.write('  ' + p + '\n')
    return 2
  }
  if (result.empty) {
    process.stderr.write('No rules found in ' + rulesDir + '. Nothing written.\n')
    return 2
  }

  if (result.tooLong) {
    process.stderr.write(
      'Not written. The block would be ' + result.tooLong.size + ' characters and the limit is ' +
      MAX_CHARS + '.\n\n' +
      'That limit is here on purpose. Rules pile up, and past a certain number they start\n' +
      'contradicting each other at the edges, which makes your assistant worse rather than\n' +
      'better. Merge one into a rule that already covers the same ground, shorten one, or\n' +
      'drop one. Your three longest lines:\n\n')
    for (const row of result.tooLong.longest) {
      process.stderr.write('  ' + String(row.chars).padStart(4) + ' characters  ' + row.slug + '\n')
    }
    return 1
  }

  if (result.noMarkers) {
    process.stderr.write(
      'AGENTS.md has no place to put the rules. Add these two lines where they belong,\n' +
      'then run this again:\n\n    ' + BEGIN + ' -->\n    ' + END + '\n')
    return 2
  }
  const { next, block, count: n } = result

  if (check) {
    if (next !== cur) {
      process.stderr.write('AGENTS.md is out of date. Run: mc-compile-rules\n')
      return 1
    }
    process.stdout.write('AGENTS.md is up to date: ' + n + ' rules, ' + block.length + ' characters.\n')
    return 0
  }

  if (next === cur) {
    process.stdout.write('Nothing to change: ' + n + ' rules, ' + block.length + ' characters.\n')
    return 0
  }
  fs.writeFileSync(agents, next, { encoding: 'utf8' })
  process.stdout.write('AGENTS.md now carries your ' + n + ' rules (' + block.length +
                       ' characters, limit ' + MAX_CHARS + ').\n')
  return 0
}

module.exports = { BEGIN, END, MAX_CHARS, GROUPS, header, collect, existingFrame, buildBlock, splice, compileText }

if (require.main === module) process.exit(main(process.argv.slice(2)))
