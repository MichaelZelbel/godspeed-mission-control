#!/usr/bin/env node
// Merge the one-line scenario records produced by pooled and standalone jobs.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function catalogRows(text) {
  return text.split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
    const [id, implementation, execution, system, candidateOnly, display] = line.split('\t');
    if (!id || !implementation || !execution || !system || !candidateOnly || !display) throw new Error(`bad scenario catalog row: ${line}`);
    return { id, implementation, execution, system, candidateOnly: candidateOnly === 'yes', display };
  });
}

const pickedNames = (picked) => (picked === 'all' ? null : new Set(String(picked || '').split(',').filter(Boolean)));

// A name picked by hand is judged even where the run would leave it out (a candidate-only row off a
// candidate, Mac without its input): it cannot have run, so it fails instead of passing unseen.
const selected = (rows, names, includeCandidateOnly, excluded) => rows.filter((row) => (names
  ? names.has(row.id)
  : (includeCandidateOnly || !row.candidateOnly) && !excluded.has(row.id)));

// The stage and verdict jobs always run; any other picked name that is no scenario would run nothing.
const unknownNames = (rows, names) => (names
  ? [...names].filter((name) => name !== 'stage' && name !== 'verdict' && !rows.some((row) => row.id === name))
  : []);

const recordsIn = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? recordsIn(file) : entry.isFile() && entry.name.endsWith('.txt') ? [{ file, text: readFileSync(file, 'utf8').trim() }] : [];
  });
};

export function collectVerdicts({ catalog, picked = 'all', includeCandidateOnly = false, excluded = '', directories = [] }) {
  const rows = catalogRows(catalog);
  const names = pickedNames(picked);
  const expected = selected(rows, names, includeCandidateOnly, new Set(String(excluded).split(/[\s,]+/).filter(Boolean)));
  const all = directories.flatMap(recordsIn);
  const failures = [];
  const lines = new Map();
  for (const row of expected) {
    const aliases = row.id === 'windows-old-names-move'
      ? /^(windows-old-names-move|windows-old-names-move-(?:moves|held))\.txt$/
      : new RegExp(`^${row.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.txt$`);
    const matches = all.filter(({ file, text }) => {
      const name = file.split('/').pop();
      // A standalone job keeps its exact result beside its evidence as result.txt;
      // pooled jobs keep the scenario id in the filename. Both are one record per scenario.
      return aliases.test(name) || (name === 'result.txt' && text.includes(` ${row.id}`));
    }).sort((a, b) => a.file.localeCompare(b.file));
    const required = row.id === 'windows-old-names-move' ? 2 : 1;
    if (matches.length !== required) {
      failures.push(`${row.id}: expected ${required} result record${required === 1 ? '' : 's'}, found ${matches.length}`);
      continue;
    }
    const verdicts = matches.map(({ text }) => text);
    const malformed = verdicts.find((text) => !new RegExp(`^(PASS|FAIL) ${row.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: .+$`).test(text));
    if (malformed) {
      failures.push(`${row.id}: malformed result record ${JSON.stringify(malformed)}`);
      continue;
    }
    const failed = verdicts.find((text) => text.startsWith('FAIL '));
    lines.set(row.id, failed || verdicts[0]);
  }
  const unknown = unknownNames(rows, names).map((name) => `${name}: there is no scenario of this name to run`);
  failures.push(...unknown);
  return {
    lines: [
      ...expected.map((row) => {
        const failure = failures.find((item) => item.startsWith(`${row.id}:`));
        return lines.get(row.id) || `FAIL ${row.id}: ${failure ? failure.slice(row.id.length + 2) : 'no result record'}`;
      }),
      ...unknown.map((failure) => `FAIL ${failure}`),
    ],
    failures,
  };
}

function argumentsOf(argv) {
  const out = { dirs: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--results') out.dirs.push(argv[++i]);
    else if (arg === '--catalog') out.catalog = argv[++i];
    else if (arg === '--picked') out.picked = argv[++i];
    else if (arg === '--include-candidate-only') out.includeCandidateOnly = true;
    else if (arg === '--exclude') out.excluded = argv[++i];
    else if (arg === '--status') out.status = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!out.catalog) throw new Error('--catalog is required');
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = argumentsOf(process.argv);
    const result = collectVerdicts({ catalog: readFileSync(args.catalog, 'utf8'), picked: args.picked, includeCandidateOnly: args.includeCandidateOnly, excluded: args.excluded, directories: args.dirs });
    if (args.status) console.log(result.lines.map((line) => `${line.slice(line.indexOf(' ') + 1, line.indexOf(':'))}=${line.startsWith('PASS ') ? 'success' : 'failure'}`).join(' '));
    else result.lines.forEach((line) => console.log(line));
    if (result.failures.length) {
      result.failures.forEach((failure) => console.error(`scenario verdict: ${failure}`));
    }
    if (!args.status && (result.failures.length || result.lines.some((line) => line.startsWith('FAIL ')))) process.exitCode = 1;
  } catch (error) {
    console.error(`scenario verdict: ${error.message}`);
    process.exitCode = 2;
  }
}
