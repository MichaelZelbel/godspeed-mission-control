#!/usr/bin/env node
// mc-observed-state: one line about the world for your morning brief.
//
//   The observed state of the world: nothing to flag today. https://observedstate.com/en/
//
// WHERE IT COMES FROM. Observed State (https://observedstate.com/en/, by Angel Cabrera) checks
// air traffic at 30 airports and the internet in 52 countries against their own last 90 days,
// and lists the magnitude 6+ earthquakes of the last 24 hours. Its author agreed in October 2026
// that Godspeed Mission Control may offer this as an optional line, off unless you switch it
// on, credited and linked every time. One job on GitHub reads the site once an hour for every
// reader together and writes the line (github.com/MichaelZelbel/godspeed-observed-state), so
// the site never sees one visit per reader. This command reads that copy, never the site.
//
// COUNT AND NAME, NEVER WEIGH. The line says how many things are out of their normal range and
// names them. It never becomes a score or a ranking: that is the author's one condition. So this command
// prints the line exactly as built and has no option to reword, summarise or rank it.
//
// A BROKEN MORNING MUST NOT LOOK LIKE A QUIET ONE. When the copy cannot be read, is older than
// six hours, or its data is older than thirty, the line says "not available right now" instead
// of repeating yesterday's "nothing to flag".
//
// Usage:
//   mc-observed-state                 print the line
//   mc-observed-state --append FILE   put the line at the end of FILE (a brief), replacing an
//                                     earlier one, so running it twice leaves one line
'use strict';
const fs = require('fs');
const https = require('https');
const http = require('http');

const URL_DEFAULT = 'https://raw.githubusercontent.com/MichaelZelbel/godspeed-observed-state/main/latest.json';
const LINK = 'https://observedstate.com/en/';
const PREFIX = 'The observed state of the world:';
const UNAVAILABLE = PREFIX + ' not available right now. ' + LINK;
const MAX_CHECK_AGE_H = 6;
const MAX_DATA_AGE_H = 30;

function now() {
  return process.env.OBSERVED_STATE_NOW ? new Date(process.env.OBSERVED_STATE_NOW) : new Date();
}

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http://') ? http : https;
    const req = lib.get(url, { headers: { 'User-Agent': 'mc-observed-state' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

function hoursSince(iso, t) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return Infinity;
  return (t.getTime() - d.getTime()) / 3600000;
}

// The line, or the "not available" line with the reason on stderr.
function lineFrom(record, t) {
  if (!record || record.status !== 'ok') return [UNAVAILABLE, 'the hourly job says: ' + ((record && record.error) || 'not ok')];
  const text = String(record.text || '');
  if (!text.startsWith(PREFIX) || !text.endsWith(LINK)) return [UNAVAILABLE, 'the line is not in the agreed shape'];
  if (hoursSince(record.checked_utc, t) > MAX_CHECK_AGE_H) return [UNAVAILABLE, 'the hourly job has not run since ' + record.checked_utc];
  const sources = record.sources || {};
  for (const name of ['adsb', 'ioda', 'usgs']) {
    const s = sources[name] || {};
    if (hoursSince(s.calculado_utc, t) > MAX_DATA_AGE_H) return [UNAVAILABLE, name + ' data is from ' + s.calculado_utc];
  }
  return [text, ''];
}

async function currentLine() {
  try {
    const record = JSON.parse(await get(process.env.OBSERVED_STATE_URL || URL_DEFAULT));
    return lineFrom(record, now());
  } catch (e) {
    return [UNAVAILABLE, 'could not read the line: ' + e.message];
  }
}

function append(file, line) {
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const kept = old.split(/\r?\n/).filter((l) => !l.startsWith(PREFIX)).join('\n').replace(/\s+$/, '');
  fs.writeFileSync(file, (kept ? kept + '\n\n' : '') + line + '\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--help' || args[0] === '-h') {
    console.log('usage: mc-observed-state            print the line\n' +
                '       mc-observed-state --append FILE   put it at the end of FILE');
    return 0;
  }
  if (args[0] === '--append' && !args[1]) {
    console.error('usage: mc-observed-state --append FILE');
    return 2;
  }
  const [line, why] = await currentLine();
  if (why) console.error('mc-observed-state: ' + why);
  if (args[0] === '--append') {
    append(args[1], line);
    console.log(line);
  } else {
    console.log(line);
  }
  return 0;   // the brief goes out either way; a missing line says so in words
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}
module.exports = { lineFrom, append, PREFIX, LINK, UNAVAILABLE };
