#!/usr/bin/env node
// tools/check-brief.js  (installed as mc-check-brief)
//
// Refuse a morning brief that sends the reader to a file instead of handing
// them the thing.
//
//   mc-check-brief <file>        a brief about to be written or sent ("-" = stdin)
//
// Exit 1 and say exactly what to change when the text asks its reader to act
// but gives them a path instead of the thing or a link. Exit 0, silent, when
// the brief is something a person on a phone can act on.
//
// WHY. A brief that says "open skills/morning-brief/x.md and paste the text"
// reads fine on the computer where the file lives, and is a dead errand on a
// phone, in a chat app, or six months later on a machine the file never
// reached. The promise "no paths, the text rides inside the brief" was made
// in prose many times and broke every time, because prose is remembered by
// sessions and a script is not. This is the script.
//
// WHAT IT REFUSES, two shapes only:
//   path     anything that looks like a file location: lead/drafts/x.md,
//            /home/you/godspeed/..., C:\godspeed\...  A "Sources:" line is the one
//            exemption: provenance is allowed to name its file, because nobody
//            is asked to open it.
//   no link  "read it", "open the draft", "skim the thread" with no https
//            address anywhere in the same brief. An instruction to read
//            something must carry the something.
//
// Links are stripped before matching, because a link is the fix, not the
// fault. The script never rewrites anything; it refuses, and the writer
// (usually your assistant, running the brief recipe) fixes the text.
'use strict';
const fs = require('fs');

const URL_RE = /https?:\/\/\S+/g;
const PATHISH = [
  /\b[\w.@-]+(?:\/[\w.@-]+)+\.[a-zA-Z0-9]{1,6}\b/,            // lead/drafts/x.md
  /(?<![\w/])\/(?:home|Users|var|etc|root|srv|opt|tmp)\/\S+/, // /home/you/...
  /\b[A-Za-z]:[\\/][\w\\/.~-]+/,                              // C:\godspeed\... C:/godspeed/...
];
const READ_THIS = /\b(read|open|skim)\s+(it|the\s+(draft|script|piece|post|page|file|thread|link))\b/i;

function check(text) {
  const faults = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const bare = line.replace(URL_RE, '');
    if (bare.trim().replace(/^\*+/, '').toLowerCase().startsWith('sources:')) return;
    for (const re of PATHISH) {
      const m = bare.match(re);
      if (m) {
        faults.push(
          'REFUSED, line ' + (i + 1) + ': this sends the reader to a file on a machine:\n' +
          '    ' + line.trim() + '\n' +
          '    Put the full text to act on inside the brief itself. Where a file must\n' +
          '    exist, publish it and carry the address. A path is not something a phone\n' +
          '    can open.');
        return;
      }
    }
  });
  if (READ_THIS.test(text) && !URL_RE.test(text)) {
    faults.push(
      'REFUSED: the brief says "' + text.match(READ_THIS)[0] + '" and carries nothing to ' +
      'read.\n    An instruction to read something must carry the thing or a link to it.');
  }
  return faults;
}

function main(argv) {
  const arg = argv[2];
  if (!arg) {
    process.stderr.write('usage: mc-check-brief <file>   ("-" reads stdin)\n');
    return 2;
  }
  const text = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
  const faults = check(text);
  if (!faults.length) return 0;
  process.stdout.write(faults.join('\n\n') + '\n');
  return 1;
}

process.exit(main(process.argv));
