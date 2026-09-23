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
// This was a Python program until 2026-08-21. The setup in Chapter 3 installs Git, Node.js and
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

  const rules = []
  const problems = []
  for (const name of fs.readdirSync(rulesDir).sort()) {
    if (!name.endsWith('.md') || name === 'README.md' || name === 'MEMORY.md') continue
    const h = header(read(path.join(rulesDir, name)))
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
      allDigits(h.order === undefined ? '' : h.order) ? parseInt(h.order, 10) : 99,
      slug,
      h.line
    ])
  }
  if (problems.length) {
    for (const p of problems) process.stderr.write('  ' + p + '\n')
    return 2
  }
  if (rules.length === 0) {
    process.stderr.write('No rules found in ' + rulesDir + '. Nothing written.\n')
    return 2
  }

  const parts = [
    BEGIN + ' - written by mc-compile-rules from the files in rules/. Edit those, not this. -->',
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
  parts.push(FOOTER, '', END)
  const block = parts.join('\n') + '\n'

  if (block.length > MAX_CHARS) {
    const longest = rules.slice().sort((a, b) => b[3].length - a[3].length).slice(0, 3)
    process.stderr.write(
      'Not written. The block would be ' + block.length + ' characters and the limit is ' +
      MAX_CHARS + '.\n\n' +
      'That limit is here on purpose. Rules pile up, and past a certain number they start\n' +
      'contradicting each other at the edges, which makes your assistant worse rather than\n' +
      'better. Merge one into a rule that already covers the same ground, shorten one, or\n' +
      'drop one. Your three longest lines:\n\n')
    for (const row of longest) {
      process.stderr.write('  ' + String(row[3].length).padStart(4) + ' characters  ' + row[2] + '\n')
    }
    return 1
  }

  const cur = read(agents)
  const i = cur.indexOf(BEGIN)
  const j = cur.indexOf(END)
  if (i === -1 || j === -1) {
    process.stderr.write(
      'AGENTS.md has no place to put the rules. Add these two lines where they belong,\n' +
      'then run this again:\n\n    ' + BEGIN + ' -->\n    ' + END + '\n')
    return 2
  }
  // Keep one blank line after the closing marker, or the paragraph below it collides with the
  // block and reads as part of it.
  const rest = cur.slice(j + END.length).replace(/^\n+/, '')
  const next = cur.slice(0, i) + block + (rest ? '\n' + rest : '')

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

process.exit(main(process.argv.slice(2)))
