#!/usr/bin/env node
// The shipped suggestion cases (test/suggestion-cases/cases.json) with a live model: the release check
// that processing, the model of the provider given and the screen together still put only what a
// person would want in the Review queue. CI runs the same cases with recorded answers
// (test/suggestion-cases.test.mjs); this script runs them for real and can record new answers.
//
//   node scripts/suggestion-cases.mjs [--provider <provider.json>] [--case <id>] [--budget <dollars>]
//   node scripts/suggestion-cases.mjs --record [--provider <provider.json>]
//
// Without --provider it uses GODSPEED_MODEL_URL, GODSPEED_MODEL_KEY and GODSPEED_MODEL. --record stores,
// for every case, the answers to the request processing made until 23 October 2026 (answers.earlier:
// the noisy answers the screen must cope with, and what the earlier code is measured on) and, for the
// cases about meaning, the answers to today's request (answers.current). It writes cases.json; look at
// the difference before committing it. Exit code 1 when a case fails.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {modelProvider} from '../core/runtime.mjs';
import {CONTRACT, MOMENTS_AND_DOCUMENTS} from '../core/proposals.mjs';
import {visibleRows} from '../core/visibility.mjs';
import {readCases, runCase, CASES_FILE} from '../test/suggestion-cases/harness.mjs';

const EARLIER_CONTRACT = CONTRACT.replace(MOMENTS_AND_DOCUMENTS, 'Moment suggestions also include routine or mundane activities in diaries and journals.');
// The request as processing made it until 23 October 2026: that sentence, and the first 80 facts.
const earlier = (input, query) => ({...input, contract: EARLIER_CONTRACT,
  confirmed_facts: visibleRows(query, 'profile_facts').filter(f => f.is_current && (f.subject_type === 'self' || (input.people || []).some(p => p.id === f.contact_id))).slice(0, 80).map(f => ({subject: f.subject_type === 'self' ? 'self' : f.contact_id, label: f.label, value: f.value}))});

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) continue; const next = argv[i + 1]; if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true; else { out[a.slice(2)] = next; i++; } }
  return out;
}

async function main() {
  const opt = args(process.argv);
  const config = opt.provider ? JSON.parse(fs.readFileSync(opt.provider, 'utf8')) : {url: process.env.GODSPEED_MODEL_URL, key: process.env.GODSPEED_MODEL_KEY, model: process.env.GODSPEED_MODEL};
  const base = modelProvider(config || {});
  if (!base) { console.error('Connect a model: --provider <provider.json>, or GODSPEED_MODEL_URL, GODSPEED_MODEL_KEY and GODSPEED_MODEL.'); process.exit(2); }
  // What the answers cost, as OpenRouter counts it, and a stop before --budget (default 0.10 dollars).
  let spent = 0; const budget = Number(opt.budget || 0.10), realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('openrouter.ai') && init.body) { const body = JSON.parse(init.body); body.usage = {include: true}; init = {...init, body: JSON.stringify(body)}; }
    const response = await realFetch(url, init);
    try { const usage = (await response.clone().json())?.usage; if (usage?.cost) spent += Number(usage.cost); } catch {}
    return response;
  };
  const provider = async input => { if (spent >= budget) throw new Error('budget of $' + budget + ' reached'); return base(input); };
  const file = readCases(), cases = file.cases.filter(c => !opt.case || c.id === opt.case);
  let failed = 0;
  for (const c of cases) {
    if (opt.record) {
      for (const [which, rewrite] of [['earlier', earlier], ...(c.kind === 'meaning' ? [['current', null]] : [])]) {
        // An answer quoting words the note does not hold makes processing refuse it: asked again, up to three times.
        for (let attempt = 1; attempt <= 3; attempt++) {
          const answers = [], result = await runCase(c, {owner: file.owner, provider, rewrite, onAnswer: (n, answer) => { answers[n] = answer; }});
          if (!result.failures.some(f => /^version \d+:/.test(f)) || attempt === 3) { c.answers = {...(c.answers || {}), [which]: answers}; console.log(c.id + ' (' + which + '): recorded' + (result.failures.length ? ', ' + result.failures.join('; ') : '')); break; }
        }
      }
      continue;
    }
    const result = await runCase(c, {owner: file.owner, provider});
    if (!result.passed) failed++;
    console.log((result.passed ? 'pass ' : 'FAIL ') + c.id + (result.passed ? '' : ': ' + result.failures.join('; ')) + '\n     queued: ' + (result.queued.join(' | ') || 'nothing'));
  }
  globalThis.fetch = realFetch;
  if (opt.record) { fs.writeFileSync(CASES_FILE, JSON.stringify(file, null, 1) + '\n'); console.log('Wrote ' + path.relative(process.cwd(), CASES_FILE)); }
  else console.log((cases.length - failed) + ' of ' + cases.length + ' cases pass with ' + config.model + '.');
  console.log('Spent $' + spent.toFixed(4) + '.');
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exit(1); });
